-- Repeat reminders to owners whose policy has expired/lapsed until they respond
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS lapsed_reminders_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS lapsed_reminder_days INT DEFAULT 7;
