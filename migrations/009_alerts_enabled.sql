-- Toggle renewal alerts on/off per association
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN DEFAULT TRUE;
