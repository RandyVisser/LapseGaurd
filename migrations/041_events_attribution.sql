-- Outbound-campaign attribution for the funnel beacons: first-touch UTM/tag
-- string (Apollo links) and the cross-origin referrer, so the funnel's sources
-- breakdown can tell prospects from bots. Both nullable; still no IP/UA/PII.
ALTER TABLE events ADD COLUMN IF NOT EXISTS utm text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS referrer text;
