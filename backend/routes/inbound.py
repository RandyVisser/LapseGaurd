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

Setup (Resend dashboard). NB: receiving must be on a SUBDOMAIN
(e.g. inbound.condo.insure) — the apex condo.insure MX points to Google
Workspace for human inboxes, so docs@condo.insure no longer reaches Resend.
1. Add inbound.condo.insure as a receiving domain in Resend
2. Add the MX record Resend gives you for that subdomain
3. Create an inbound endpoint pointing at POST {API_URL}/inbound/email
4. Copy the webhook signing secret into RESEND_WEBHOOK_SECRET (whsec_...)
5. RESEND_API_KEY must already be set (it is, for outbound email)
6. Set INBOUND_ADDRESS=docs@inbound.condo.insure so only mail to that address
   is treated as a submission (Resend receiving is subdomain catch-all)
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
from services.policy_parser import parse_dec_bytes
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


async def _record_bounce(conn, event_type: str, data: dict) -> None:
    """Upsert the affected recipient(s) into email_bounces so the dashboard can
    flag owners whose invite/notification didn't land."""
    rcpts = data.get("to") or []
    if isinstance(rcpts, str):
        rcpts = [rcpts]
    btype = "complaint" if "complain" in event_type else "bounce"
    bounce = data.get("bounce") or {}
    reason = None
    if isinstance(bounce, dict):
        reason = bounce.get("subType") or bounce.get("type") or bounce.get("message")
    for r in rcpts:
        _, addr = parseaddr(str(r))
        if not addr:
            continue
        await conn.execute(
            """INSERT INTO email_bounces (email, type, reason, updated_at)
               VALUES ($1, $2, $3, now())
               ON CONFLICT (email) DO UPDATE
                 SET type = EXCLUDED.type, reason = EXCLUDED.reason, updated_at = now()""",
            addr.lower(), btype, reason,
        )
        logger.info("Recorded %s for %s", btype, addr)


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


def _match_by_address(property_address: str, candidates: list, min_score: int = 1) -> list:
    """Score candidates against the dec page's property address: unit number,
    street number, and street-name word overlap each count. Returns the top
    scorers at or above min_score. Use a higher min_score when searching a large
    or untrusted pool (e.g. all units, for an unknown sender) to avoid false hits."""
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
        if street and street[0] in tokens:  # street number
            score += 1
        # street-name word overlap (ignore the leading number and short tokens)
        name_words = [w for w in street[1:] if len(w) > 2]
        if name_words and any(w in tokens for w in name_words):
            score += 1
        if score >= min_score:
            scored.append((score, c))
    if not scored:
        return []
    best = max(s for s, _ in scored)
    return [c for s, c in scored if s == best]


_CANDIDATE_FIELDS = """SELECT t.id AS tenant_id, t.unit_id, t.name AS tenant_name, t.email AS tenant_email,
                  u.owner_primary, u.owner_secondary, u.street_address, u.unit_number,
                  u.city, u.state, u.zip, u.hoa_id, h.name AS hoa_name
           FROM tenants t JOIN units u ON u.id = t.unit_id JOIN hoas h ON h.id = u.hoa_id
           WHERE lower(coalesce(u.assoc_title, '')) <> 'property manager'"""


def _candidate_dicts(rows) -> list:
    return [
        {**dict(r), "tenant_id": str(r["tenant_id"]), "unit_id": str(r["unit_id"]),
         "hoa_id": str(r["hoa_id"])}
        for r in rows
    ]


async def _all_unit_candidates(conn) -> list:
    """Every real unit (with a tenant, excluding PM-titled units) on the platform,
    shaped for address matching. Resolves an unknown sender's forwarded dec page."""
    return _candidate_dicts(await conn.fetch(_CANDIDATE_FIELDS))


async def _candidates_in_hoas(conn, hoa_ids: list) -> list:
    """Real units (excluding PM-titled) within the given HOAs — used to scope a
    known property manager's forwarded dec page to the associations they manage."""
    if not hoa_ids:
        return []
    return _candidate_dicts(await conn.fetch(
        _CANDIDATE_FIELDS + " AND u.hoa_id = ANY($1::uuid[])", hoa_ids))


