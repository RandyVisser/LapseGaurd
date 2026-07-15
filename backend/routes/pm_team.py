"""PM firm team management — a property manager runs their own roster.

One invite gives a colleague the firm's entire portfolio (present and future
associations), instead of the old per-user-per-association invites. Owner-only
actions: invite, revoke, remove, rename; every member can view the roster.
"""
import logging
import secrets
from datetime import datetime, timezone

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
    if firm["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the firm owner can do that.")


def _require_manager(firm):
    """People ops — owners and managing members."""
    if firm["role"] not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Only owners and managers can manage the team.")


@router.get("/pm/team")
async def get_team(
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    members = await conn.fetch(
        """SELECT m.supabase_user_id, m.is_owner, m.role, m.created_at, au.email,
                  au.last_sign_in_at,
                  coalesce(array_agg(a.hoa_id) FILTER (WHERE a.hoa_id IS NOT NULL), '{}') AS assigned
           FROM pm_firm_members m
           LEFT JOIN auth.users au ON au.id = m.supabase_user_id
           LEFT JOIN pm_member_hoas a ON a.supabase_user_id = m.supabase_user_id
           WHERE m.firm_id = $1
           GROUP BY m.supabase_user_id, m.is_owner, m.role, m.created_at, au.email, au.last_sign_in_at
           ORDER BY (m.role = 'owner') DESC, (m.role = 'manager') DESC, m.created_at""",
        firm["id"],
    )
    pending = await conn.fetch(
        """SELECT id, email, created_at, preassign_hoa_ids FROM admin_invites
           WHERE firm_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
           ORDER BY created_at""",
        firm["id"],
    )
    # The firm's portfolio, for the assignment checkboxes. Owners/managers get
    # the full list — under assignment-based visibility a plain member
    # shouldn't learn the firm's other accounts from the team panel.
    portfolio = []
    if firm["role"] in ("owner", "manager") or firm["open_visibility"]:
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
        "is_owner": firm["role"] == "owner",
        "role": firm["role"],
        "hoas": portfolio,
        "members": [
            {
                "user_id": str(m["supabase_user_id"]),
                "email": m["email"],
                "is_owner": m["role"] == "owner",
                "role": m["role"],
                "you": str(m["supabase_user_id"]) == str(user.sub),
                "assigned_hoa_ids": [str(h) for h in m["assigned"]],
                "last_sign_in": m["last_sign_in_at"].isoformat() if m["last_sign_in_at"] else None,
            }
            for m in members
        ],
        "pending": [
            {"id": str(p["id"]), "email": p["email"], "sent_at": p["created_at"].isoformat(),
             # For resend: re-inviting replaces the pending row, so the caller
             # passes these back or the pre-assignments would be wiped.
             "hoa_ids": [str(h) for h in (p["preassign_hoa_ids"] or [])]}
            for p in pending
        ],
    }


class TeamInvite(BaseModel):
    email: str
    hoa_ids: list[str] = []  # pre-assign: applied when the invite is accepted


