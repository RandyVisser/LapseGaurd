"""
Lightweight, privacy-preserving funnel analytics.
  POST /analytics/event   — public anonymous beacon (no auth, no PII)
  GET  /analytics/funnel  — super-user signup funnel for the last N days

The beacon records only an allow-listed event name, the page path, a random
client session id, and campaign attribution (first-touch utm tag + cross-origin
referrer) — no IP, no UA, no names. It powers the super-user funnel card so we
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
    "invite_accepted", "owner_upload", "demo_click", "tour_play",
}

# Crawler/scripted traffic is dropped at ingest — a public beacon otherwise
# counts every bot hit as a "visit". Substring match on the lowercased UA.
_BOT_MARKERS = (
    "bot", "crawler", "spider", "scrape", "headless", "phantom", "slurp",
    "python", "curl", "wget", "httpx", "go-http", "node-fetch", "axios",
    "lighthouse", "pingdom", "uptime", "monitor", "preview", "facebookexternalhit",
)


def _classify_ua(ua: str):
    """None = bot/scripted (drop the event). Otherwise coarse (device, browser)
    buckets; the raw UA is classified and DISCARDED, never stored."""
    low = (ua or "").lower()
    if not low or any(m in low for m in _BOT_MARKERS):
        return None
    device = "mobile" if any(m in low for m in ("mobi", "android", "iphone", "ipad")) else "desktop"
    if "edg/" in low:
        browser = "edge"
    elif "opr/" in low or "opera" in low:
        browser = "opera"
    elif "firefox/" in low or "fxios/" in low:
        browser = "firefox"
    elif "chrome/" in low or "crios/" in low:
        browser = "chrome"
    elif "safari/" in low:
        browser = "safari"
    else:
        browser = "other"
    return device, browser

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
# Prospect-engagement beacons shown above the owner-activation extras.
_ENGAGEMENT = [
    ("demo_click", "Demo clicks"),
    ("tour_play", "Tour plays"),
]

# Internal/founder/test accounts excluded from the invited/activated counts.
# Sandbox test staff use sandbox-*@condo.insure and are excluded by pattern
# (see _NOT_INTERNAL_SQL), so new test logins never pollute the tickers.
_INTERNAL_EMAILS = [
    "troy@condo.insure", "randy@condo.insure",
    "troy.visser@gmail.com", "randy.redfish@gmail.com",
    "troy@universalcondo.com",
    "testadmin@condo.insure", "randy.redfish+pmtest@gmail.com",
]

# mycondo.insure is Randy's lookalike test domain (e.g. randy@mycondo.insure,
# used for self-serve firm-signup testing) — never a prospect.
_NOT_INTERNAL_SQL = ("lower(email) <> ALL($2::text[]) AND lower(email) NOT LIKE 'sandbox-%' "
                     "AND lower(email) NOT LIKE '%@mycondo.insure'")

# In-memory per-IP rate limit so the public beacon can't bloat the table.
_hits: dict[str, list[datetime]] = defaultdict(list)
_LIMIT, _WINDOW = 300, timedelta(hours=1)


def _rate_ok(request: Request) -> bool:
    # Rightmost X-Forwarded-For entry: appended by Railway's edge, so the
    # client can't spoof its way past the limit (leftmost values are theirs).
    ip = (request.headers.get("X-Forwarded-For")
          or (request.client.host if request.client else "")
          or "?").split(",")[-1].strip()
    now = datetime.utcnow()
    # Evict idle IPs so the dict doesn't grow forever on public bot traffic
    # (a public endpoint sees a new IP per bot; empty lists never expired).
    for stale in [k for k, v in _hits.items() if not v or v[-1] < now - _WINDOW]:
        del _hits[stale]
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
    classified = _classify_ua(request.headers.get("user-agent", ""))
    if classified is None:  # bots/scripts never insert a row
        return Response(status_code=204)
    device, browser = classified
    try:
        payload = json.loads(await request.body() or b"{}")
        name = (payload.get("name") or "").strip()
        if name in _ALLOWED:
            await conn.execute(
                """INSERT INTO events (name, path, session_id, utm, referrer, device, browser)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                name,
                (payload.get("path") or "")[:200] or None,
                (payload.get("session_id") or "")[:64] or None,
                # First-touch campaign tag + cross-origin referrer (client-side
                # filtered) — outbound attribution, still no IP/UA/PII.
                (payload.get("utm") or "")[:200] or None,
                (payload.get("referrer") or "")[:200] or None,
                device, browser,
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

    # Owner invites come from the source of truth (unit_invites), not a beacon —
    # they're sent server-side, so there's no client to fire an event. coalesce
    # covers rows created before last_sent_at existed. Internal emails excluded.
    owners_invited = await conn.fetchval(
        f"""SELECT count(*) FROM unit_invites
           WHERE coalesce(last_sent_at, created_at) > now() - make_interval(days => $1)
             AND {_NOT_INTERNAL_SQL}""",
        days, _INTERNAL_EMAILS,
    ) or 0

    # Invited Admin/PM activations come from the source of truth (admin_invites),
    # not the funnel beacons — invited staff never hit the public signup page.
    # Internal/founder accounts are excluded from the count.
    staff_activated = await conn.fetchval(
        f"""SELECT count(*) FROM admin_invites
           WHERE accepted_at > now() - make_interval(days => $1)
             AND {_NOT_INTERNAL_SQL}""",
        days, _INTERNAL_EMAILS,
    ) or 0

    # Where landing traffic came from: first-touch utm tag if the beacon carried
    # one, else the cross-origin referrer, else "direct". Distinct sessions so a
    # tagged Apollo click counts once, however many pages it views.
    source_rows = await conn.fetch(
        """SELECT coalesce(utm, CASE WHEN referrer IS NOT NULL
                                     THEN 'referral: ' || referrer
                                     ELSE 'direct' END) AS source,
                  count(distinct coalesce(session_id, id::text)) AS sessions
           FROM events
           WHERE name = 'landing_view'
             AND created_at > now() - make_interval(days => $1)
           GROUP BY 1
           ORDER BY sessions DESC
           LIMIT 10""",
        days,
    )

    # What visitors browse on — coarse buckets derived at ingest (raw UA never
    # stored). Rows from before migration 043 have NULL device → 'unknown'.
    device_rows = await conn.fetch(
        """SELECT CASE WHEN device IS NULL THEN 'unknown'
                       ELSE device || ' · ' || coalesce(browser, 'other') END AS device,
                  count(distinct coalesce(session_id, id::text)) AS sessions
           FROM events
           WHERE name = 'landing_view'
             AND created_at > now() - make_interval(days => $1)
           GROUP BY 1
           ORDER BY sessions DESC
           LIMIT 10""",
        days,
    )

    # Per-day breakdown of the same trackers. Days are Eastern-time calendar
    # days (the audience is Florida) — with a rolling now()-N window, every
    # listed day is fully covered. Distinct sessions are counted per day, so a
    # session spanning midnight appears on both days and the column may sum
    # higher than the whole-window funnel count.
    daily_event_rows = await conn.fetch(
        """SELECT (created_at AT TIME ZONE 'America/New_York')::date AS day, name,
                  count(distinct coalesce(session_id, id::text)) AS n
           FROM events
           WHERE created_at > now() - make_interval(days => $1)
           GROUP BY 1, 2""",
        days,
    )
    daily_invited_rows = await conn.fetch(
        f"""SELECT (coalesce(last_sent_at, created_at) AT TIME ZONE 'America/New_York')::date AS day,
                   count(*) AS n
           FROM unit_invites
           WHERE coalesce(last_sent_at, created_at) > now() - make_interval(days => $1)
             AND {_NOT_INTERNAL_SQL}
           GROUP BY 1""",
        days, _INTERNAL_EMAILS,
    )
    daily_staff_rows = await conn.fetch(
        f"""SELECT (accepted_at AT TIME ZONE 'America/New_York')::date AS day, count(*) AS n
           FROM admin_invites
           WHERE accepted_at > now() - make_interval(days => $1)
             AND {_NOT_INTERNAL_SQL}
           GROUP BY 1""",
        days, _INTERNAL_EMAILS,
    )
    by_day: dict = defaultdict(dict)
    for r in daily_event_rows:
        by_day[r["day"]][r["name"]] = r["n"]
    for r in daily_invited_rows:
        by_day[r["day"]]["owners_invited"] = r["n"]
    for r in daily_staff_rows:
        by_day[r["day"]]["staff_activated"] = r["n"]
    # "Today" comes from Postgres so it always agrees with the day-grouping above.
    today = await conn.fetchval("SELECT (now() AT TIME ZONE 'America/New_York')::date")
    daily = [
        {"day": (today - timedelta(days=i)).isoformat(),
         "counts": by_day.get(today - timedelta(days=i), {})}
        for i in range(days)
    ]

    extra = [{"name": n, "label": l, "count": counts.get(n, 0)} for n, l in _ENGAGEMENT]
    extra.append({"name": "owners_invited", "label": "Owners invited", "count": owners_invited})
    extra += [{"name": n, "label": l, "count": counts.get(n, 0)} for n, l in _EXTRA]
    extra.append({"name": "staff_activated", "label": "Invited staff activated", "count": staff_activated})
    return {
        "days": days,
        "funnel": [{"name": n, "label": l, "count": counts.get(n, 0)} for n, l in _FUNNEL],
        "extra": extra,
        "sources": [{"source": r["source"], "sessions": r["sessions"]} for r in source_rows],
        "devices": [{"device": r["device"], "sessions": r["sessions"]} for r in device_rows],
        "daily": daily,
    }
