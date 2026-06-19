"""
Public onboarding routes — no auth required.
  POST /onboard/association  — association manager signup
  GET  /invite/{token}       — fetch invite info (for the join page)
  POST /invite/{token}       — tenant accepts invite, creates account
"""
import os
import secrets
import uuid
from collections import defaultdict
from datetime import datetime, timedelta

import asyncpg
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from auth.jwt import AuthUser, require_hoa_admin
from models.db import get_conn
from routes.hoa import _assert_hoa_access
from services.email import (
    send_email, invite_email_html, welcome_admin_html,
    new_association_notification_html,
)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")

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
    # Optional: when present we create the login immediately (future self-signup).
    # When absent, this is an onboarding request — we capture the association and
    # the team preloads their data and invites them later.
    password: str | None = None
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


async def _find_user_id_by_email(email: str) -> str | None:
    """Look up a Supabase auth user id by email (paged admin list)."""
    target = (email or "").strip().lower()
    async with httpx.AsyncClient() as client:
        page = 1
        while page <= 25:
            resp = await client.get(
                f"{SUPABASE_URL}/auth/v1/admin/users",
                headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
                params={"page": page, "per_page": 200},
            )
            if resp.status_code != 200:
                return None
            users = resp.json().get("users", [])
            for u in users:
                if (u.get("email") or "").lower() == target:
                    return u.get("id")
            if len(users) < 200:
                return None
            page += 1
    return None


async def _update_user_password(user_id: str, password: str, app_metadata: dict) -> None:
    """Set the password + app_metadata on an existing Supabase user."""
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
            json={"password": password, "email_confirm": True, "app_metadata": app_metadata},
        )
    if resp.status_code not in (200, 201):
        data = resp.json()
        raise HTTPException(status_code=400, detail=data.get("msg") or data.get("message") or "Could not update account")


async def _create_staff_invite(conn, hoa_id: str, email: str, role: str) -> str:
    """Create a single-use setup token for a staff login (hoa_admin or
    property_manager), replacing any prior unaccepted token for the same
    association + role + email. Returns the token."""
    await conn.execute(
        "DELETE FROM admin_invites WHERE hoa_id = $1 AND role = $2 "
        "AND lower(email) = lower($3) AND accepted_at IS NULL",
        hoa_id, role, email,
    )
    token = secrets.token_urlsafe(32)
    await conn.execute(
        "INSERT INTO admin_invites (hoa_id, email, token, role) VALUES ($1, $2, $3, $4)",
        hoa_id, email, token, role,
    )
    return token


async def _queue_new_association_alert(conn, background_tasks, hoa_id, name, address, admin_name, email):
    """Best-effort internal heads-up: notify every super-user plus the configured
    alert address (deduped). Never raises — a notification problem must not fail
    the caller."""
    try:
        subject, html = new_association_notification_html(name, address, admin_name, email)
        su_rows = await conn.fetch(
            "SELECT email FROM auth.users WHERE raw_app_meta_data->>'role' = 'super_user' AND email IS NOT NULL"
        )
        recipients = {r["email"] for r in su_rows}
        if SIGNUP_ALERT_EMAIL:
            recipients.add(SIGNUP_ALERT_EMAIL)
        for to in recipients:
            background_tasks.add_task(send_email, to, subject, html)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Failed to queue new-association alert for %s", hoa_id)


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
        """INSERT INTO hoas (id, name, address, admin_email, admin_name, unit_count, has_owner_emails,
               ho6_coverage_a_min, ho6_coverage_e_min,
               ho6_wind_required, ho6_additional_interest_required, ho6_policy_in_force_required,
               ho6_named_insured_match_required, ho6_property_address_match_required)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)""",
        hoa_id, body.association_name, body.address, body.email, body.admin_name,
        body.unit_count, body.has_owner_emails,
        body.ho6_coverage_a_min, body.ho6_coverage_e_min, body.ho6_wind_required,
        body.ho6_additional_interest_required, body.ho6_policy_in_force_required,
        body.ho6_named_insured_match_required, body.ho6_property_address_match_required,
    )

    # Only create a login when a password was supplied (future self-signup). The
    # admin create-user endpoint sends no confirmation email, so email_confirm=True
    # lets them sign in immediately. Without a password this is an onboarding
    # request: we keep the HOA record and the team builds it out + invites them.
    user_id = None
    if body.password:
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

    await _queue_new_association_alert(
        conn, background_tasks, hoa_id,
        body.association_name, body.address, body.admin_name, body.email,
    )

    return {"hoa_id": hoa_id, "user_id": user_id}


