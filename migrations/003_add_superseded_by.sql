-- Track which policy replaced an older one (renewal/newer doc for the same coverage).
-- Superseded policies are ignored by compliance evaluation and shown as history.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES policies(id) ON DELETE SET NULL;
