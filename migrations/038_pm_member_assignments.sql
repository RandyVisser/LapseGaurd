-- ALREADY APPLIED to prod via Supabase MCP on 2026-07-12 — do not re-apply.
-- Backfilled into the repo 2026-07-12 so migrations/ stays canonical.

-- Per-PM association assignments within a firm (Troy's model, 2026-07-12).
-- pm_firms.open_visibility=true keeps today's behavior (every member sees the
-- whole portfolio); flipping it to false makes visibility assignment-based:
-- members see only associations they're assigned to (owners always see all).
-- Billing stays firm-level (pm_firm_hoas) regardless of assignments.

ALTER TABLE pm_firms
  ADD COLUMN cab_number text,
  ADD COLUMN open_visibility boolean NOT NULL DEFAULT true;

CREATE TABLE pm_member_hoas (
  firm_id uuid NOT NULL,
  supabase_user_id uuid NOT NULL,
  hoa_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supabase_user_id, hoa_id),
  -- assignments can only reference current members and the firm's own
  -- portfolio, and disappear automatically when either goes away
  FOREIGN KEY (firm_id, supabase_user_id)
    REFERENCES pm_firm_members(firm_id, supabase_user_id) ON DELETE CASCADE,
  FOREIGN KEY (firm_id, hoa_id)
    REFERENCES pm_firm_hoas(firm_id, hoa_id) ON DELETE CASCADE
);
ALTER TABLE pm_member_hoas ENABLE ROW LEVEL SECURITY;