async def _pm_forward_task(sender: str, scoped: list, all_candidates: list,
                           content: bytes, content_type: str):
    """Known property manager forwarding a dec page. Match the property address
    within the associations they manage. If it matches a unit in an association
    they're NOT assigned to, reject with an explanation rather than uploading."""
    try:
        extracted = await parse_dec_bytes(content, content_type, {})
        addr = (extracted or {}).get("property_address") or ""

        hits = _match_by_address(addr, scoped, min_score=2)
        if len(hits) == 1:
            pool = await get_pool()
            async with pool.acquire() as conn:
                # Trusted: a known PM for this association may see owner details
                await _ingest(conn, sender, hits[0], content, content_type,
                              resolved_by_address=True, trusted=True)
            logger.info("Inbound PM %s matched unit %s by address", sender, hits[0].get("unit_id"))
            return

        # No match in their associations — does it belong to one they're NOT on?
        global_hits = _match_by_address(addr, all_candidates, min_score=2)
        if len(global_hits) >= 1:
            other = global_hits[0]
            logger.info("Inbound PM %s tried to upload to unaffiliated association %s — rejecting",
                        sender, other.get("hoa_name"))
            subject, html = _not_assigned_email(other.get("hoa_name"))
            await send_email(sender, subject, html)
            return

        subject, html = _unmatched_address_email()
        await send_email(sender, subject, html)
    except Exception:
        logger.exception("Inbound PM forward match failed for %s", sender)


def _ext_for(content_type: str) -> str:
    return "pdf" if "pdf" in content_type else content_type.split("/")[-1]


def _full_unit_address(match: dict) -> str | None:
    if not match.get("street_address"):
        return None
    parts = [match["street_address"]]
    if match.get("unit_number"):
        parts.append(f"Unit {match['unit_number']}")
    addr = ", ".join(parts)
    cs = " ".join(filter(None, [match.get("city"), match.get("state")]))
    if cs:
        addr += f", {cs}"
    if match.get("zip"):
        addr += f" {match['zip']}"
    return addr


def _build_submitted(match: dict, hoa_row) -> dict:
    unit_address = _full_unit_address(match)
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


