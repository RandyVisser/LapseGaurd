-- Track addresses that bounced or complained, so the admin can see which
-- invites/notifications never landed. Populated by the Resend bounce webhook.
CREATE TABLE IF NOT EXISTS email_bounces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  type text,            -- 'bounce' | 'complaint'
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_bounces_email_idx ON email_bounces (lower(email));
