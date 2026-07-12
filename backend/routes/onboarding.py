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

from auth.jwt import AuthUser, require_hoa_admin, require_super_user
from models.db import get_conn
from services.firms import assign_member_hoa, ensure_firm, map_hoa_to_firm, user_firm
from routes.hoa import _assert_hoa_access
from services.email import (
    send_email, invite_email_html, welcome_admin_html,
    new_association_notification_html, email_changed_html,
    staff_activated_notification_html, staff_added_to_association_html,
)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")

# Internal heads-up when a new association signs up. Override in Railway if the
# recipient ever changes.
SIGNUP_ALERT_EMAIL = os.environ.get("SIGNUP_ALERT_EMAIL", "support@condo.insure")

# Internal heads-up when an invited Admin/PM completes setup and goes live.
STAFF_ALERT_EMAIL = os.environ.get("STAFF_ALERT_EMAIL", "support@condo.insure")

# Bump when the Terms of Service change so the stored acceptance records which
# version each user agreed to.
TOS_VERSION = "2025-06-23"


def _client_ip(request: Request) -> str:
    return (request.headers.get("X-Forwarded-For")
            or (request.client.host if request.client else None)
            or "unknown").split(",")[0].strip()

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
    agree_tos: bool = False           # agreed to the Terms of Service
    certify_authorized: bool = False  # certified authorized to enroll the association
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


async def _update_user_app_metadata(user_id: str, app_metadata: dict) -> None:
    """Update ONLY a Supabase user's app_metadata (role, hoa_id) — never the
    password. Used when an already-registered user is granted access via an
    invite, so the invite can't be forwarded to reset their password."""
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
            json={"app_metadata": app_metadata},
        )
    if resp.status_code not in (200, 201):
        data = resp.json()
        raise HTTPException(status_code=400, detail=data.get("msg") or data.get("message") or "Could not update account")


async def _update_user_email(user_id: str, new_email: str) -> None:
    """Change an existing Supabase user's login email."""
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
            json={"email": new_email, "email_confirm": True},
        )
    if resp.status_code not in (200, 201):
        data = resp.json()
        raise HTTPException(status_code=400, detail=data.get("msg") or data.get("message") or "Could not update login email")


async def _existing_admin_hoa(conn, email: str | None) -> str | None:
    """The hoa_id this email is already an hoa_admin of, if any. Used to guard
    against making one admin login serve two associations (hoa_admin carries a
    single hoa_id, so a second invite would overwrite the first)."""
    e = (email or "").strip()
    if not e:
        return None
    row = await conn.fetchrow(
        "SELECT raw_app_meta_data->>'hoa_id' AS hoa_id FROM auth.users "
        "WHERE lower(email) = lower($1) AND raw_app_meta_data->>'role' = 'hoa_admin' "
        "AND raw_app_meta_data->>'hoa_id' IS NOT NULL LIMIT 1",
        e,
    )
    return row["hoa_id"] if row else None


async def _delete_supabase_user(user_id: str) -> None:
    """Delete a Supabase auth user (revokes their login entirely)."""
    async with httpx.AsyncClient() as client:
        resp = await client.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
        )
    if resp.status_code not in (200, 204, 404):  # 404 = already gone, fine
        data = resp.json()
        raise HTTPException(status_code=400, detail=data.get("msg") or data.get("message") or "Could not revoke login")


