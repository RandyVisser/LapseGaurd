"""
Lightweight, privacy-preserving funnel analytics.
  POST /analytics/event   — public anonymous beacon (no auth, no PII)
  GET  /analytics/funnel  — super-user signup funnel for the last N days

The beacon records only an allow-listed event name, the page path, and a random
client session id (no IP, no names). It powers the super-user funnel card so we
can tell a *traffic* problem (no one visiting) from a *conversion* problem
(visiting but bouncing).
"""
import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from auth.jwt import AuthUser, get_current_user
from models.db import get_conn

router = APIRouter()
logger = logging.getLogger(__name__)

# Only these names are stored — anything else is silently ignored so the public
# endpoint can't be used to write arbitrary rows.
_ALLOWED = {
    "landing_view", "pricing_view", "signup_started", "signup_completed",
    "invite_accepted", "owner_upload",
}

# The ordered conversion funnel shown in the super-user card.
_FUNNEL = [
    ("landing_view", "Visited the site"),
    ("pricing_view", "Viewed pricing"),
    ("signup_started", "Started signup"),
    ("signup_completed", "Finished signup"),
]
_EXTRA = [
    ("invite_accepted", "Owners accepted invite"),
    ("owner_upload", "Dec pages uploaded"),
]

# Internal/founder accounts excluded from the "Invited staff activated" count.
_INTERNAL_EMAILS = [
    "troy@condo.insure", "randy@condo.insure",
    "troy.visser@gmail.com", "randy.redfish@gmail.com",
    "troy@universalcondo.com",
]

# In-memory per-IP rate limit so the public beacon can't bloat the table.
_hits: dict[str, list[datetime]] = defaultdict(list)
_LIMIT, _WINDOW = 300, timedelta(hours=1)


def _rate_ok(request: Request) -> bool:
    ip = (request.headers.get("X-Forwarded-For")
          or (request.client.host if request.client else "")
          or "?").split(",")[0].strip()
    now = datetime.utcnow()
    recent = [t for t in _hits[ip] if t > now - _WINDOW]
    if len(recent) >= _LIMIT:
        return False
    recent.append(now)
    _hits[ip] = recent
    return True


@router.post("/analytics/event")
async def record_event(request: Request, conn: asyncpg.Connection = Depends(get_conn)):
    """text/plain body (CORS-simple, so navigator.sendBeacon works cross-origin
    without a preflight). Best-effort: a visitor's page must never break."""
    if not _rate_ok(request):
        return Response(status_code=204)
    try:
        payload = json.loads(await request.body() or b"{}")
        name = (payload.get("name") or "").strip()
        if name in _ALLOWED:
            await conn.execute(
                "INSERT INTO events (name, path, session_id) VALUES ($1, $2, $3)",
                name,
                (payload.get("path") or "")[:200] or None,
                (payload.get("session_id") or "")[:64] or None,
            )
    except Exception:
        logger.debug("dropped malformed analytics event", exc_info=True)
    return Response(status_code=204)


@router.get("/analytics/funnel")
async def funnel(
    days: int = 7,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    if user.role != "super_user":
        raise HTTPException(status_code=403, detail="Super-user only")
    days = max(1, min(days, 90))
    rows = await conn.fetch(
        """SELECT name, count(distinct coalesce(session_id, id::text)) AS n
           FROM events
           WHERE created_at > now() - make_interval(days => $1)
           GROUP BY name""",
        days,
    )
    counts = {r["name"]: r["n"] for r in rows}

    # Invited Admin/PM activations come from the source of truth (admin_invites),
    # not the funnel beacons — invited staff never hit the public signup page.
    # Internal/founder accounts are excluded from the count.
    staff_activated = await conn.fetchval(
        """SELECT count(*) FROM admin_invites
           WHERE accepted_at > now() - make_interval(days => $1)
             AND lower(email) <> ALL($2::text[])""",
        days, _INTERNAL_EMAILS,
    ) or 0

    extra = [{"name": n, "label": l, "count": counts.get(n, 0)} for n, l in _EXTRA]
    extra.append({"name": "staff_activated", "label": "Invited staff activated", "count": staff_activated})
    return {
        "days": days,
        "funnel": [{"name": n, "label": l, "count": counts.get(n, 0)} for n, l in _FUNNEL],
        "extra": extra,
    }
