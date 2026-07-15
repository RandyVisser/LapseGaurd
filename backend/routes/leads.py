"""
Renewal-lead list for the insurance agency (super-user only).

GET /leads/expiring?days=60 — current (non-superseded) owner policies expiring
within the window, across ALL associations, with the owner's best contact
email, carrier, and premium. A read-only lead surface: it never sends email
and never writes anything.

Scope decisions (mirrors the compliance/alerts queries):
- Governing policy = `superseded_by IS NULL`, same as /alerts/run and
  ho6-summary. A wind-excluded HO-6 + wind-only pair yields two rows — both
  renew, both are leads.
- HO-4s are EXCLUDED: those are renter policies; the lead target is owner
  HO-6 renewals.
- Renter sub-units (`parent_unit_id IS NOT NULL`) and PM/ADMIN contact rows
  (`assoc_title` = property manager / admin) are excluded, matching how
  compliance counts filter them.
- Contact email resolves like the alert cron: units.email_primary first,
  tenant-record email fallback, @condo.insure placeholders skipped (null when
  only placeholders exist).
"""
import json
import logging

import asyncpg
from fastapi import APIRouter, Depends

from auth.jwt import AuthUser, require_super_user
from models.db import get_conn

router = APIRouter()
logger = logging.getLogger(__name__)


def _num(v) -> float | None:
    try:
        f = float(v)
        return f if f == f else None  # reject NaN
    except (TypeError, ValueError):
        return None


def _parse_ext(raw) -> dict:
    if isinstance(raw, str):
        try:
            return json.loads(raw) or {}
        except (ValueError, TypeError):
            return {}
    return raw or {}


def _best_email(email_primary, tenant_email) -> str | None:
    """units.email_primary first, tenant email fallback; @condo.insure
    placeholders have no real inbox and are skipped (same rule as alerts)."""
    for addr in (email_primary, tenant_email):
        a = (addr or "").strip()
        if a and not a.lower().endswith("@condo.insure"):
            return a
    return None


@router.get("/leads/expiring")
async def expiring_leads(
    days: int = 60,
    user: AuthUser = Depends(require_super_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    days = max(1, min(days, 180))
    rows = await conn.fetch(
        """SELECT h.name AS hoa_name,
                  u.unit_number,
                  u.owner_primary,
                  u.email_primary,
                  t.id AS tenant_id,
                  t.name AS tenant_name,
                  t.email AS tenant_email,
                  p.insurer,
                  p.policy_number,
                  p.expiration_date,
                  (p.expiration_date - CURRENT_DATE) AS days_left,
                  p.extracted_data
           FROM policies p
           JOIN tenants t ON t.id = p.tenant_id
           JOIN units u ON u.id = t.unit_id
           JOIN hoas h ON h.id = u.hoa_id
           WHERE p.superseded_by IS NULL
             AND p.expiration_date IS NOT NULL
             AND p.expiration_date >= CURRENT_DATE
             AND p.expiration_date <= CURRENT_DATE + make_interval(days => $1)
             AND coalesce(p.coverage_type, '') <> 'ho4'
             AND u.parent_unit_id IS NULL
             AND lower(coalesce(u.assoc_title, '')) NOT IN ('property manager', 'admin')
           ORDER BY p.expiration_date ASC, h.name, u.unit_number""",
        days,
    )

    leads = []
    for r in rows:
        ext = _parse_ext(r["extracted_data"])
        leads.append({
            "tenant_id": str(r["tenant_id"]),
            "hoa_name": r["hoa_name"],
            "unit_number": r["unit_number"],
            "owner": r["owner_primary"] or r["tenant_name"] or None,
            "email": _best_email(r["email_primary"], r["tenant_email"]),
            "insurer": r["insurer"] or ext.get("insurer") or None,
            "policy_number": r["policy_number"],
            "expiration_date": r["expiration_date"].isoformat(),
            "days_left": r["days_left"],
            "premium": _num(ext.get("premium")),
        })

    return {
        "days": days,
        "total": len(leads),
        "within_30": sum(1 for l in leads if l["days_left"] <= 30),
        "within_60": sum(1 for l in leads if l["days_left"] <= 60),
        "leads": leads,
    }