async def revoke_staff_login(conn, hoa_id, email: str | None) -> None:
    """Revoke an Admin/PM's access to this association when their row is deleted.

    For a PM: unassign that member from the association. The FIRM keeps the
    association as long as it still has another PM contact row here (a big firm
    swapping one manager for another shouldn't lose the account); when the last
    one goes, the association is dropping the firm — unmap it, and a firm left
    with no associations and no other members is deleted along with its login
    (any live subscription canceled first). A plain hoa_admin login (no firm)
    is deleted outright, as before. The admin_invites record (email + ToS
    acceptance) is preserved and stamped revoked_at for the audit trail."""
    email = (email or "").strip()
    if not email:
        return
    uid = await _find_user_id_by_email(email)
    if uid:
        firm = await user_firm(conn, uid)
        if firm:
            await conn.execute(
                "DELETE FROM pm_member_hoas WHERE supabase_user_id = $1::uuid AND hoa_id = $2",
                uid, hoa_id,
            )
            # Another PM contact from the same firm still on this association?
            other_contact = await conn.fetchval(
                """SELECT 1 FROM units u
                   JOIN auth.users au ON lower(au.email) = lower(u.email_primary)
                   JOIN pm_firm_members m ON m.supabase_user_id = au.id AND m.firm_id = $3
                   WHERE u.hoa_id = $1
                     AND lower(coalesce(u.assoc_title, '')) = 'property manager'
                     AND lower(coalesce(u.email_primary, '')) <> lower($2)""",
                hoa_id, email, firm["id"],
            )
            if other_contact:
                # The firm keeps the account; only this PM loses it. Their
                # login survives (they may be assigned elsewhere).
                await conn.execute(
                    "UPDATE admin_invites SET revoked_at = now() "
                    "WHERE hoa_id = $1 AND lower(email) = lower($2) AND revoked_at IS NULL",
                    hoa_id, email,
                )
                return
            await conn.execute(
                "DELETE FROM pm_firm_hoas WHERE firm_id = $1 AND hoa_id = $2",
                firm["id"], hoa_id,
            )
            remaining_hoas = await conn.fetchval(
                "SELECT count(*) FROM pm_firm_hoas WHERE firm_id = $1", firm["id"],
            )
            other_members = await conn.fetchval(
                "SELECT count(*) FROM pm_firm_members WHERE firm_id = $1 AND supabase_user_id <> $2::uuid",
                firm["id"], uid,
            )
            if not remaining_hoas and not other_members:
                # A live subscription must die with the firm, or it keeps
                # charging with no portal left to cancel it. If cancellation
                # fails, keep the firm + login (billing stays reachable) — the
                # unmap above already revoked this association's data.
                from routes.billing import cancel_firm_subscriptions
                if cancel_firm_subscriptions(firm["stripe_customer_id"]):
                    await conn.execute("DELETE FROM pm_firms WHERE id = $1", firm["id"])
                    await _delete_supabase_user(uid)
        else:
            await _delete_supabase_user(uid)
    # Keep the audit record (email + ToS timestamp); just mark it revoked.
    await conn.execute(
        "UPDATE admin_invites SET revoked_at = now() "
        "WHERE hoa_id = $1 AND lower(email) = lower($2) AND revoked_at IS NULL",
        hoa_id, email,
    )


async def sync_admin_email_change(conn, hoa_id, old_email: str | None, new_email: str | None,
                                  background_tasks=None) -> None:
    """When an Admin/PM contact's email is changed, keep their login + invite in
    sync: an accepted staff invite under the old email means there's a Supabase
    login — update its email and the invite record so sign-in, status, and
    contact all match, and notify both addresses. No-op if there's no accepted
    staff login for the old email."""
    old = (old_email or "").strip()
    new = (new_email or "").strip()
    if not old or not new or old.lower() == new.lower():
        return
    inv = await conn.fetchrow(
        "SELECT id FROM admin_invites WHERE hoa_id = $1 AND lower(email) = lower($2) "
        "AND accepted_at IS NOT NULL ORDER BY accepted_at DESC LIMIT 1",
        hoa_id, old,
    )
    if not inv:
        return
    uid = await _find_user_id_by_email(old)
    if uid:
        await _update_user_email(uid, new)
    await conn.execute("UPDATE admin_invites SET email = $2 WHERE id = $1", inv["id"], new)

    # Notify both the old and new addresses that the sign-in email changed.
    if background_tasks is not None:
        hoa_name = await conn.fetchval("SELECT name FROM hoas WHERE id = $1", hoa_id)
        subject, html = email_changed_html(hoa_name or "your association", new)
        for to in {old, new}:
            background_tasks.add_task(send_email, to, subject, html)


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


