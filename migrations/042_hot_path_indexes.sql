-- Hot-path indexes (only 6 indexes existed schema-wide; Postgres doesn't
-- auto-index FK columns, so dashboard loads, compliance summaries, the alert
-- cron's throttle checks, and /leads/expiring were all sequential scans).
-- Also backfills admin_audit_log into the canonical schema history (the table
-- was created out-of-band; the board-report cooldown now depends on it) and
-- revokes public execution of the rls_auto_enable() SECURITY DEFINER function
-- (flagged by the Supabase security advisor; nothing client-side calls it).

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hoa_id     uuid,
  user_id    text,
  user_email text,
  action     text,
  details    jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS units_hoa_id_idx                    ON units (hoa_id);
CREATE INDEX IF NOT EXISTS policies_tenant_id_idx              ON policies (tenant_id);
CREATE INDEX IF NOT EXISTS tenants_unit_id_idx                 ON tenants (unit_id);
CREATE INDEX IF NOT EXISTS alert_log_tenant_type_sent_idx      ON alert_log (tenant_id, alert_type, sent_at DESC);
CREATE INDEX IF NOT EXISTS policies_active_expiration_idx      ON policies (expiration_date) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS unit_invites_unit_id_idx            ON unit_invites (unit_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_created_idx  ON admin_audit_log (action, created_at DESC);

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
