"""
Resend inbound email webhook — owners forward their dec page to the intake
address (e.g. docs@condo.insure) and it lands in their unit's policy pipeline
automatically: attachment → Supabase storage → policy row → AI parse.

Owners may hold multiple units (same association or several). Disambiguation
order: single match → unit number in the subject line → property address on
the parsed dec page → failure email with next steps.

Resend inbound webhooks deliver attachment *metadata* only; the bytes are
fetched separately from the Received emails API (needs RESEND_API_KEY, the
same key used for sending).

Setup (Resend dashboard):
1. Add the MX record Resend gives you for the receiving domain
2. Create an inbound endpoint pointing at POST {API_URL}/inbound/email
3. Copy the webhook signing secret into RESEND_WEBHOOK_SECRET (whsec_...)
4. RESEND_API_KEY must already be set (it is, for outbound email)
5. Set INBOUND_ADDRESS=docs@condo.insure so only mail to that address is
   treated as a submission (Resend receiving is domain catch-all)
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
from email.utils import parseaddr

import asyncpg
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from models.db import get_conn, get_pool
from models.schemas import PolicyStatus
from routes.units import _run_parsing
from services.policy_parser import parse_dec_page
from services.email import send_email

router = APIRouter()
logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
RESEND_WEBHOOK_SECRET = os.environ.get("RESEND_WEBHOOK_SECRET", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
APP_URL = os.environ.get("APP_URL", "https://condo.insure")
# Resend receiving is domain-wide catch-all, so replies to our alert/notify
# emails also hit this webhook. When set, only mail addressed to this intake
# address is treated as a document submission (e.g. docs@condo.insure).
INBOUND_ADDRESS = os.environ.get("INBOUND_ADDRESS", "")

_ALLOWED_TYPES = ("application/pdf", "image/jpeg", "image/png")
_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024


def _verify_svix_signature(secret: str, headers, body: bytes) -> bool:
    """Resend signs webhooks with the svix scheme:
    base64(HMAC-SHA256(base64-decoded secret, "{id}.{timestamp}.{body}"))."""
    msg_id = headers.get("svix-id")
    timestamp = headers.get("svix-timestamp")
    signatures = headers.get("svix-signature")
    if not (msg_id and timestamp and signatures):
        return False
    try:
        if abs(time.time() - int(timestamp)) > 300:
            return False
        key = base64.b64decode(secret.split("_", 1)[1])
    except (ValueError, IndexError):
        return False
    signed = f"{msg_id}.{timestamp}.".encode() + body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    for part in signatures.split():
        version, _, sig = part.partition(",")
        if version == "v1" and hmac.compare_digest(sig, expected):
            return True
    return False


async def _upload_to_storage(path: str, content: bytes, content_type: str) -> str:
    """Store bytes in the policy-documents bucket and return the public URL."""
    url = f"{SUPABASE_URL}/storage/v1/object/policy-documents/{path}"
    async with httpx.AsyncClient(timeout=60) as http:
        resp = await http.post(
            url,
            content=content,
            headers={
                # apikey is required alongside Authorization — without it the
                # new-format sb_secret_* key is parsed as a JWT and rejected
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
        )
        resp.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/policy-documents/{path}"


def _addressed_to_intake(data: dict, intake: str) -> bool:
    """True if the inbound email was sent to the configured intake address
    (checked across to + cc). Handles recipients given as strings or objects."""
    if not intake:
        return True  # no intake configured → accept all (back-compat)

    def _as_list(v):
        if not v:
            return []
        return [v] if isinstance(v, str) else list(v)

    rcpts = _as_list(data.get("to")) + _as_list(data.get("cc"))
    joined = " ".join(str(r).lower() for r in rcpts)
    return intake.lower() in joined


def _pick_attachment(attachments: list) -> dict | None:
    """Prefer the first PDF, fall back to the first image."""
    pdfs = [a for a in attachments if (a.get("content_type") or "").startswith("application/pdf")
            or (a.get("filename") or "").lower().endswith(".pdf")]
    images = [a for a in attachments if (a.get("content_type") or "").startswith("image/")]
    return (pdfs or images or [None])[0]


async def _fetch_attachment_bytes(email_id: str | None) -> tuple[bytes, str] | None:
    """Resend inbound webhooks carry attachment *metadata* only. Fetch the real
    attachment list (with signed download_urls) from the Received emails API,
    pick the best one (PDF > image), and download its bytes."""
    if not (email_id and RESEND_API_KEY):
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.get(
                f"https://api.resend.com/emails/receiving/{email_id}/attachments",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            )
            resp.raise_for_status()
            j = resp.json()
            items = j if isinstance(j, list) else (j.get("data") or j.get("attachments") or [])
            chosen = _pick_attachment(items)
            if not chosen or not chosen.get("download_url"):
                return None
            dl = await http.get(chosen["download_url"], timeout=60)
            dl.raise_for_status()
            content = dl.content
        if not content or len(content) > _MAX_ATTACHMENT_BYTES:
            return None
        ctype = chosen.get("content_type") or dl.headers.get("content-type") or "application/pdf"
        if not any(ctype.startswith(t.split("/")[0]) for t in _ALLOWED_TYPES):
            ctype = "application/pdf"
        return content, ctype
    except Exception:
        logger.exception("Failed to fetch inbound attachment for email %s", email_id)
        return None


def _match_by_subject(subject: str, candidates: list) -> list:
    """Candidates whose unit number appears as a standalone token in the subject."""
    tokens = set(re.split(r"[\s,#:()\-]+", (subject or "").lower()))
    return [c for c in candidates
            if c.get("unit_number") and str(c["unit_number"]).lower() in tokens]


def _match_by_address(property_address: str, candidates: list) -> list:
    """Score candidates against the dec page's property address: the unit
    number and the street number each count. Returns the top scorers."""
    if not property_address:
        return []
    tokens = set(re.split(r"[\s,#:()\-]+", property_address.lower()))
    scored = []
    for c in candidates:
        score = 0
        unit_no = str(c.get("unit_number") or "").lower()
        if unit_no and unit_no in tokens:
            score += 1
        street = str(c.get("street_address") or "").lower().split()
        if street and street[0] in tokens:
            score += 1
        if score:
            scored.append((score, c))
    if not scored:
        return []
    best = max(s for s, _ in scored)
    return [c for s, c in scored if s == best]


def _ext_for(content_type: str) -> str:
    return "pdf" if "pdf" in content_type else content_type.split("/")[-1]


def _build_submitted(match: dict, hoa_row) -> dict:
    unit_address = None
    if match.get("street_address"):
        parts = [match["street_address"]]
        if match.get("unit_number"):
            parts.append(f"Unit {match['unit_number']}")
        addr = ", ".join(parts)
        cs = " ".join(filter(None, [match.get("city"), match.get("state")]))
        if cs:
            addr += f", {cs}"
        if match.get("zip"):
            addr += f" {match['zip']}"
        unit_address = addr
    return {
        "insurer": None,
        "policy_number": None,
        "expiration_date": None,
        "named_insured": match.get("owner_primary") or match.get("owner_secondary"),
        "address": unit_address,
        "ho6_coverage_a_min": hoa_row["ho6_coverage_a_min"] if hoa_row else None,
        "ho6_coverage_e_min": hoa_row["ho6_coverage_e_min"] if hoa_row else None,
        "ho6_wind_required": hoa_row["ho6_wind_required"] if hoa_row else False,
    }


async def _ingest(conn, sender: str, match: dict, content: bytes, content_type: str):
    """Create the policy for a resolved unit, kick off parsing, confirm by email."""
    document_hash = hashlib.sha256(content).hexdigest()
    dupe = await conn.fetchrow(
        "SELECT id FROM policies WHERE tenant_id = $1 AND document_hash = $2",
        match["tenant_id"], document_hash,
    )
    if dupe:
        subject, html = _already_received_email(match.get("tenant_name"))
        await send_email(sender, subject, html)
        return

    path = f"{match['unit_id']}/{int(time.time() * 1000)}-email.{_ext_for(content_type)}"
    await _upload_to_storage(path, content, content_type)
    # Store the bare object path; reads sign it (private bucket)

    row = await conn.fetchrow(
        """INSERT INTO policies (tenant_id, status, document_url, document_hash)
           VALUES ($1, $2, $3, $4) RETURNING id""",
        match["tenant_id"], PolicyStatus.pending_review.value, path, document_hash,
    )
    hoa_row = await conn.fetchrow(
        "SELECT ho6_coverage_a_min, ho6_coverage_e_min, ho6_wind_required FROM hoas WHERE id = $1",
        match["hoa_id"],
    )
    await _run_parsing(str(row["id"]), path, _build_submitted(match, hoa_row))

    subject, html = _received_email(match.get("tenant_name"), match.get("unit_number"))
    await send_email(sender, subject, html)


async def _ingest_task(sender: str, match: dict, content: bytes, content_type: str):
    """Background wrapper — acquires its own connection (the request's is gone)."""
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await _ingest(conn, sender, match, content, content_type)
    except Exception:
        logger.exception("Inbound email ingest failed for %s", sender)


async def _disambiguate_task(sender: str, candidates: list, content: bytes, content_type: str):
    """Owner has multiple units and the subject didn't name one — parse the
    dec page and match its property address against their units."""
    try:
        staging = f"inbound-staging/{int(time.time() * 1000)}.{_ext_for(content_type)}"
        url = await _upload_to_storage(staging, content, content_type)
        extracted = await parse_dec_page(url, {})
        hits = _match_by_address((extracted or {}).get("property_address") or "", candidates)

        if len(hits) == 1:
            pool = await get_pool()
            async with pool.acquire() as conn:
                await _ingest(conn, sender, hits[0], content, content_type)
            return

        name = candidates[0].get("tenant_name") if candidates else None
        subject, html = _which_unit_email(name, candidates)
        await send_email(sender, subject, html)
    except Exception:
        logger.exception("Inbound email disambiguation failed for %s", sender)


@router.post("/inbound/email")
async def receive_inbound_email(
    request: Request,
    background_tasks: BackgroundTasks,
    conn: asyncpg.Connection = Depends(get_conn),
):
    if not RESEND_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Inbound email not configured")

    body = await request.body()
    if not _verify_svix_signature(RESEND_WEBHOOK_SECRET, request.headers, body):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = json.loads(body)
    if payload.get("type") != "email.received":
        return {"handled": False, "reason": "not an inbound email event"}

    data = payload.get("data") or {}

    # Domain catch-all: only process mail sent to our intake address, so replies
    # to alert/notify emails (and other domain traffic) are silently ignored
    if not _addressed_to_intake(data, INBOUND_ADDRESS):
        return {"handled": False, "reason": "not addressed to intake address"}

    _, sender = parseaddr(data.get("from") or "")
    if not sender:
        return {"handled": False, "reason": "no sender"}

    # Match the sender to unit owner(s): tenants.email first, then the unit's
    # owner email columns (owners often email from the address on file with
    # the HOA rather than their login email)
    match_rows = await conn.fetch(
        """SELECT t.id AS tenant_id, t.unit_id, t.name AS tenant_name, t.email AS tenant_email,
                  u.owner_primary, u.owner_secondary, u.street_address, u.unit_number,
                  u.city, u.state, u.zip, u.hoa_id
           FROM tenants t JOIN units u ON u.id = t.unit_id
           WHERE lower(t.email) = lower($1)
              OR lower(u.email_primary) = lower($1)
              OR lower(u.email_secondary) = lower($1)""",
        sender,
    )
    if not match_rows:
        logger.info("Inbound email from unknown sender %s — ignoring", sender)
        return {"handled": False, "reason": "sender not recognized"}
    # Plain dicts with string ids — these cross into background tasks
    matches = [
        {**dict(r), "tenant_id": str(r["tenant_id"]), "unit_id": str(r["unit_id"]),
         "hoa_id": str(r["hoa_id"])}
        for r in match_rows
    ]

    # Webhook carries attachment metadata only — bail early if none look usable,
    # otherwise fetch the real bytes from the Received emails API
    if not _pick_attachment(data.get("attachments") or []):
        subject, html = _no_attachment_email(matches[0].get("tenant_name"))
        background_tasks.add_task(send_email, sender, subject, html)
        return {"handled": False, "reason": "no usable attachment"}

    fetched = await _fetch_attachment_bytes(data.get("email_id") or data.get("id"))
    if fetched is None:
        subject, html = _no_attachment_email(matches[0].get("tenant_name"))
        background_tasks.add_task(send_email, sender, subject, html)
        return {"handled": False, "reason": "attachment fetch failed"}
    content, content_type = fetched

    # Resolve which unit this policy belongs to
    if len(matches) == 1:
        background_tasks.add_task(_ingest_task, sender, matches[0], content, content_type)
        return {"handled": True}

    subject_hits = _match_by_subject(data.get("subject") or "", matches)
    if len(subject_hits) == 1:
        background_tasks.add_task(_ingest_task, sender, subject_hits[0], content, content_type)
        return {"handled": True, "matched_by": "subject"}

    background_tasks.add_task(_disambiguate_task, sender, matches, content, content_type)
    return {"handled": True, "matched_by": "pending_address_parse"}


def _received_email(name: str | None, unit_number: str | None):
    subject = "We received your insurance document"
    html = f"""
    <p>Hi {name or 'there'},</p>
    <p>We received your insurance document{f' for Unit {unit_number}' if unit_number else ''} and
    it's being reviewed now. We'll let you know if anything else is needed.</p>
    <p>You can check your status anytime at <a href="{APP_URL}">{APP_URL}</a>.</p>
    """
    return subject, html


def _already_received_email(name: str | None):
    subject = "This document was already on file"
    html = f"""
    <p>Hi {name or 'there'},</p>
    <p>Good news — the document you sent is already on file, so there's nothing more to do.</p>
    <p>You can check your status anytime at <a href="{APP_URL}">{APP_URL}</a>.</p>
    """
    return subject, html


def _no_attachment_email(name: str | None):
    subject = "We couldn't find a document in your email"
    html = f"""
    <p>Hi {name or 'there'},</p>
    <p>We received your email but couldn't find an attached insurance document.
    Please reply with your declaration page attached as a PDF or photo.</p>
    """
    return subject, html


def _which_unit_email(name: str | None, candidates: list):
    subject = "Which unit is this policy for?"
    unit_lines = ""
    for c in candidates:
        line = f"Unit {c.get('unit_number') or '—'}"
        if c.get("street_address"):
            line += f" — {c['street_address']}"
        unit_lines += f"<li>{line}</li>"
    html = f"""
    <p>Hi {name or 'there'},</p>
    <p>You own more than one unit, and we couldn't tell which one this policy covers.
    Here's how to fix it (either option works):</p>
    <ol>
      <li>Re-send the email with the unit number in the subject line — e.g. "Unit 1002"</li>
      <li>Or log in at <a href="{APP_URL}">{APP_URL}</a>, pick the unit, and upload it there</li>
    </ol>
    <p>Your units:</p>
    <ul>{unit_lines}</ul>
    """
    return subject, html
