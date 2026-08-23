-- Checklist lead capture. A guide reader enters an email to get the Florida
-- HO-6 compliance checklist page; the address is stored here and surfaced on
-- /admin/leads (super_user) for PERSONAL follow-up. Deliberately no automated
-- email is ever sent to these rows — that keeps the flow outside the
-- outbound-email rules (Resend never mails prospects).
--
-- Writes come only from the public backend endpoint
-- (POST /analytics/checklist-lead), which reuses the analytics rate limiter
-- and bot filter. Emails are lowercased before insert; the UNIQUE constraint
-- keeps first touch (ON CONFLICT DO NOTHING), matching first-touch
-- attribution everywhere else.
CREATE TABLE IF NOT EXISTS guide_leads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,   -- stored lowercased; first touch wins
  source_path text,                   -- the guide page the form was on
  session_id  text,                   -- stitches to events for attribution
  utm         text,                   -- first-touch tag, same as events
  referrer    text,                   -- first-touch referrer, same as events
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- PII: client roles get no access at all; the backend's direct connection
-- (table owner) bypasses RLS. Enabling RLS with no policies denies PostgREST.
ALTER TABLE guide_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON guide_leads FROM PUBLIC, anon, authenticated;
