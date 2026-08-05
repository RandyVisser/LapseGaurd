"""
Lightweight, privacy-preserving funnel analytics.
  POST /analytics/event   — public anonymous beacon (no auth, no PII)
  GET  /analytics/funnel  — super-user signup funnel for the last N days

The beacon records only an allow-listed event name, the page path, a random
client session id, campaign attribution (first-touch utm tag + cross-origin
referrer), and coarse buckets derived at ingest and then discarded — device/
browser from the UA, city-level geo from the IP. No IP, no UA, no names is
ever stored. It powers the super-user funnel card so we
can tell a *traffic* problem (no one visiting) from a *conversion* problem
(visiting but bouncing).
"""
import ipaddress
import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta

import asyncpg
import httpx
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
    "vista_royale_view",
    "section_features", "section_stakes", "section_how", "section_faq", "section_cta",
    # Static /guides/ reference pages. Fired by public/guides/guide-analytics.js
    # (the static pages can't import src/analytics.js). These pages exist to earn
    # organic search and AI-answer traffic, so their referrer is the whole point —
    # see /analytics/pages.
    "guide_view",
}

# Landing-page depth — how far down the page visitors get before leaving.
# Order mirrors the page; pricing reuses the existing pricing_view beacon.
_DEPTH = [
    ("landing_view", "Arrived"),
    ("section_features", "Features"),
    ("section_stakes", "The stakes"),
    ("section_how", "How it works"),
    ("pricing_view", "Pricing"),
    ("section_faq", "FAQ"),
    ("section_cta", "Final CTA"),
]

