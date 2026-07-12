-- ALREADY APPLIED to prod via Supabase MCP on 2026-07-10 — do not re-apply.
-- Backfilled into the repo 2026-07-12 so migrations/ stays canonical.
--
-- NOTE: superseded the same day by 037 (pm_firms model). pm_billing is LEGACY:
-- new code must never read or write it; drop in a later cleanup.

-- One row per property-manager user: the Stripe customer that holds their
-- consolidated (all-associations) subscription.
CREATE TABLE IF NOT EXISTS pm_billing (
  supabase_user_id uuid PRIMARY KEY,
  stripe_customer_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pm_billing ENABLE ROW LEVEL SECURITY;