async def _queue_staff_activated_alert(conn, background_tasks, role, email, hoa_id):
    """Best-effort internal heads-up to support@ when an invited Admin/PM
    completes setup and goes live. Never raises."""
    try:
        role_label = "Property Manager" if role == "property_manager" else "Admin"
        hoa_name = await conn.fetchval("SELECT name FROM hoas WHERE id = $1", hoa_id) or ""
        # Best-effort display name: the matching staff row, else the hoa admin_name.
        name = await conn.fetchval(
            "SELECT owner_primary FROM units WHERE hoa_id = $1 "
            "AND lower(coalesce(email_primary,'')) = lower($2) "
            "AND lower(coalesce(assoc_title,'')) IN ('admin','property manager') LIMIT 1",
            hoa_id, email,
        )
        if not name:
            name = await conn.fetchval("SELECT admin_name FROM hoas WHERE id = $1", hoa_id)
        subject, html = staff_activated_notification_html(role_label, name or "", email, hoa_name)
        if STAFF_ALERT_EMAIL:
            background_tasks.add_task(send_email, STAFF_ALERT_EMAIL, subject, html)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Failed to queue staff-activated alert for %s", email)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/onboard/association", status_code=201)
async def signup_association(
    request: Request,
    body: AssociationSignup,
    background_tasks: BackgroundTasks,
    conn: asyncpg.Connection = Depends(get_conn),
):
    _check_signup_rate_limit(request)
    if not body.agree_tos:
        raise HTTPException(status_code=400, detail="You must agree to the Terms of Service to continue.")
    # Create HOA record, stamping the legal acceptances server-side (now()).
    hoa_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO hoas (id, name, address, admin_email, admin_name, unit_count, has_owner_emails,
               ho6_coverage_a_min, ho6_coverage_e_min,
               ho6_wind_required, ho6_additional_interest_required, ho6_policy_in_force_required,
               ho6_named_insured_match_required, ho6_property_address_match_required,
               tos_accepted_at, tos_version, tos_accepted_ip, authorized_certified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                   now(), $15, $16, CASE WHEN $17 THEN now() ELSE NULL END)""",
        hoa_id, body.association_name, body.address, body.email, body.admin_name,
        body.unit_count, body.has_owner_emails,
        body.ho6_coverage_a_min, body.ho6_coverage_e_min, body.ho6_wind_required,
        body.ho6_additional_interest_required, body.ho6_policy_in_force_required,
        body.ho6_named_insured_match_required, body.ho6_property_address_match_required,
        TOS_VERSION, _client_ip(request), body.certify_authorized,
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


class SuperuserAssociationCreate(BaseModel):
    association_name: str
    address: str
    admin_email: EmailStr | None = None
    admin_name: str | None = None


@router.post("/admin/association", status_code=201)
async def superuser_create_association(
    body: SuperuserAssociationCreate,
    user: AuthUser = Depends(require_super_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Super-user-only: create an association directly from the dashboard.

    Unlike the public signup flow this needs no ToS/authorization certification
    (the super user is acting internally) and creates no login — the admin is
    invited afterward via the existing /hoa/{id}/invite-admin flow. The HOA is
    seeded with the same standard Florida condo requirements as signup.
    """
    hoa_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO hoas (id, name, address, admin_email, admin_name,
               ho6_coverage_a_min, ho6_coverage_e_min,
               ho6_wind_required, ho6_additional_interest_required, ho6_policy_in_force_required,
               ho6_named_insured_match_required, ho6_property_address_match_required)
           VALUES ($1, $2, $3, $4, $5, 50000, 300000, true, false, true, true, true)""",
        hoa_id, body.association_name, body.address,
        body.admin_email, body.admin_name,
    )
    return {"hoa_id": hoa_id}


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

    # An admin login is bound to one association. If this email already admins a
    # different one, inviting here would overwrite (steal) that — block it.
    other = await _existing_admin_hoa(conn, admin_email)
    if other and other.lower() != hoa_id.lower():
        raise HTTPException(
            status_code=409,
            detail="This email is already the admin of another association. An admin can only manage one association — add them as a Property Manager and use “Invite to log in” to give them access here.",
        )

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

    # If this email already has a property-manager login, do NOT send a
    # password-setup link — a forwarded setup link would let a third party reset
    # their password and lock them out of every association. Instead grant access
    # to this association immediately and tell them to sign in as usual.
    existing = await conn.fetchrow(
        "SELECT id, raw_app_meta_data->>'role' AS role FROM auth.users WHERE lower(email) = lower($1)",
        pm_email,
    )
    token = await _create_staff_invite(conn, hoa_id, pm_email, "property_manager")
    accept_url = f"{APP_URL}/admin-setup/{token}"

    if existing and existing["role"] == "property_manager":
        # Already has a login: send an invite that lands on a ToS-only acceptance
        # page — they still explicitly accept and agree to the terms, but set NO
        # new password (so a forwarded invite can't reset their password). The
        # firm mapping is applied when they accept.
        subject, html = staff_added_to_association_html(unit["hoa_name"], accept_url, unit["owner_primary"])
        background_tasks.add_task(send_email, pm_email, subject, html)
        return {"invited": True, "email": pm_email, "existing_account": True}

    # New login: normal set-a-password setup flow.
    subject, html = welcome_admin_html(unit["owner_primary"] or "", unit["hoa_name"], setup_url=accept_url)
    background_tasks.add_task(send_email, pm_email, subject, html)
    return {"invited": True, "email": pm_email}


@router.get("/admin-invite/{token}")
async def get_admin_invite(token: str, conn: asyncpg.Connection = Depends(get_conn)):
    """Public — load the invite so the setup page can show who/what it's for.
    A GET (e.g. a scanner prefetch) never consumes anything."""
    row = await conn.fetchrow(
        """SELECT ai.email, ai.accepted_at, ai.role, h.name AS hoa_name, f.name AS firm_name
           FROM admin_invites ai
           LEFT JOIN hoas h ON h.id = ai.hoa_id
           LEFT JOIN pm_firms f ON f.id = ai.firm_id
           WHERE ai.token = $1""",
        token,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invite not found")
    if row["accepted_at"]:
        raise HTTPException(status_code=410, detail="This setup link has already been used.")
    # For an association-side PM invite, accepting attaches the HOA to the
    # accepter's whole firm — surface the firm so the setup page can disclose
    # that before they proceed.
    existing_uid = await conn.fetchval(
        "SELECT id FROM auth.users WHERE lower(email) = lower($1)", row["email"],
    )
    existing_firm_name = None
    existing_firm_open = True
    if (row["role"] or "hoa_admin") == "property_manager" and row["hoa_name"] and existing_uid:
        firm = await user_firm(conn, existing_uid)
        existing_firm_name = firm["name"] if firm else None
        if firm:
            existing_firm_open = firm["open_visibility"]
    return {
        "email": row["email"],
        "hoa_name": row["hoa_name"],
        "firm_name": row["firm_name"],
        "role": row["role"] or "hoa_admin",
        "existing_firm_name": existing_firm_name,
        # Assignment-based firms: only assigned members see the association,
        # so the "everyone on your team will see this" disclosure doesn't apply.
        "existing_firm_open": existing_firm_open,
        # When true, the setup page collects only ToS acceptance (no password) —
        # the invitee already has a login and keeps their existing password.
        "existing_account": bool(existing_uid),
    }


class AdminInviteAccept(BaseModel):
    # Optional: only a brand-new login sets a password here. An already-registered
    # invitee accepts + agrees to the ToS without one (their password is never
    # touched, so a forwarded invite can't be used to reset it).
    password: str | None = None
    agree_tos: bool = False


@router.post("/admin-invite/{token}", status_code=201)
async def accept_admin_invite(
    token: str,
    body: AdminInviteAccept,
    request: Request,
    background_tasks: BackgroundTasks,
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Public — the admin/PM sets their password here; only now is the login
    created and the token consumed. Records ToS acceptance on the invite."""
    if not body.agree_tos:
        raise HTTPException(status_code=400, detail="You must agree to the Terms of Service to continue.")
    async with conn.transaction():
        row = await conn.fetchrow(
            "SELECT id, email, hoa_id, firm_id, preassign_hoa_ids, accepted_at, role FROM admin_invites WHERE token = $1 FOR UPDATE",
            token,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Invite not found")
        if row["accepted_at"]:
            raise HTTPException(status_code=410, detail="This setup link has already been used.")

        role = row["role"] or "hoa_admin"
        # hoa_admin carries its association in the token; property_manager access
        # comes from their firm's portfolio (pm_firm_hoas), mapped below.
        app_meta = {"role": role}
        if role == "hoa_admin":
            app_meta["hoa_id"] = str(row["hoa_id"])
            # Guard: don't let accepting this overwrite an admin login that's
            # already bound to a different association.
            other = await _existing_admin_hoa(conn, row["email"])
            if other and other.lower() != str(row["hoa_id"]).lower():
                raise HTTPException(
                    status_code=409,
                    detail="This email is already the admin of another association. Ask to be added as a Property Manager for this one instead.",
                )

        existing_uid = await conn.fetchval(
            "SELECT id FROM auth.users WHERE lower(email) = lower($1)", row["email"])
        if existing_uid:
            # Existing account: they still accept + agree to the ToS here, but we
            # NEVER reset their password from an invite (a forwarded invite must not
            # let a third party change someone's password and hijack the account).
            # Grant access via metadata only, and never demote a super_user.
            uid = str(existing_uid)
            existing_account = True
            current_role = await conn.fetchval(
                "SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = $1::uuid", uid)
            if current_role != "super_user":
                await _update_user_app_metadata(uid, app_meta)
        else:
            if not body.password or len(body.password) < 8:
                raise HTTPException(status_code=400, detail="Please choose a password of at least 8 characters.")
            uid = await _create_supabase_user(row["email"], body.password, app_meta, email_confirm=True)
            existing_account = False

        if role == "property_manager":
            if row["firm_id"]:
                # Teammate invite: join the firm as a member. If they somehow
                # already belong to a firm, keep the original.
                await conn.execute(
                    """INSERT INTO pm_firm_members (firm_id, supabase_user_id, role) VALUES ($1, $2::uuid, 'member')
                       ON CONFLICT (supabase_user_id) DO NOTHING""",
                    row["firm_id"], uid,
                )
                # Apply any associations the inviter pre-assigned, so the new
                # PM lands seeing their book on day one.
                for hoa in (row["preassign_hoa_ids"] or []):
                    await assign_member_hoa(conn, row["firm_id"], uid, hoa)
            else:
                # Association-side PM invite: attach the HOA to this PM's firm
                # (their first association creates a single-owner firm) and
                # assign the accepter to it — under assignment-based
                # visibility, accepting IS the assignment.
                firm_id = await ensure_firm(conn, uid, row["email"])
                await map_hoa_to_firm(conn, firm_id, row["hoa_id"])
                await assign_member_hoa(conn, firm_id, uid, row["hoa_id"])
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

        await conn.execute(
            "UPDATE admin_invites SET accepted_at = NOW(), tos_accepted_at = NOW(), "
            "tos_version = $2, tos_accepted_ip = $3 WHERE id = $1",
            row["id"], TOS_VERSION, _client_ip(request),
        )

    # Heads-up to support@ that this person just went live (outside the txn).
    await _queue_staff_activated_alert(conn, background_tasks, role, row["email"], row["hoa_id"])
    return {"ok": True, "existing_account": existing_account}


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
