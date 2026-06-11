-- One login may own multiple units (same or different associations).
-- Replace the one-row-per-user constraint with one-row-per-user-per-unit.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_supabase_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_user_unit_unique
  ON tenants (supabase_user_id, unit_id) WHERE supabase_user_id IS NOT NULL;