class InviteAdminBody(BaseModel):
    # Optional confirmed/corrected address from the dashboard dialog. When given,
    # it's saved as the association's admin_email before inviting.
    email: EmailStr | None = None


@router.post("/hoa/{hoa_id}/invite-admin")
async def invite_admin(
    hoa_id: str,
    background_tasks: BackgroundTasks,
    body: InviteAdminBody = InviteAdminBody(),
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Give the association's admin a login once their data is preloaded: issue a
    single-use setup token, email a link to the set-password page, and fire the
    internal new-association alert. The account is created when they submit the
    form (see accept_admin_invite), so the emailed link is safe to prefetch."""
    await _assert_hoa_access(user, hoa_id, conn)
    hoa = await conn.fetchrow("SELECT name, address, admin_email, admin_name FROM hoas WHERE id = $1", hoa_id)
    if hoa is None:
        raise HTTPException(status_code=404, detail="Association not found")

    # Use the confirmed/edited address from the dialog if provided, persisting it
    # so the association's admin contact stays in sync with who we invited.
    admin_email = (body.email or hoa["admin_email"] or "").strip()
    if not admin_email:
        raise HTTPException(status_code=400, detail="No admin email on file for this association. Add one first.")
    if body.email and admin_email.lower() != (hoa["admin_email"] or "").strip().lower():
        await conn.execute("UPDATE hoas SET admin_email = $2 WHERE id = $1", hoa_id, admin_email)

    token = await _create_staff_invite(conn, hoa_id, admin_email, "hoa_admin")
    setup_url = f"{APP_URL}/admin-setup/{token}"
    subject, html = welcome_admin_html(hoa["admin_name"] or "", hoa["name"], setup_url=setup_url)
    background_tasks.add_task(send_email, admin_email, subject, html)

    await _queue_new_association_alert(
        conn, background_tasks, hoa_id, hoa["name"], hoa["address"], hoa["admin_name"] or "", admin_email,
    )

    return {"invited": True, "email": admin_email}


class InvitePmBody(BaseModel):
    unit_id: str
    email: EmailStr | None = None  # confirmed/edited address from the dialog


@router.post("/hoa/{hoa_id}/invite-pm")
async def invite_pm(
    hoa_id: str,
    body: InvitePmBody,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Invite a Property Manager (an existing PM row) to log in. Issues a setup
    token; on accept they get a property_manager login mapped to this
    association — the same scoped admin access as an hoa_admin."""
    await _assert_hoa_access(user, hoa_id, conn)
    unit = await conn.fetchrow(
        "SELECT u.id, u.owner_primary, u.email_primary, h.name AS hoa_name "
        "FROM units u JOIN hoas h ON h.id = u.hoa_id WHERE u.id = $1 AND u.hoa_id = $2",
        body.unit_id, hoa_id,
    )
    if unit is None:
        raise HTTPException(status_code=404, detail="Property manager not found")

    pm_email = (body.email or unit["email_primary"] or "").strip()
    if not pm_email:
        raise HTTPException(status_code=400, detail="No email on file for this property manager. Add one first.")
    if body.email and pm_email.lower() != (unit["email_primary"] or "").strip().lower():
        await conn.execute("UPDATE units SET email_primary = $2 WHERE id = $1", body.unit_id, pm_email)

    token = await _create_staff_invite(conn, hoa_id, pm_email, "property_manager")
    setup_url = f"{APP_URL}/admin-setup/{token}"
    subject, html = welcome_admin_html(unit["owner_primary"] or "", unit["hoa_name"], setup_url=setup_url)
    background_tasks.add_task(send_email, pm_email, subject, html)

    return {"invited": True, "email": pm_email}


@router.get("/admin-invite/{token}")
async def get_admin_invite(token: str, conn: asyncpg.Connection = Depends(get_conn)):
    """Public — load the invite so the setup page can show who/what it's for.
    A GET (e.g. a scanner prefetch) never consumes anything."""
    row = await conn.fetchrow(
        """SELECT ai.email, ai.accepted_at, h.name AS hoa_name
           FROM admin_invites ai JOIN hoas h ON h.id = ai.hoa_id
           WHERE ai.token = $1""",
        token,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invite not found")
    if row["accepted_at"]:
        raise HTTPException(status_code=410, detail="This setup link has already been used.")
    return {"email": row["email"], "hoa_name": row["hoa_name"]}


class AdminInviteAccept(BaseModel):
    password: str


@router.post("/admin-invite/{token}", status_code=201)
async def accept_admin_invite(
    token: str,
    body: AdminInviteAccept,
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Public — the admin sets their password here; only now is the login created
    and the token consumed."""
    async with conn.transaction():
        row = await conn.fetchrow(
            "SELECT id, email, hoa_id, accepted_at, role FROM admin_invites WHERE token = $1 FOR UPDATE",
            token,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Invite not found")
        if row["accepted_at"]:
            raise HTTPException(status_code=410, detail="This setup link has already been used.")

        role = row["role"] or "hoa_admin"
        # hoa_admin carries its association in the token; property_manager access
        # comes from the property_manager_hoas mapping created below.
        app_meta = {"role": role}
        if role == "hoa_admin":
            app_meta["hoa_id"] = str(row["hoa_id"])

        try:
            uid = await _create_supabase_user(row["email"], body.password, app_meta, email_confirm=True)
        except HTTPException as e:
            # Account already exists (e.g. a prior invite) — the token was emailed
            # to this address, so set the password on the existing account.
            if "already" in str(e.detail).lower() or "registered" in str(e.detail).lower():
                uid = await _find_user_id_by_email(row["email"])
                if not uid:
                    raise HTTPException(status_code=409, detail="An account already exists for this email. Use “Forgot password” on the sign-in page to set your password.")
                await _update_user_password(uid, body.password, app_meta)
            else:
                raise

        if role == "property_manager":
            # Map the PM login to this association (scoped admin access), if not already.
            mapped = await conn.fetchval(
                "SELECT 1 FROM property_manager_hoas WHERE supabase_user_id = $1::uuid AND hoa_id = $2",
                uid, row["hoa_id"],
            )
            if not mapped:
                await conn.execute(
                    "INSERT INTO property_manager_hoas (supabase_user_id, hoa_id) VALUES ($1::uuid, $2)",
                    uid, row["hoa_id"],
                )
        else:
            # Create the Admin line (unit-less row) so the Admins card/list reflects
            # the now-active admin — deduped by email.
            exists = await conn.fetchval(
                "SELECT 1 FROM units WHERE hoa_id = $1 AND lower(coalesce(assoc_title,'')) = 'admin' "
                "AND lower(coalesce(email_primary,'')) = lower($2)",
                row["hoa_id"], row["email"],
            )
            if not exists:
                admin_name = await conn.fetchval("SELECT admin_name FROM hoas WHERE id = $1", row["hoa_id"])
                await conn.execute(
                    "INSERT INTO units (hoa_id, unit_number, assoc_title, owner_primary, email_primary) "
                    "VALUES ($1, 'ADMIN', 'Admin', $2, $3)",
                    row["hoa_id"], (admin_name or "").strip() or None, row["email"],
                )

        await conn.execute("UPDATE admin_invites SET accepted_at = NOW() WHERE id = $1", row["id"])
    return {"ok": True}


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
