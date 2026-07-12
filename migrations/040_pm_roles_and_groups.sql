-- ALREADY APPLIED to prod via Supabase MCP on 2026-07-12 — do not re-apply.
-- Backfilled into the repo 2026-07-12 so migrations/ stays canonical.

-- Firm Console (design spec 2026-07-12): three-tier roles + AD-style groups.
-- role: owner (billing + settings + promote), manager (people ops, sees all),
-- member (their book). is_owner kept in sync until pre-role deploys are gone.
ALTER TABLE pm_firm_members
  ADD COLUMN role text NOT NULL DEFAULT 'member'
  CHECK (role IN ('owner', 'manager', 'member'));
UPDATE pm_firm_members SET role = 'owner' WHERE is_owner;

-- A group is a named set of PMs plus a set of associations; membership grants
-- the group's whole book (additive with direct assignments; flat, no nesting).
CREATE TABLE pm_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES pm_firms(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pm_group_members (
  group_id uuid NOT NULL REFERENCES pm_groups(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL,
  supabase_user_id uuid NOT NULL,
  PRIMARY KEY (group_id, supabase_user_id),
  FOREIGN KEY (firm_id, supabase_user_id)
    REFERENCES pm_firm_members(firm_id, supabase_user_id) ON DELETE CASCADE
);
CREATE TABLE pm_group_hoas (
  group_id uuid NOT NULL REFERENCES pm_groups(id) ON DELETE CASCADE,
  firm_id uuid NOT NULL,
  hoa_id uuid NOT NULL,
  PRIMARY KEY (group_id, hoa_id),
  FOREIGN KEY (firm_id, hoa_id)
    REFERENCES pm_firm_hoas(firm_id, hoa_id) ON DELETE CASCADE
);
ALTER TABLE pm_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_group_hoas ENABLE ROW LEVEL SECURITY;

-- Teammate invites can carry pre-assigned associations (applied on acceptance).
ALTER TABLE admin_invites ADD COLUMN preassign_hoa_ids uuid[];
