-- 90-day free trial per association. The clock starts at creation (DB default),
-- so no code path can forget to set it. Existing associations get a full 90
-- days from when this migration runs — not from their creation date — so
-- pilots aren't retroactively expired the day billing turns on.
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE hoas ALTER COLUMN trial_ends_at SET DEFAULT now() + interval '90 days';
UPDATE hoas SET trial_ends_at = now() + interval '90 days' WHERE trial_ends_at IS NULL;
