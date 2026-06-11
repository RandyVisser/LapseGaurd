"""
Resend inbound email webhook — owners forward their dec page to the intake
address (e.g. docs@condo.insure) and it lands in their unit's policy pipeline
automatically: attachment → Supabase storage → policy row → AI parse.

Setup (Resend dashboard):
1. Enable inbound email for the domain and route it to POST {API_URL}/inbound/email
2. Copy the webhook signing secret into RESEND_WEBHOOK_SECRET (whsec_...)
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from email.utils import parseaddr

import asyncpg
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from models.db import get_conn
from models.schemas import PolicyStatus
from routes.units import _run_parsing
from services.email import send_email

router = APIRouter()
logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
RESEND_WEBHOOK_SECRET = os.environ.get("RESEND_WEBHOOK_SECRET", "")
APP_URL = os.environ.get("APP_URL", "https://condo.insure")

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
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
        )
        resp.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/policy-documents/{path}"


def _pick_attachment(attachments: list) -> dict | None:
    """Prefer the first PDF, fall back to the first image."""
    pdfs = [a for a in attachments if (a.get("content_type") or "").startswith("application/pdf")
            or (a.get("filename") or "").lower().endswith(".pdf")]
    images = [a for a in attachments if (a.get("content_type") or "").startswith("image/")]
    return (pdfs or images or [None])[0]


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
    _, sender = parseaddr(data.get("from") or "")
    if not sender:
        return {"handled": False, "reason": "no sender"}

    # Match the sender to a unit owner: tenants.email first, then the unit's
    # owner email columns (owners often email from the address on file with
    # the HOA rather than their login email)
    matches = await conn.fetch(
        """SELECT t.id AS tenant_id, t.unit_id, t.name AS tenant_name, t.email AS tenant_email,
                  u.owner_primary, u.owner_secondary, u.street_address, u.unit_number,
                  u.city, u.state, u.zip, u.hoa_id
           FROM tenants t JOIN units u ON u.id = t.unit_id
           WHERE lower(t.email) = lower($1)
              OR lower(u.email_primary) = lower($1)
              OR lower(u.email_secondary) = lower($1)""",
        sender,
    )
    if not matches:
        logger.info("Inbound email from unknown sender %s — ignoring", sender)
        return {"handled": False, "reason": "sender not recognized"}
    if len(matches) > 1:
        logger.info("Inbound email from %s matches %d units — ambiguous, ignoring", sender, len(matches))
        return {"handled": False, "reason": "sender matches multiple units"}
    match = matches[0]

    attachment = _pick_attachment(data.get("attachments") or [])
    if not attachment or not attachment.get("content"):
        subject, html = _no_attachment_email(match["tenant_name"])
        background_tasks.add_task(send_email, sender, subject, html)
        return {"handled": False, "reason": "no usable attachment"}

    try:
        content = base64.b64decode(attachment["content"])
    except Exception:
        return {"handled": False, "reason": "attachment not decodable"}
    if len(content) > _MAX_ATTACHMENT_BYTES:
        return {"handled": False, "reason": "attachment too large"}

    content_type = attachment.get("content_type") or "application/pdf"
    if not any(content_type.startswith(t.split("/")[0]) for t in _ALLOWED_TYPES):
        content_type = "application/pdf"

    # Dedupe on file hash, same as the upload route
    document_hash = hashlib.sha256(content).hexdigest()
    dupe = await conn.fetchrow(
        "SELECT id FROM policies WHERE tenant_id = $1 AND document_hash = $2",
        match["tenant_id"], document_hash,
    )
    if dupe:
        subject, html = _already_received_email(match["tenant_name"])
        background_tasks.add_task(send_email, sender, subject, html)
        return {"handled": True, "duplicate": True}

    ext = "pdf" if "pdf" in content_type else content_type.split("/")[-1]
    path = f"{match['unit_id']}/{int(time.time() * 1000)}-email.{ext}"
    document_url = await _upload_to_storage(path, content, content_type)

    row = await conn.fetchrow(
        """INSERT INTO policies (tenant_id, status, document_url, document_hash)
           VALUES ($1, $2, $3, $4) RETURNING id""",
        match["tenant_id"], PolicyStatus.pending_review.value, document_url, document_hash,
    )

    hoa_row = await conn.fetchrow(
        "SELECT ho6_coverage_a_min, ho6_coverage_e_min, ho6_wind_required FROM hoas WHERE id = $1",
        match["hoa_id"],
    )

    unit_address = None
    if match["street_address"]:
        parts = [match["street_address"]]
        if match["unit_number"]:
            parts.append(f"Unit {match['unit_number']}")
        addr = ", ".join(parts)
        cs = " ".join(filter(None, [match["city"], match["state"]]))
        if cs:
            addr += f", {cs}"
        if match["zip"]:
            addr += f" {match['zip']}"
        unit_address = addr

    submitted = {
        "insurer": None,
        "policy_number": None,
        "expiration_date": None,
        "named_insured": match["owner_primary"] or match["owner_secondary"],
        "address": unit_address,
        "ho6_coverage_a_min": hoa_row["ho6_coverage_a_min"] if hoa_row else None,
        "ho6_coverage_e_min": hoa_row["ho6_coverage_e_min"] if hoa_row else None,
        "ho6_wind_required": hoa_row["ho6_wind_required"] if hoa_row else False,
    }
    background_tasks.add_task(_run_parsing, str(row["id"]), document_url, submitted)

    subject, html = _received_email(match["tenant_name"], match["unit_number"])
    background_tasks.add_task(send_email, sender, subject, html)

    return {"handled": True, "policy_id": str(row["id"])}


def _received_email(name: str, unit_number: str | None):
    subject = "We received your insurance document"
    html = f"""
    <p>Hi {name or 'there'},</p>
    <p>We received your insurance document{f' for Unit {unit_number}' if unit_number else ''} and
    it's being reviewed now. We'll let you know if anything else is needed.</p>
    <p>You can check your status anytime at <a href="{APP_URL}">{APP_URL}</a>.</p>
    """
    return subject, html


def _already_received_email(name: str):
    subject = "This document was already on file"
    html = f"""
    <p>Hi {name or 'there'},</p>
    <p>Good news — the document you sent is already on file, so there's nothing more to do.</p>
    <p>You can check your status anytime at <a href="{APP_URL}">{APP_URL}</a>.</p>
    """
    return subject, html


def _no_attachment_email(name: str):
    subject = "We couldn't find a document in your email"
    html = f"""
    <p>Hi {name or 'there'},</p>
    <p>We received your email but couldn't find an attached insurance document.
    Please reply with your declaration page attached as a PDF or photo.</p>
    """
    return subject, html
