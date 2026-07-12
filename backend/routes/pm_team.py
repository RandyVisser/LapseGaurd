"""PM firm team management — a property manager runs their own roster.

One invite gives a colleague the firm's entire portfolio (present and future
associations), instead of the old per-user-per-association invites. Owner-only
actions: invite, revoke, remove, rename; every member can view the roster.
"""
import logging
import secrets

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from auth.jwt import AuthUser, require_hoa_admin, require_super_user
from models.db import get_conn
from services.email import APP_URL, pm_team_invite_html, send_email
from services.firms import ensure_firm, user_firm

router = APIRouter()
logger = logging.getLogger(__name__)


async def _require_firm(conn: asyncpg.Connection, user: AuthUser):
    if user.role != "property_manager":
        raise HTTPException(status_code=403, detail="Property-manager account required")
    # Idempotent safety net: any PM predating firms gets one on first touch.
    await ensure_firm(conn, user.sub, user.email)
    return await user_firm(conn, user.sub)


def _require_owner(firm):
    if not firm["is_owner"]:
        raise HTTPException(status_code=403, detail="Only the firm owner can manage the team.")


@router.get("/pm/team")
async def get_team(
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    members = await conn.fetch(
        """SELECT m.supabase_user_id, m.is_owner, m.created_at, au.email,
                  coalesce(array_agg(a.hoa_id) FILTER (WHERE a.hoa_id IS NOT NULL), '{}') AS assigned
           FROM pm_firm_members m
           LEFT JOIN auth.users au ON au.id = m.supabase_user_id
           LEFT JOIN pm_member_hoas a ON a.supabase_user_id = m.supabase_user_id
           WHERE m.firm_id = $1
           GROUP BY m.supabase_user_id, m.is_owner, m.created_at, au.email
           ORDER BY m.is_owner DESC, m.created_at""",
        firm["id"],
    )
    pending = await conn.fetch(
        """SELECT id, email, created_at FROM admin_invites
           WHERE firm_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
           ORDER BY created_at""",
        firm["id"],
    )
    # The firm's portfolio, for the assignment checkboxes. Only owners get the
    # full list — under assignment-based visibility a member shouldn't learn
    # the firm's other accounts from the team panel.
    portfolio = []
    if firm["is_owner"] or firm["open_visibility"]:
        portfolio = [
            {"id": str(r["id"]), "name": r["name"]}
            for r in await conn.fetch(
                """SELECT h.id, h.name FROM pm_firm_hoas fh JOIN hoas h ON h.id = fh.hoa_id
                   WHERE fh.firm_id = $1 ORDER BY h.name""",
                firm["id"],
            )
        ]
    return {
        "firm": {
            "id": str(firm["id"]),
            "name": firm["name"],
            "open_visibility": firm["open_visibility"],
            "cab_number": firm["cab_number"],
        },
        "is_owner": firm["is_owner"],
        "hoas": portfolio,
        "members": [
            {
                "user_id": str(m["supabase_user_id"]),
                "email": m["email"],
                "is_owner": m["is_owner"],
                "you": str(m["supabase_user_id"]) == str(user.sub),
                "assigned_hoa_ids": [str(h) for h in m["assigned"]],
            }
            for m in members
        ],
        "pending": [
            {"id": str(p["id"]), "email": p["email"], "sent_at": p["created_at"].isoformat()}
            for p in pending
        ],
    }


class TeamInvite(BaseModel):
    email: str


@router.post("/pm/team/invite", status_code=201)
async def invite_teammate(
    body: TeamInvite,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    _require_owner(firm)
    email = (body.email or "").strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")

    already = await conn.fetchval(
        """SELECT 1 FROM pm_firm_members m JOIN auth.users au ON au.id = m.supabase_user_id
           WHERE m.firm_id = $1 AND lower(au.email) = $2""",
        firm["id"], email,
    )
    if already:
        raise HTTPException(status_code=400, detail="That person is already on your team.")

    # Re-inviting replaces the previous pending link.
    await conn.execute(
        "DELETE FROM admin_invites WHERE firm_id = $1 AND lower(email) = $2 AND accepted_at IS NULL",
        firm["id"], email,
    )
    token = secrets.token_urlsafe(32)
    await conn.execute(
        "INSERT INTO admin_invites (firm_id, email, token, role) VALUES ($1, $2, $3, 'property_manager')",
        firm["id"], email, token,
    )
    subject, html = pm_team_invite_html(firm["name"], user.email, f"{APP_URL}/admin-setup/{token}")
    background_tasks.add_task(send_email, email, subject, html)
    return {"invited": True, "email": email}


@router.delete("/pm/team/invites/{invite_id}")
async def revoke_invite(
    invite_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    _require_owner(firm)
    updated = await conn.execute(
        "UPDATE admin_invites SET revoked_at = now() "
        "WHERE id = $1::uuid AND firm_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL",
        invite_id, firm["id"],
    )
    if updated == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"revoked": True}


@router.delete("/pm/team/members/{member_user_id}")
async def remove_member(
    member_user_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    _require_owner(firm)
    if str(member_user_id) == str(user.sub):
        raise HTTPException(status_code=400, detail="You can't remove yourself.")
    deleted = await conn.execute(
        "DELETE FROM pm_firm_members WHERE firm_id = $1 AND supabase_user_id = $2::uuid",
        firm["id"], member_user_id,
    )
    if deleted == "DELETE 0":
        raise HTTPException(status_code=404, detail="Team member not found")
    # Their login existed only for firm access — delete it, unless the same
    # login is also a unit owner (dual role).
    is_tenant = await conn.fetchval(
        "SELECT 1 FROM tenants WHERE supabase_user_id = $1::uuid", member_user_id,
    )
    if not is_tenant:
        from routes.onboarding import _delete_supabase_user
        await _delete_supabase_user(member_user_id)
    return {"removed": True}


@router.get("/firms")
async def list_firms(
    user: AuthUser = Depends(require_super_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Staff directory of PM firms: who's in each, which associations they
    manage, and a billing snapshot (combined units, monthly total, status).
    Powers the firm grouping + hover card in the super-user settings view."""
    from routes.billing import _GOOD_STANDING, _UNITS_SUBQ, _volume_monthly_cents, _split_portfolio

    firms = await conn.fetch(
        """SELECT f.id, f.name, f.stripe_customer_id,
                  coalesce(array_agg(DISTINCT lower(au.email))
                           FILTER (WHERE au.email IS NOT NULL), '{}') AS members
           FROM pm_firms f
           LEFT JOIN pm_firm_members m ON m.firm_id = f.id
           LEFT JOIN auth.users au ON au.id = m.supabase_user_id
           GROUP BY f.id, f.name, f.stripe_customer_id
           ORDER BY f.name""",
    )
    hoa_rows = await conn.fetch(
        f"""SELECT fh.firm_id, h.id, h.name, h.stripe_customer_id,
                   h.stripe_subscription_id, h.billing_status, {_UNITS_SUBQ} AS units
            FROM pm_firm_hoas fh JOIN hoas h ON h.id = fh.hoa_id
            ORDER BY h.name""",
    )
    hoas_by_firm = {}
    for r in hoa_rows:
        hoas_by_firm.setdefault(r["firm_id"], []).append(r)

    out = []
    for f in firms:
        hoas = hoas_by_firm.get(f["id"], [])
        included, excluded = _split_portfolio(hoas, f["stripe_customer_id"])
        units = sum(h["units"] for h in included)
        # Same derivation as GET /pm/billing: the firm subscription's state
        # lives on the HOA rows stamped with the firm's customer.
        stamped = [h for h in included
                   if f["stripe_customer_id"] and h["stripe_customer_id"] == f["stripe_customer_id"]]
        sub_row = next((h for h in stamped if h["stripe_subscription_id"]), None)
        status = (sub_row["billing_status"] or "none") if sub_row else "none"
        out.append({
            "id": str(f["id"]),
            "name": f["name"],
            "members": list(f["members"]),
            "hoas": [{"id": str(h["id"]), "name": h["name"], "units": h["units"]} for h in hoas],
            "billing": {
                "units": units,
                "monthly_cents": _volume_monthly_cents(units),
                "status": status,
                "has_subscription": bool(sub_row),
                "in_good_standing": status in _GOOD_STANDING,
                "self_paying": len(excluded),
            },
        })
    return out


class TeamSettings(BaseModel):
    name: str | None = None
    open_visibility: bool | None = None
    cab_number: str | None = None
    billing_mode: str | None = None  # 'firm' | 'association'


@router.patch("/pm/team")
async def update_firm_settings(
    body: TeamSettings,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    _require_owner(firm)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Firm name can't be empty.")
        await conn.execute("UPDATE pm_firms SET name = $1 WHERE id = $2", name[:120], firm["id"])
    if body.open_visibility is not None:
        await conn.execute(
            "UPDATE pm_firms SET open_visibility = $1 WHERE id = $2",
            body.open_visibility, firm["id"],
        )
    if body.cab_number is not None:
        await conn.execute(
            "UPDATE pm_firms SET cab_number = $1 WHERE id = $2",
            body.cab_number.strip()[:40] or None, firm["id"],
        )
    if body.billing_mode is not None:
        if body.billing_mode not in ("firm", "association"):
            raise HTTPException(status_code=400, detail="billing_mode must be 'firm' or 'association'.")
        if body.billing_mode == "association" and firm["stripe_customer_id"]:
            # Don't strand a live consolidated subscription: the firm would keep
            # paying while associations start paying too. Cancel it first.
            live = await conn.fetchval(
                """SELECT 1 FROM hoas WHERE stripe_customer_id = $1
                   AND stripe_subscription_id IS NOT NULL
                   AND billing_status IN ('active', 'trialing')""",
                firm["stripe_customer_id"],
            )
            if live:
                raise HTTPException(
                    status_code=400,
                    detail="Your firm has an active consolidated subscription — cancel it via Manage billing before passing billing to the associations.",
                )
        await conn.execute(
            "UPDATE pm_firms SET billing_mode = $1 WHERE id = $2",
            body.billing_mode, firm["id"],
        )
    return {"updated": True}


class MemberAssignments(BaseModel):
    hoa_ids: list[str]


@router.put("/pm/team/members/{member_user_id}/hoas")
async def set_member_assignments(
    member_user_id: str,
    body: MemberAssignments,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Replace a member's association assignments (owner-only). Assignments
    must be within the firm's portfolio — enforced by FK, surfaced as a 400."""
    firm = await _require_firm(conn, user)
    _require_owner(firm)
    is_member = await conn.fetchval(
        "SELECT 1 FROM pm_firm_members WHERE firm_id = $1 AND supabase_user_id = $2::uuid",
        firm["id"], member_user_id,
    )
    if not is_member:
        raise HTTPException(status_code=404, detail="Team member not found")
    async with conn.transaction():
        await conn.execute(
            "DELETE FROM pm_member_hoas WHERE supabase_user_id = $1::uuid", member_user_id,
        )
        try:
            for hoa_id in dict.fromkeys(body.hoa_ids):  # de-dupe, keep order
                await conn.execute(
                    "INSERT INTO pm_member_hoas (firm_id, supabase_user_id, hoa_id) VALUES ($1, $2::uuid, $3::uuid)",
                    firm["id"], member_user_id, hoa_id,
                )
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(status_code=400, detail="One of those associations isn't managed by your firm.")
        except asyncpg.DataError:
            raise HTTPException(status_code=400, detail="Invalid association id.")
    return {"updated": True, "assigned": len(dict.fromkeys(body.hoa_ids))}
