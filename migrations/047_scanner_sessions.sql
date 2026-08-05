-- Email-security scanners (Proofpoint, Barracuda, Microsoft SafeLinks, ...)
-- detonate every link in an outbound email inside a headless browser with a
-- real-looking UA, so they sail past the ingest bot filter (_BOT_MARKERS in
-- routes/analytics.py) and pollute the funnel — the 2026-08-05 Apollo ramp-up
-- showed ~40 scanner sessions vs ~3 humans in one day.
--
-- Two behavioral tells, calibrated on that day's event-level timings:
--   1. Instant scroll: a landing section beacon (IntersectionObserver) fires
--      <4s after the session's first event. Observed scanners: 1.4–3.4s;
--      slowest real visitor: 6.1s. A headless render "sees" every section at
--      once.
--   2. Burst companion: a shallow session (≤2 events, landing/signup only)
--      whose first event lands within 120s of ≥2 other sessions on the same
--      device+browser bucket. One email detonation = one same-minute cluster
--      of fresh browser profiles (each gets a fresh localStorage session id).
--      Heuristic: 3 real same-browser visitors inside 2 minutes would also
--      match, but at current volume that pattern is overwhelmingly scanners.
--
-- Sessions that complete signup or act in-app (invite_accepted, owner_upload)
-- are never flagged. These are QUERY-TIME views — no events are deleted, and
-- the analytics endpoints read human_events instead of events, so historical
-- numbers are cleaned retroactively and the raw rows stay auditable.

CREATE OR REPLACE VIEW scanner_sessions
WITH (security_invoker = on) AS
WITH s AS (
  SELECT session_id,
         min(created_at) AS first_seen,
         count(*)        AS ev_count,
         min(created_at) FILTER (WHERE name LIKE 'section_%' OR name = 'pricing_view')
                         AS first_depth,
         bool_or(name IN ('signup_completed', 'invite_accepted', 'owner_upload')) AS acted,
         bool_or(name IN ('landing_view', 'signup_started')) AS hit_landing,
         min(device)  AS device,
         min(browser) AS browser
  FROM events
  WHERE session_id IS NOT NULL
  GROUP BY session_id
)
SELECT a.session_id, a.first_seen
FROM s a
WHERE NOT a.acted
  AND (
    a.first_depth - a.first_seen < interval '4 seconds'
    OR (
      a.hit_landing
      AND a.ev_count <= 2
      AND (SELECT count(*) FROM s b
           WHERE b.session_id <> a.session_id
             AND b.device  IS NOT DISTINCT FROM a.device
             AND b.browser IS NOT DISTINCT FROM a.browser
             AND b.first_seen BETWEEN a.first_seen - interval '120 seconds'
                                  AND a.first_seen + interval '120 seconds') >= 2
    )
  );

CREATE OR REPLACE VIEW human_events
WITH (security_invoker = on) AS
SELECT e.*
FROM events e
WHERE e.session_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM scanner_sessions sc WHERE sc.session_id = e.session_id);

-- Supabase's default privileges expose new public-schema objects through the
-- REST API — these views are backend-only (the funnel is super_user-gated).
REVOKE ALL ON scanner_sessions, human_events FROM PUBLIC, anon, authenticated;