async def _ingest(conn, sender: str, match: dict, content: bytes, content_type: str,
                  resolved_by_address: bool = False, trusted: bool = True):
    """Create the policy for a resolved unit, kick off parsing, confirm by email.
    When resolved_by_address is set, the sender didn't own the unit (an unknown
    sender or a property manager forwarding on an owner's behalf), so the
    confirmation spells out which owner/unit the document was assigned to —
    but ONLY when `trusted` (a known PM for that association). An untrusted
    unknown sender gets a generic ack so we never disclose owner PII (name,
    unit, address) to an unauthenticated party that merely guessed an address."""
    # An invited owner who never created an account has no tenant row yet —
    # create one so the policy has somewhere to attach (mirrors the dashboard).
    if not match.get("tenant_id"):
        name = match.get("owner_primary") or match.get("owner_secondary")
        new_t = await conn.fetchrow(
            "INSERT INTO tenants (unit_id, name, email) VALUES ($1, $2, $3) RETURNING id",
            match["unit_id"], name, sender,
        )
        match = {**match, "tenant_id": str(new_t["id"]),
                 "tenant_name": match.get("tenant_name") or name}

    document_hash = hashlib.sha256(content).hexdigest()
    dupe = await conn.fetchrow(
        "SELECT id FROM policies WHERE tenant_id = $1 AND document_hash = $2",
        match["tenant_id"], document_hash,
    )
    if dupe:
        if resolved_by_address and trusted:
            subject, html = _assigned_email(match, already=True)
        elif resolved_by_address:
            subject, html = _generic_ack_email()
        else:
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

    if resolved_by_address and trusted:
        subject, html = _assigned_email(match)
    elif resolved_by_address:
        subject, html = _generic_ack_email()
    else:
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
        extracted = await parse_dec_bytes(content, content_type, {})
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
    ptype = payload.get("type")
    # Outbound bounces/complaints (e.g. an invite to a dead address) — record so
    # the admin can see which owners never got their email
    if ptype in ("email.bounced", "email.complained"):
        await _record_bounce(conn, ptype, payload.get("data") or {})
        return {"handled": True, "event": ptype}
    if ptype != "email.received":
        return {"handled": False, "reason": "not an inbound email event"}

    data = payload.get("data") or {}

    # Domain catch-all: only process mail sent to our intake address, so replies
    # to alert/notify emails (and other domain traffic) are silently ignored
    if not _addressed_to_intake(data, INBOUND_ADDRESS):
        return {"handled": False, "reason": "not addressed to intake address"}

    _, sender = parseaddr(data.get("from") or "")
    if not sender:
        return {"handled": False, "reason": "no sender"}

    # Recognize the sender as someone the association has on file for a unit:
    #   - a tenant (has an account), or
    #   - an owner email on the unit, or
    #   - an invited email (unit_invites) — so an invited owner who never made
    #     an account can still email their dec page in.
    # tenant_id is nullable (an invited person may have no tenant row yet);
    # _ingest creates one on demand.
    match_rows = await conn.fetch(
        """SELECT u.id AS unit_id, u.hoa_id, u.unit_number, u.street_address,
                  u.city, u.state, u.zip, u.owner_primary, u.owner_secondary, u.assoc_title,
                  tt.id AS tenant_id, tt.name AS tenant_name, tt.email AS tenant_email
           FROM units u
           LEFT JOIN LATERAL (
               SELECT t.id, t.name, t.email FROM tenants t
               WHERE t.unit_id = u.id
               ORDER BY (lower(coalesce(t.email, '')) = lower($1)) DESC, t.id
               LIMIT 1
           ) tt ON true
           WHERE lower(coalesce(u.email_primary, '')) = lower($1)
              OR lower(coalesce(u.email_secondary, '')) = lower($1)
              OR EXISTS (SELECT 1 FROM tenants t2 WHERE t2.unit_id = u.id AND lower(coalesce(t2.email, '')) = lower($1))
              OR EXISTS (SELECT 1 FROM unit_invites i WHERE i.unit_id = u.id AND lower(i.email) = lower($1))""",
        sender,
    )
    # Plain dicts with string ids — these cross into background tasks
    all_matches = [
        {**dict(r),
         "tenant_id": str(r["tenant_id"]) if r["tenant_id"] is not None else None,
         "unit_id": str(r["unit_id"]),
         "hoa_id": str(r["hoa_id"])}
        for r in match_rows
    ]
    # A property manager's email may be attached to a unit titled "Property
    # Manager". We never upload documents onto a PM unit — instead we route the
    # dec page to the real unit by its property address.
    def _is_pm(m):
        return (m.get("assoc_title") or "").strip().lower() == "property manager"
    owner_matches = [m for m in all_matches if not _is_pm(m)]
    pm_matches = [m for m in all_matches if _is_pm(m)]

    if not owner_matches:
        # Sender is either unknown, or a known property manager (matched only to a
        # PM unit). Either way, route by the dec page's property address.
        if not _pick_attachment(data.get("attachments") or []):
            logger.info("Inbound from %s with no attachment — ignoring", sender)
            return {"handled": False, "reason": "no attachment"}
        fetched = await _fetch_attachment_bytes(data.get("email_id") or data.get("id"))
        if fetched is None:
            logger.info("Inbound from %s — attachment fetch failed — ignoring", sender)
            return {"handled": False, "reason": "attachment fetch failed"}
        content, content_type = fetched
        if pm_matches:
            # Known property manager — match within the HOA(s) they manage. If the
            # address belongs to an association they're NOT on, reject with a note.
            hoa_ids = list({m["hoa_id"] for m in pm_matches})
            scoped = await _candidates_in_hoas(conn, hoa_ids)
            all_candidates = await _all_unit_candidates(conn)
            background_tasks.add_task(_pm_forward_task, sender, scoped, all_candidates, content, content_type)
            return {"handled": True, "matched_by": "pending_property_manager_address"}
        # Not a recognized owner, an invited person, or a known PM. Only people
        # the association has invited (or their property manager) may submit by
        # email — don't attach to anything, just point them in the right direction.
        logger.info("Inbound from unrecognized sender %s — rejecting", sender)
        subject, html = _unrecognized_sender_email()
        background_tasks.add_task(send_email, sender, subject, html)
        return {"handled": False, "reason": "sender not recognized"}

    matches = owner_matches

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