@router.post("/pm/team/invite", status_code=201)
async def invite_teammate(
    body: TeamInvite,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    _require_manager(firm)
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

    # Pre-assignments must be inside the firm's portfolio.
    preassign = list(dict.fromkeys(body.hoa_ids))
    if preassign:
        valid = await conn.fetchval(
            "SELECT count(*) FROM pm_firm_hoas WHERE firm_id = $1 AND hoa_id = ANY($2::uuid[])",
            firm["id"], preassign,
        )
        if valid != len(preassign):
            raise HTTPException(status_code=400, detail="One of those associations isn't managed by your firm.")

    # Re-inviting replaces the previous pending link.
    await conn.execute(
        "DELETE FROM admin_invites WHERE firm_id = $1 AND lower(email) = $2 AND accepted_at IS NULL",
        firm["id"], email,
    )
    token = secrets.token_urlsafe(32)
    await conn.execute(
        "INSERT INTO admin_invites (firm_id, email, token, role, preassign_hoa_ids) "
        "VALUES ($1, $2, $3, 'property_manager', $4::uuid[])",
        firm["id"], email, token, preassign or None,
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
    _require_manager(firm)
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
    _require_manager(firm)
    if str(member_user_id) == str(user.sub):
        raise HTTPException(status_code=400, detail="You can't remove yourself.")
    target_role = await conn.fetchval(
        "SELECT role FROM pm_firm_members WHERE firm_id = $1 AND supabase_user_id = $2::uuid",
        firm["id"], member_user_id,
    )
    if target_role == "owner":
        raise HTTPException(status_code=403, detail="The firm owner can't be removed.")
    if target_role == "manager" and firm["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can remove a manager.")
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


# ── Firm console: portfolio overview + associations registry ─────────────────

async def _visible_portfolio(conn, user_id: str):
    """(firm, [hoa rows]) this login may see — role-and-group scoped, so a
    member's console is computed over their book only."""
    from services.firms import visible_hoas_sql
    firm = await user_firm(conn, user_id)
    if not firm:
        return None, []
    rows = await conn.fetch(
        f"""SELECT h.id, h.name, h.billing_status, h.stripe_subscription_id, h.trial_ends_at
            FROM hoas h WHERE h.id IN ({visible_hoas_sql('$1')}) ORDER BY h.name""",
        user_id,
    )
    return firm, rows


@router.get("/pm/overview")
async def pm_overview(
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Firm console Overview tab: KPIs + needs-attention counts + the
    lowest-compliance associations, aggregated server-side in one request.
    Uses the same per-HOA summary builder as the association dashboard."""
    if user.role != "property_manager":
        raise HTTPException(status_code=403, detail="Property-manager account required")
    from routes.hoa import build_compliance_summary
    firm, hoas = await _visible_portfolio(conn, user.sub)
    if not firm:
        raise HTTPException(status_code=400, detail="No firm found for this account yet.")

    totals = {"units": 0, "compliant": 0, "manually_approved": 0, "expiring": 0,
              "lapsed": 0, "non_compliant": 0, "pending_review": 0, "missing": 0,
              "invite_sent": 0, "not_invited": 0, "bounced_emails": 0}
    per_hoa = []
    for h in hoas:
        s = await build_compliance_summary(conn, str(h["id"]))
        totals["units"] += s.total_units
        for k in list(totals.keys())[1:]:
            totals[k] += getattr(s, k)
        ok = s.compliant + s.manually_approved
        per_hoa.append({
            "id": str(h["id"]), "name": h["name"], "units": s.total_units,
            "compliance_pct": round(ok / s.total_units * 100) if s.total_units else None,
            "needs_attention": s.lapsed + s.non_compliant + s.missing,
        })
    covered = totals["compliant"] + totals["manually_approved"]
    team = await conn.fetchval(
        "SELECT count(*) FROM pm_firm_members WHERE firm_id = $1", firm["id"],
    )
    worst = sorted([p for p in per_hoa if p["compliance_pct"] is not None],
                   key=lambda p: p["compliance_pct"])[:5]
    return {
        "firm": {"id": str(firm["id"]), "name": firm["name"]},
        "role": firm["role"],
        "open_visibility": firm["open_visibility"],
        "associations": len(hoas),
        "units": totals["units"],
        "compliance_pct": round(covered / totals["units"] * 100) if totals["units"] else None,
        "team_size": team,
        "attention": {k: totals[k] for k in
                      ("lapsed", "non_compliant", "missing", "pending_review", "bounced_emails")},
        "worst": worst,
    }


@router.get("/pm/associations")
async def pm_associations(
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Firm console Associations tab: the registry — compliance, units,
    assigned PMs, billing state per association this login may see."""
    if user.role != "property_manager":
        raise HTTPException(status_code=403, detail="Property-manager account required")
    from routes.hoa import build_compliance_summary
    firm, hoas = await _visible_portfolio(conn, user.sub)
    if not firm:
        raise HTTPException(status_code=400, detail="No firm found for this account yet.")

    assigned_rows = await conn.fetch(
        """SELECT a.hoa_id, au.email FROM pm_member_hoas a
           JOIN auth.users au ON au.id = a.supabase_user_id
           WHERE a.firm_id = $1""",
        firm["id"],
    )
    assigned_by_hoa = {}
    for r in assigned_rows:
        assigned_by_hoa.setdefault(r["hoa_id"], []).append(r["email"])

    out = []
    for h in hoas:
        s = await build_compliance_summary(conn, str(h["id"]))
        ok = s.compliant + s.manually_approved
        trial_active = h["trial_ends_at"] and h["trial_ends_at"] > datetime.now(timezone.utc)
        out.append({
            "id": str(h["id"]),
            "name": h["name"],
            "units": s.total_units,
            "compliance_pct": round(ok / s.total_units * 100) if s.total_units else None,
            "needs_attention": s.lapsed + s.non_compliant + s.missing,
            "assigned": sorted(assigned_by_hoa.get(h["id"], [])),
            "billing_status": h["billing_status"] or "none",
            "has_subscription": bool(h["stripe_subscription_id"]),
            "trial_active": bool(trial_active),
            "trial_days_left": max((h["trial_ends_at"] - datetime.now(timezone.utc)).days, 0)
                               if trial_active else None,
        })
    return {"firm_billing_mode": firm["billing_mode"], "role": firm["role"],
            "open_visibility": firm["open_visibility"], "hoas": out}


class FirmAddAssociation(BaseModel):
    name: str
    address: str
    board_email: str | None = None  # optional: invite a board admin later


@router.post("/pm/associations", status_code=201)
async def firm_add_association(
    body: FirmAddAssociation,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """The firm front door: a PM creates an association under the firm's
    portfolio, auto-assigned to themselves (they brought their book). Any
    member may add; removing/reassigning stays manager+. Units come next via
    the existing import wizard on the association's dashboard."""
    firm = await _require_firm(conn, user)
    name = (body.name or "").strip()
    address = (body.address or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Association name is required.")
    dupe = await conn.fetchval(
        """SELECT 1 FROM pm_firm_hoas fh JOIN hoas h ON h.id = fh.hoa_id
           WHERE fh.firm_id = $1 AND lower(h.name) = lower($2)""",
        firm["id"], name,
    )
    if dupe:
        raise HTTPException(status_code=400, detail="Your firm already manages an association with that name.")
    hoa_id = await conn.fetchval(
        "INSERT INTO hoas (name, address, admin_email) VALUES ($1, $2, $3) RETURNING id",
        name, address or None, (body.board_email or "").strip() or None,
    )
    from services.firms import map_hoa_to_firm, assign_member_hoa
    await map_hoa_to_firm(conn, firm["id"], hoa_id)
    await assign_member_hoa(conn, firm["id"], user.sub, hoa_id)

    board_email = (body.board_email or "").strip()
    if board_email:
        from routes.onboarding import _create_staff_invite
        from services.email import welcome_admin_html
        token = await _create_staff_invite(conn, hoa_id, board_email, "hoa_admin")
        subject, html = welcome_admin_html("", name, setup_url=f"{APP_URL}/admin-setup/{token}")
        background_tasks.add_task(send_email, board_email, subject, html)

    return {"hoa_id": str(hoa_id), "name": name, "board_invited": bool(board_email)}


class MemberRole(BaseModel):
    role: str  # 'manager' | 'member'


@router.patch("/pm/team/members/{member_user_id}")
async def set_member_role(
    member_user_id: str,
    body: MemberRole,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Promote/demote between manager and member (owner-only). Ownership
    transfer is deliberately not a self-serve action."""
    firm = await _require_firm(conn, user)
    _require_owner(firm)
    if body.role not in ("manager", "member"):
        raise HTTPException(status_code=400, detail="Role must be 'manager' or 'member'.")
    if str(member_user_id) == str(user.sub):
        raise HTTPException(status_code=400, detail="You can't change your own role.")
    updated = await conn.execute(
        "UPDATE pm_firm_members SET role = $1, is_owner = false "
        "WHERE firm_id = $2 AND supabase_user_id = $3::uuid AND role <> 'owner'",
        body.role, firm["id"], member_user_id,
    )
    if updated == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Team member not found")
    return {"updated": True, "role": body.role}


# ── Groups: a named set of PMs covering a named set of associations ──────────
# Membership grants the group's whole book (additive with direct assignments).

class GroupIn(BaseModel):
    name: str | None = None
    color: str | None = None
    member_ids: list[str] | None = None  # replace when present
    hoa_ids: list[str] | None = None     # replace when present


@router.get("/pm/groups")
async def list_groups(
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    _require_manager(firm)
    groups = await conn.fetch(
        "SELECT id, name, color FROM pm_groups WHERE firm_id = $1 ORDER BY created_at", firm["id"],
    )
    members = await conn.fetch(
        "SELECT group_id, supabase_user_id FROM pm_group_members WHERE firm_id = $1", firm["id"],
    )
    hoas = await conn.fetch(
        "SELECT group_id, hoa_id FROM pm_group_hoas WHERE firm_id = $1", firm["id"],
    )
    m_by, h_by = {}, {}
    for r in members:
        m_by.setdefault(r["group_id"], []).append(str(r["supabase_user_id"]))
    for r in hoas:
        h_by.setdefault(r["group_id"], []).append(str(r["hoa_id"]))
    return [
        {"id": str(g["id"]), "name": g["name"], "color": g["color"],
         "member_ids": m_by.get(g["id"], []), "hoa_ids": h_by.get(g["id"], [])}
        for g in groups
    ]


@router.post("/pm/groups", status_code=201)
async def create_group(
    body: GroupIn,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    _require_manager(firm)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name can't be empty.")
    gid = await conn.fetchval(
        "INSERT INTO pm_groups (firm_id, name, color) VALUES ($1, $2, $3) RETURNING id",
        firm["id"], name[:60], (body.color or "").strip()[:20] or None,
    )
    return {"id": str(gid), "name": name[:60]}


async def _replace_group_set(conn, table: str, id_col: str, group_id, firm_id, ids: list[str]):
    await conn.execute(f"DELETE FROM {table} WHERE group_id = $1", group_id)
    try:
        for x in dict.fromkeys(ids):
            await conn.execute(
                f"INSERT INTO {table} (group_id, firm_id, {id_col}) VALUES ($1, $2, $3::uuid)",
                group_id, firm_id, x,
            )
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(status_code=400, detail="Only current members and your firm's own associations can go in a group.")
    except asyncpg.DataError:
        raise HTTPException(status_code=400, detail="Invalid id.")


@router.patch("/pm/groups/{group_id}")
async def update_group(
    group_id: str,
    body: GroupIn,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    _require_manager(firm)
    owned = await conn.fetchval(
        "SELECT 1 FROM pm_groups WHERE id = $1::uuid AND firm_id = $2", group_id, firm["id"],
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Group not found")
    async with conn.transaction():
        if body.name is not None and body.name.strip():
            await conn.execute("UPDATE pm_groups SET name = $1 WHERE id = $2::uuid",
                               body.name.strip()[:60], group_id)
        if body.color is not None:
            await conn.execute("UPDATE pm_groups SET color = $1 WHERE id = $2::uuid",
                               body.color.strip()[:20] or None, group_id)
        if body.member_ids is not None:
            await _replace_group_set(conn, "pm_group_members", "supabase_user_id",
                                     await conn.fetchval("SELECT id FROM pm_groups WHERE id=$1::uuid", group_id),
                                     firm["id"], body.member_ids)
        if body.hoa_ids is not None:
            await _replace_group_set(conn, "pm_group_hoas", "hoa_id",
                                     await conn.fetchval("SELECT id FROM pm_groups WHERE id=$1::uuid", group_id),
                                     firm["id"], body.hoa_ids)
    return {"updated": True}


@router.delete("/pm/groups/{group_id}")
async def delete_group(
    group_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    firm = await _require_firm(conn, user)
    _require_manager(firm)
    deleted = await conn.execute(
        "DELETE FROM pm_groups WHERE id = $1::uuid AND firm_id = $2", group_id, firm["id"],
    )
    if deleted == "DELETE 0":
        raise HTTPException(status_code=404, detail="Group not found")
    return {"deleted": True}


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
    _require_manager(firm)
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
