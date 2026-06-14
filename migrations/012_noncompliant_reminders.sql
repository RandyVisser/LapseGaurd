-- Repeat reminders to owners whose policy is on file but non-compliant
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS noncompliant_reminders_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS noncompliant_reminder_days INT DEFAULT 7;
