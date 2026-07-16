-- Conversion-time identity stitching: the anonymous funnel session that led to
-- a self-serve signup, captured at the moment of conversion. jsonb keys (all
-- optional, sanitized server-side in onboarding.py): session_id (the beacon's
-- ci.sid), utm (first-touch tag), referrer, and for firms the signup email
-- (hoas already has admin_email) so the funnel card can exclude internal
-- signups. NULL for team-created rows and signups predating this migration.
alter table hoas add column if not exists signup_attribution jsonb;
alter table pm_firms add column if not exists signup_attribution jsonb;
