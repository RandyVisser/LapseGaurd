-- Discrete renewal reminder milestones (days before expiration). Default 30/7/1.
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS alert_days int[] DEFAULT '{30,7,1}';