# Crawler/scripted traffic is dropped at ingest — a public beacon otherwise
# counts every bot hit as a "visit". Substring match on the lowercased UA.
# Second layer: email-security scanners (SafeLinks, Proofpoint, ...) use real
# browser UAs and get PAST this filter, so the read queries below go through
# the human_events view (migration 047), which drops sessions with scanner
# behavior (section beacons <4s after arrival, same-minute burst companions)
# at query time — nothing is deleted, and history is cleaned retroactively.
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
# vista_royale_view is the targeted-mailer landing page — its own counter
# because that campaign is tracked by destination page, not utm tag.
_ENGAGEMENT = [
    ("demo_click", "Demo clicks"),
    ("tour_play", "Tour plays"),
    ("vista_royale_view", "Vista Royale visits"),
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


def _client_ip(request: Request) -> str:
    # Rightmost X-Forwarded-For entry: appended by Railway's edge, so the
    # client can't spoof it (leftmost values are theirs).
    return (request.headers.get("X-Forwarded-For")
            or (request.client.host if request.client else "")
            or "?").split(",")[-1].strip()


# Coarse geolocation, same privacy pattern as the device/browser buckets: the
# IP is looked up and DISCARDED — only city/state/country and the CITY-centroid
# lat/lon (not the visitor's position) are stored. geojs.io: free, keyless,
# city-level. Best-effort with a short timeout; failures cache as None so a
# flaky lookup never slows a burst, and NULL columns just read "unknown".
_geo_cache: dict[str, tuple | None] = {}
_GEO_CACHE_MAX = 4096


async def _coarse_geo(ip: str) -> tuple | None:
    """(city, region, country, lat, lon) or None. Never raises."""
    try:
        if not ip or ip == "?" or not ipaddress.ip_address(ip).is_global:
            return None
    except ValueError:
        return None
    if ip in _geo_cache:
        return _geo_cache[ip]
    geo = None
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            r = await client.get(f"https://get.geojs.io/v1/ip/geo/{ip}.json")
        if r.status_code == 200:
            d = r.json()
            geo = (
                (d.get("city") or None),
                (d.get("region") or None),
                (d.get("country_code") or None),
                float(d["latitude"]) if d.get("latitude") else None,
                float(d["longitude"]) if d.get("longitude") else None,
            )
    except Exception:
        logger.debug("geo lookup failed", exc_info=True)
    if len(_geo_cache) >= _GEO_CACHE_MAX:
        _geo_cache.clear()
    _geo_cache[ip] = geo
    return geo


def _rate_ok(request: Request) -> bool:
    ip = _client_ip(request)
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
            geo = await _coarse_geo(_client_ip(request)) or (None,) * 5
            await conn.execute(
                """INSERT INTO events (name, path, session_id, utm, referrer, device, browser,
                                       geo_city, geo_region, geo_country, geo_lat, geo_lon)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)""",
                name,
                (payload.get("path") or "")[:200] or None,
                (payload.get("session_id") or "")[:64] or None,
                # First-touch campaign tag + cross-origin referrer (client-side
                # filtered) — outbound attribution, still no IP/UA/PII.
                (payload.get("utm") or "")[:200] or None,
                (payload.get("referrer") or "")[:200] or None,
                device, browser,
                geo[0], geo[1], geo[2], geo[3], geo[4],
            )
    except Exception:
        logger.debug("dropped malformed analytics event", exc_info=True)
    return Response(status_code=204)


# Referrer host -> (bucket, friendly label). ORDER MATTERS: the AI assistants are
# matched before the plain search engines because several live on a search
# engine's own domain (gemini.google.com would otherwise read as "Google").
_REFERRER_RULES = [
    # AI assistants / answer engines — the GEO surface we actually care about.
    ("gemini.google.com", "ai", "Gemini"),
    ("bard.google.com", "ai", "Gemini"),
    ("chatgpt.com", "ai", "ChatGPT"),
    ("chat.openai.com", "ai", "ChatGPT"),
    ("openai.com", "ai", "ChatGPT"),
    ("perplexity.ai", "ai", "Perplexity"),
    ("claude.ai", "ai", "Claude"),
    ("copilot.microsoft.com", "ai", "Copilot"),
    ("you.com", "ai", "You.com"),
    ("phind.com", "ai", "Phind"),
    # Classic search engines.
    ("google.", "search", "Google"),
    ("bing.com", "search", "Bing"),
    ("duckduckgo.com", "search", "DuckDuckGo"),
    ("search.yahoo.com", "search", "Yahoo"),
    ("ecosia.org", "search", "Ecosia"),
    ("search.brave.com", "search", "Brave"),
    ("yandex.", "search", "Yandex"),
    ("baidu.com", "search", "Baidu"),
]


def _classify_referrer(referrer: str | None, utm: str | None):
    """(bucket, label) for a stored referrer. Buckets: campaign | ai | search |
    referral | direct. A first-touch utm tag wins — that's a tagged outbound
    click we placed deliberately, and it's more specific than the referrer."""
    if utm:
        return "campaign", utm
    if not referrer:
        return "direct", "Direct / none"
    low = referrer.lower()
    for needle, bucket, label in _REFERRER_RULES:
        if needle in low:
            return bucket, label
    # Fall back to the bare host so the long tail stays readable.
    host = low.split("//")[-1].split("/")[0].removeprefix("www.")
    return "referral", host or "Unknown"


@router.get("/analytics/pages")
async def pages(
    days: int = 30,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Traffic to the static /guides/ reference pages, split by where it came
    from. This is how we tell whether the SEO/GEO work is landing: organic
    search and AI-assistant referrals are the whole point of those pages.

    Super-user only. Counts distinct sessions (a session reading three guides is
    one visitor, three views)."""
    if user.role != "super_user":
        raise HTTPException(status_code=403, detail="Super-user only")
    days = max(1, min(days, 365))

    page_rows = await conn.fetch(
        """SELECT path,
                  count(distinct coalesce(session_id, id::text)) AS sessions,
                  count(*) AS views
           FROM human_events
           WHERE name = 'guide_view'
             AND created_at > now() - make_interval(days => $1)
           GROUP BY path
           ORDER BY sessions DESC
           LIMIT 50""",
        days,
    )

    # Raw referrer/utm pairs, bucketed in Python so the rules stay in one place.
    src_rows = await conn.fetch(
        """SELECT referrer, utm,
                  count(distinct coalesce(session_id, id::text)) AS sessions
           FROM human_events
           WHERE name = 'guide_view'
             AND created_at > now() - make_interval(days => $1)
           GROUP BY referrer, utm""",
        days,
    )
    by_source: dict[tuple[str, str], int] = defaultdict(int)
    by_bucket: dict[str, int] = defaultdict(int)
    for r in src_rows:
        bucket, label = _classify_referrer(r["referrer"], r["utm"])
        by_source[(bucket, label)] += r["sessions"]
        by_bucket[bucket] += r["sessions"]

    sources = sorted(
        ({"bucket": b, "label": l, "sessions": n} for (b, l), n in by_source.items()),
        key=lambda s: -s["sessions"],
    )[:15]

    # Per-day guide sessions, so a ranking win shows up as a step change.
    daily_rows = await conn.fetch(
        """SELECT (created_at AT TIME ZONE 'America/New_York')::date AS day,
                  count(distinct coalesce(session_id, id::text)) AS n
           FROM human_events
           WHERE name = 'guide_view'
             AND created_at > now() - make_interval(days => $1)
           GROUP BY 1""",
        days,
    )
    seen = {r["day"]: r["n"] for r in daily_rows}
    today = await conn.fetchval("SELECT (now() AT TIME ZONE 'America/New_York')::date")
    daily = [
        {"day": (today - timedelta(days=i)).isoformat(), "sessions": seen.get(today - timedelta(days=i), 0)}
        for i in range(min(days, 90) - 1, -1, -1)
    ]

    total_sessions = await conn.fetchval(
        """SELECT count(distinct coalesce(session_id, id::text)) FROM human_events
           WHERE name = 'guide_view' AND created_at > now() - make_interval(days => $1)""",
        days,
    ) or 0

    # Did guide readers go on to convert? Joins signups back to sessions that
    # read a guide first — the payoff metric for the whole content effort.
    converted = await conn.fetchval(
        """SELECT count(*) FROM (
             SELECT signup_attribution->>'session_id' AS sid FROM hoas
             WHERE signup_attribution IS NOT NULL
               AND created_at > now() - make_interval(days => $1)
             UNION ALL
             SELECT signup_attribution->>'session_id' FROM pm_firms
             WHERE signup_attribution IS NOT NULL
               AND created_at > now() - make_interval(days => $1)
           ) s
           WHERE s.sid IS NOT NULL AND EXISTS (
             SELECT 1 FROM events e
             WHERE e.session_id = s.sid AND e.name = 'guide_view')""",
        days,
    ) or 0

    return {
        "days": days,
        "total_sessions": total_sessions,
        "converted": converted,
        "buckets": [{"bucket": b, "sessions": n} for b, n in sorted(by_bucket.items(), key=lambda x: -x[1])],
        "pages": [{"path": r["path"], "sessions": r["sessions"], "views": r["views"]} for r in page_rows],
        "sources": sources,
        "daily": daily,
    }


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
           FROM human_events
           WHERE created_at > now() - make_interval(days => $1)
           GROUP BY name""",
        days,
    )
    counts = {r["name"]: r["n"] for r in rows}

    # How many sessions the scanner filter discounted in this window — shown on
    # the card so a quiet funnel next to a loud Apollo campaign is explainable.
    scanners_filtered = await conn.fetchval(
        """SELECT count(*) FROM scanner_sessions
           WHERE first_seen > now() - make_interval(days => $1)""",
        days,
    ) or 0

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
           FROM human_events
           WHERE name = 'landing_view'
             AND created_at > now() - make_interval(days => $1)
           GROUP BY 1
           ORDER BY sessions DESC
           LIMIT 10""",
        days,
    )

    # Where visitors are — coarse city buckets derived at ingest (migration
    # 048; IP never stored). Outbound only targets Florida, so the card maps
    # FL cities and lumps everything else. A session's geo is its first
    # non-null city (one browser = one place at this coarseness). Rows from
    # before 048 have NULL geo → the "unknown" count.
    geo_rows = await conn.fetch(
        """SELECT geo_city, geo_region, geo_country,
                  avg(geo_lat)  AS lat,
                  avg(geo_lon)  AS lon,
                  count(distinct coalesce(session_id, id::text)) AS sessions
           FROM human_events
           WHERE created_at > now() - make_interval(days => $1)
             AND geo_city IS NOT NULL
           GROUP BY 1, 2, 3
           ORDER BY sessions DESC
           LIMIT 100""",
        days,
    )
    geo_unknown = await conn.fetchval(
        """SELECT count(*) FROM (
             SELECT coalesce(session_id, id::text) AS sid,
                    bool_or(geo_city IS NOT NULL) AS has_geo
             FROM human_events
             WHERE created_at > now() - make_interval(days => $1)
             GROUP BY 1) s
           WHERE NOT has_geo""",
        days,
    ) or 0
    geo_fl, geo_outside = [], defaultdict(int)
    for r in geo_rows:
        if r["geo_region"] == "Florida" and r["geo_country"] == "US":
            geo_fl.append({"city": r["geo_city"], "lat": r["lat"], "lon": r["lon"],
                           "sessions": r["sessions"]})
        else:
            where = (f'{r["geo_region"]}, {r["geo_country"]}'
                     if r["geo_country"] == "US" else (r["geo_country"] or "??"))
            geo_outside[where] += r["sessions"]

    # What visitors browse on — coarse buckets derived at ingest (raw UA never
    # stored). Rows from before migration 043 have NULL device → 'unknown'.
    device_rows = await conn.fetch(
        """SELECT CASE WHEN device IS NULL THEN 'unknown'
                       ELSE device || ' · ' || coalesce(browser, 'other') END AS device,
                  count(distinct coalesce(session_id, id::text)) AS sessions
           FROM human_events
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
           FROM human_events
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

    # Conversion stitching: self-serve signups in the window, joined back to
    # their anonymous funnel session (how many distinct days they visited
    # before converting). Internal/sandbox signups excluded by email —
    # hoas.admin_email, or the email stashed in the firm's attribution blob.
    signup_rows = await conn.fetch(
        """SELECT s.name, s.kind, s.created_at, s.attribution,
                  ev.days_seen, ev.first_seen
           FROM (
             SELECT name, 'association' AS kind, created_at,
                    signup_attribution AS attribution,
                    lower(coalesce(admin_email, '')) AS email
             FROM hoas
             WHERE signup_attribution IS NOT NULL
               AND created_at > now() - make_interval(days => $1)
             UNION ALL
             SELECT name, 'firm', created_at, signup_attribution,
                    lower(coalesce(signup_attribution->>'email', ''))
             FROM pm_firms
             WHERE signup_attribution IS NOT NULL
               AND created_at > now() - make_interval(days => $1)
           ) s
           LEFT JOIN LATERAL (
             SELECT count(distinct (e.created_at AT TIME ZONE 'America/New_York')::date) AS days_seen,
                    min(e.created_at) AS first_seen
             FROM events e
             WHERE e.session_id = s.attribution->>'session_id'
           ) ev ON true
           WHERE s.email = '' OR (s.email <> ALL($2::text[])
                 AND s.email NOT LIKE 'sandbox-%'
                 AND s.email NOT LIKE '%@mycondo.insure')
           ORDER BY s.created_at DESC
           LIMIT 20""",
        days, _INTERNAL_EMAILS,
    )

    def _source_of(attr) -> str:
        attr = json.loads(attr) if isinstance(attr, str) else (attr or {})
        if attr.get("utm"):
            return attr["utm"]
        if attr.get("referrer"):
            return "referral: " + attr["referrer"]
        return "direct"

    signups = [
        {"name": r["name"], "kind": r["kind"], "source": _source_of(r["attribution"]),
         "days_seen": r["days_seen"] or 0,
         "first_seen": r["first_seen"].isoformat() if r["first_seen"] else None,
         "created_at": r["created_at"].isoformat() if r["created_at"] else None}
        for r in signup_rows
    ]

    extra = [{"name": n, "label": l, "count": counts.get(n, 0)} for n, l in _ENGAGEMENT]
    extra.append({"name": "owners_invited", "label": "Owners invited", "count": owners_invited})
    extra += [{"name": n, "label": l, "count": counts.get(n, 0)} for n, l in _EXTRA]
    extra.append({"name": "staff_activated", "label": "Invited staff activated", "count": staff_activated})
    return {
        "days": days,
        "scanners_filtered": scanners_filtered,
        "funnel": [{"name": n, "label": l, "count": counts.get(n, 0)} for n, l in _FUNNEL],
        "depth": [{"name": n, "label": l, "count": counts.get(n, 0)} for n, l in _DEPTH],
        "signups": signups,
        "extra": extra,
        "sources": [{"source": r["source"], "sessions": r["sessions"]} for r in source_rows],
        "devices": [{"device": r["device"], "sessions": r["sessions"]} for r in device_rows],
        "geo": {
            "florida": geo_fl,
            "outside": sorted(
                ({"where": w, "sessions": n} for w, n in geo_outside.items()),
                key=lambda x: -x["sessions"])[:8],
            "unknown": geo_unknown,
        },
        "daily": daily,
    }
