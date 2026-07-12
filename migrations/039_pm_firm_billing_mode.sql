-- ALREADY APPLIED to prod via Supabase MCP on 2026-07-12 — do not re-apply.
-- Backfilled into the repo 2026-07-12 so migrations/ stays canonical.

-- Who pays for the portfolio: the firm (one consolidated subscription,
-- default/current behavior) or each association individually at the firm's
-- bulk (volume-tier) rate.
ALTER TABLE pm_firms
  ADD COLUMN billing_mode text NOT NULL DEFAULT 'firm'
  CHECK (billing_mode IN ('firm', 'association'));
