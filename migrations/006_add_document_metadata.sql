-- Type-specific document fields (e.g. Wind Mitigation inspection details)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata jsonb;