def _unrecognized_sender_email():
    """Sender isn't on file for any unit. Tell them how to get set up without
    revealing anything about the platform's data."""
    subject = "We couldn't match your email to a unit"
    html = f"""
    <p>Hi there,</p>
    <p>Thanks for your message. We couldn't match your email address to a unit
    in our system, so we weren't able to file your document.</p>
    <p>If your association uses condo.insure, please ask them to send you an
    invite for your unit, then email your declaration page from the address they
    invited — or forward it to your property manager, who can submit it for you.</p>
    <p><a href="{APP_URL}">{APP_URL}</a></p>
    """
    return subject, html


def _generic_ack_email():
    """Acknowledgment for a sender we can't tie to the unit (unknown sender).
    Deliberately discloses no owner/unit/address — they haven't proven any
    relationship to the unit, so we never confirm whose it is."""
    subject = "We received your email"
    html = f"""
    <p>Hi there,</p>
    <p>Thanks — we received your message. If it relates to a property we track,
    we've passed it along to the association for review. No further action is
    needed on your end.</p>
    <p><a href="{APP_URL}">{APP_URL}</a></p>
    """
    return subject, html


def _assigned_email(match: dict, already: bool = False):
    owner = match.get("owner_primary") or match.get("owner_secondary") or match.get("tenant_name") or "the unit owner"
    unit_no = match.get("unit_number") or "—"
    address = _full_unit_address(match) or "address on file"
    intro = ("This document was already on file, so there was nothing more to do. "
             "Here's the unit it belongs to:") if already else \
            ("We received the insurance document and assigned it to the unit below. "
             "It's being reviewed now.")
    subject = ("Document already on file — Unit " + unit_no) if already else \
              ("Document received and assigned — Unit " + unit_no)
    html = f"""
    <p>Hi there,</p>
    <p>{intro}</p>
    <table cellpadding="0" cellspacing="0" style="margin:12px 0;font-size:14px">
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Unit owner</td><td style="font-weight:600">{owner}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Unit #</td><td style="font-weight:600">{unit_no}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#64748b">Address</td><td style="font-weight:600">{address}</td></tr>
    </table>
    <p>You can review status anytime at <a href="{APP_URL}">{APP_URL}</a>.</p>
    """
    return subject, html


def _not_assigned_email(hoa_name: str | None):
    where = f" for {hoa_name}" if hoa_name else ""
    subject = "You're not assigned to this association"
    html = f"""
    <p>Hi there,</p>
    <p>Thanks for forwarding the insurance declaration page. The property address on
    the document belongs to an association{where} that you're not currently assigned
    to as a property manager, so we couldn't upload it.</p>
    <p>You'll need to be added as a property manager to this association before you can
    submit policies for its unit owners. Please ask the association's administrator to
    add you, then forward the document again.</p>
    <p>Questions? Reach out at <a href="{APP_URL}">{APP_URL}</a>.</p>
    """
    return subject, html


def _unmatched_address_email():
    subject = "We couldn't match your insurance document to a unit"
    html = f"""
    <p>Hi there,</p>
    <p>Thanks for forwarding the insurance declaration page. We weren't able to
    automatically match it to a unit in our system based on the property address
    on the document.</p>
    <p>To get it on file, please make sure the unit is set up with us, then either:</p>
    <ol>
      <li>Have the unit owner forward it from the email address on file for their unit, or</li>
      <li>Reply with the unit's full property address (street, unit number, city, state, zip)
      so we can route it correctly.</li>
    </ol>
    <p>You can also manage units and upload documents directly at
    <a href="{APP_URL}">{APP_URL}</a>.</p>
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
