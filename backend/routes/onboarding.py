"""
Public onboarding routes — no auth required.
  POST /onboard/association  — association manager signup
  GET  /invite/{token}       — fetch invite info (for the join page)
  POST /invite/{token}       — tenant accepts invite, creates account
"""
import os
import uuid
from collections import defaultdict
from datetime import datetime, timedelta

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from models.db import get_conn
from fastapi import BackgroundTasks
from services.email import (
    send_email, invite_email_html, welcome_admin_html,
    new_association_notification_html,
)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Internal heads-up when a new association signs up. Override in Railway if the
# recipient ever changes.
SIGNUP_ALERT_EMAIL = os.environ.get("SIGNUP_ALERT_EMAIL", "troy.visser@gmail.com")

router = APIRouter()

# ── Rate limiting (in-memory, per IP, 5 signups / hour) ───────────────────────
_signup_attempts: dict[str, list[datetime]] = defaultdict(list)
_SIGNUP_LIMIT = 5
_SIGNUP_WINDOW = timedelta(hours=1)


def _check_signup_rate_limit(request: Request) -> None:
    ip = (request.headers.get("X-Forwarded-For") or request.client.host or "unknown").split(",")[0].strip()
    now = datetime.utcnow()
    cutoff = now - _SIGNUP_WINDOW
    attempts = [t for t in _signup_attempts[ip] if t > cutoff]
    if len(attempts) >= _SIGNUP_LIMIT:
        raise HTTPException(status_code=429, detail="Too many signup attempts. Please try again in an hour.")
    attempts.append(now)
    _signup_attempts[ip] = attempts


# ── Pydantic models ────────────────────────────────────────────────────────────

class AssociationSignup(BaseModel):
    association_name: str
    address: str
    admin_name: str
    email: EmailStr
    password: str
    unit_count: int | None = None
    has_owner_emails: bool | None = None
    ho6_coverage_a_min: float | None = None
    ho6_coverage_e_min: float | None = None
    ho6_wind_required: bool = False
    ho6_additional_interest_required: bool = False
    ho6_policy_in_force_required: bool = True
    ho6_named_insured_match_required: bool = True
    ho6_property_address_match_required: bool = True


