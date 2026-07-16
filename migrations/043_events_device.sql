-- Coarse device/browser buckets derived from the User-Agent at ingest.
-- The raw UA is classified and DISCARDED (privacy stance unchanged: no IP, no
-- UA stored) — only buckets like 'mobile'/'desktop' and 'chrome'/'safari' land
-- here. Bot/scripted traffic is dropped at ingest and never inserts a row.
-- Rows older than this migration have NULL in both columns ('unknown' in the UI).
ALTER TABLE events ADD COLUMN IF NOT EXISTS device text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS browser text;
