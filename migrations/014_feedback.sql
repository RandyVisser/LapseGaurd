-- In-app feedback / feature requests / help-needed, captured during the pilot.
-- POST /feedback stores a row and emails the super-users; they triage in the
-- super-user inbox (GET/PATCH /feedback).
CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text,
  role text,
  hoa_id uuid,
  page text,
  type text NOT NULL DEFAULT 'feedback',   -- feedback | feature | help
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',       -- new | resolved
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, created_at DESC);