class InviteAccept(BaseModel):
    name: str
    password: str


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _create_supabase_user(email: str, password: str, app_metadata: dict, *, email_confirm: bool = False) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers={
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            },
            json={
                "email": email,
                "password": password,
                "email_confirm": email_confirm,
                "app_metadata": app_metadata,
            },
        )
    if resp.status_code not in (200, 201):
        data = resp.json()
        detail = data.get("msg") or data.get("message") or resp.text
        raise HTTPException(status_code=400, detail=detail)
    return resp.json()["id"]


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/onboard/association", status_code=201)
async def signup_association(
    request: Request,
    body: AssociationSignup,
    background_tasks: BackgroundTasks,
    conn: asyncpg.Connection = Depends(get_conn),
):
    _check_signup_rate_limit(request)
    # Create HOA record
    hoa_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO hoas (id, name, address, admin_email, unit_count, has_owner_emails,
               ho6_coverage_a_min, ho6_coverage_e_min,
               ho6_wind_required, ho6_additional_interest_required, ho6_policy_in_force_required,
               ho6_named_insured_match_required, ho6_property_address_match_required)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)""",
        hoa_id, body.association_name, body.address, body.email,
        body.unit_count, body.has_owner_emails,
        body.ho6_coverage_a_min, body.ho6_coverage_e_min, body.ho6_wind_required,
        body.ho6_additional_interest_required, body.ho6_policy_in_force_required,
        body.ho6_named_insured_match_required, body.ho6_property_address_match_required,
    )

    # Create the admin user already confirmed. The Supabase *admin* create-user
    # endpoint does not send a confirmation email (only the public signup flow
    # does), so email_confirm=False would leave them unable to sign in — they'd
    # get "Email not confirmed" with no link to click. Signup is rate-limited
    # (5/hour/IP) which is the real abuse guard here.
    try:
        user_id = await _create_supabase_user(
            body.email,
            body.password,
            {"role": "hoa_admin", "hoa_id": hoa_id},
            email_confirm=True,
        )
    except HTTPException:
        # Roll back HOA if user creation fails
        await conn.execute("DELETE FROM hoas WHERE id = $1", hoa_id)
        raise

    subject, html = welcome_admin_html(body.admin_name, body.association_name)
    background_tasks.add_task(send_email, body.email, subject, html)

    # Internal heads-up that a new association joined — notify every super-user
    # (both founders) plus any configured alert address, deduped. A notification
    # problem must never fail the signup, so this is best-effort.
    try:
        alert_subject, alert_html = new_association_notification_html(
            body.association_name, body.address, body.admin_name, body.email,
        )
        su_rows = await conn.fetch(
            "SELECT email FROM auth.users WHERE raw_app_meta_data->>'role' = 'super_user' AND email IS NOT NULL"
        )
        recipients = {r["email"] for r in su_rows}
        if SIGNUP_ALERT_EMAIL:
            recipients.add(SIGNUP_ALERT_EMAIL)
        for to in recipients:
            background_tasks.add_task(send_email, to, alert_subject, alert_html)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Failed to queue new-association alert for %s", hoa_id)

    return {"hoa_id": hoa_id, "user_id": user_id}


@router.get("/invite/{token}")
async def get_invite(token: str, conn: asyncpg.Connection = Depends(get_conn)):
    # token is a UUID column — a malformed link should read as "not found", not 500
    try:
        uuid.UUID(str(token))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Invite not found")
    row = await conn.fetchrow(
        """
        SELECT i.id, i.email, i.accepted_at,
               u.unit_number, u.hoa_id,
               h.name AS hoa_name
        FROM unit_invites i
        JOIN units u ON u.id = i.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE i.token = $1
        """,
        token,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invite not found")
    if row["accepted_at"]:
        raise HTTPException(status_code=410, detail="Invite already used")
    return {
        "email": row["email"],
        "unit_number": row["unit_number"],
        "hoa_name": row["hoa_name"],
    }


@router.post("/invite/{token}", status_code=201)
async def accept_invite(
    token: str,
    body: InviteAccept,
    conn: asyncpg.Connection = Depends(get_conn),
):
    async with conn.transaction():
        row = await conn.fetchrow(
            """
            SELECT i.id, i.email, i.unit_id, i.accepted_at,
                   u.unit_number, u.hoa_id,
                   h.name AS hoa_name
            FROM unit_invites i
            JOIN units u ON u.id = i.unit_id
            JOIN hoas h ON h.id = u.hoa_id
            WHERE i.token = $1
            FOR UPDATE OF i
            """,
            token,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Invite not found")
        if row["accepted_at"]:
            raise HTTPException(status_code=410, detail="Invite already used")

        # Tenant invite: email was supplied by the admin, so pre-confirm it
        user_id = await _create_supabase_user(
            row["email"],
            body.password,
            {"role": "tenant", "hoa_id": str(row["hoa_id"])},
            email_confirm=True,
        )

        # Upsert: update existing tenant by email for this unit (handles pre-seeded tenants),
        # or insert a new row if none exists.
        updated = await conn.fetchrow(
            """
            UPDATE tenants SET supabase_user_id = $1, name = $2
            WHERE unit_id = $3 AND email = $4
            RETURNING id
            """,
            user_id, body.name, row["unit_id"], row["email"],
        )
        if not updated:
            # Conflict target matches the partial unique index from migration 004
            # (one row per user per unit — owners may hold multiple units)
            await conn.execute(
                """
                INSERT INTO tenants (unit_id, supabase_user_id, name, email)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (supabase_user_id, unit_id) WHERE supabase_user_id IS NOT NULL
                DO NOTHING
                """,
                row["unit_id"], user_id, body.name, row["email"],
            )

        # Mark invite accepted — inside the transaction so it only commits if everything above succeeded
        await conn.execute(
            "UPDATE unit_invites SET accepted_at = NOW() WHERE token = $1", token
        )

    return {"ok": True}
