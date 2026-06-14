-- Auto-resend invites to unit owners who haven't accepted yet
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS invite_reminders_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS invite_reminder_days INT DEFAULT 7;
-- Track when each invite was last (re)sent so reminders space out correctly
ALTER TABLE unit_invites ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;
UPDATE unit_invites SET last_sent_at = created_at WHERE last_sent_at IS NULL;
