-- Coarse geolocation buckets for funnel events, resolved from the client IP at
-- ingest and stored WITHOUT the IP (same pattern as the device/browser buckets
-- from 043: the raw identifier is classified and discarded, never stored — the
-- privacy stance is unchanged). lat/lon are the CITY centroid returned by the
-- geo lookup, not the visitor's location. Outbound (mailers + Apollo) only
-- targets Florida, so the feedback tab's map uses these to split FL traffic
-- from irrelevant/bot traffic. Rows older than this migration stay NULL
-- ('unknown' in the UI); lookup failures also store NULL.
ALTER TABLE events ADD COLUMN IF NOT EXISTS geo_city text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS geo_region text;   -- state/region name, e.g. 'Florida'
ALTER TABLE events ADD COLUMN IF NOT EXISTS geo_country text;  -- ISO code, e.g. 'US'
ALTER TABLE events ADD COLUMN IF NOT EXISTS geo_lat real;
ALTER TABLE events ADD COLUMN IF NOT EXISTS geo_lon real;

-- human_events (047) froze events' column list when it was created (SELECT
-- e.* expands at CREATE time), so it must be recreated to expose the new geo
-- columns. Same definition + grants as 047 otherwise.
DROP VIEW IF EXISTS human_events;
CREATE VIEW human_events
WITH (security_invoker = on) AS
SELECT e.*
FROM events e
WHERE e.session_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM scanner_sessions sc WHERE sc.session_id = e.session_id);

REVOKE ALL ON human_events FROM PUBLIC, anon, authenticated;
