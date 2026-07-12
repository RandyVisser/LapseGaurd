-- ALREADY APPLIED to prod via Supabase MCP on 2026-07-10 — do not re-apply.
-- Backfilled into the repo 2026-07-12 so migrations/ stays canonical.

-- PM firms: a property-management company as a first-class entity.
-- Members (logins) belong to a firm; the firm manages HOAs; billing hangs
-- off the firm. Replaces the per-user property_manager_hoas mapping and the
-- per-user pm_billing table (both kept for now so the currently-deployed
-- backend keeps working until the code deploy lands; drop later).

CREATE TABLE pm_firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  stripe_customer_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pm_firm_members (
  firm_id uuid NOT NULL REFERENCES pm_firms(id) ON DELETE CASCADE,
  supabase_user_id uuid NOT NULL UNIQUE,  -- one firm per PM login (v1)
  is_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firm_id, supabase_user_id)
);

CREATE TABLE pm_firm_hoas (
  firm_id uuid NOT NULL REFERENCES pm_firms(id) ON DELETE CASCADE,
  hoa_id uuid NOT NULL REFERENCES hoas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firm_id, hoa_id)
);

ALTER TABLE pm_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_firm_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_firm_hoas ENABLE ROW LEVEL SECURITY;

-- Teammate invites are firm-scoped, not HOA-scoped.
ALTER TABLE admin_invites ADD COLUMN firm_id uuid REFERENCES pm_firms(id) ON DELETE CASCADE;
ALTER TABLE admin_invites ALTER COLUMN hoa_id DROP NOT NULL;

-- Backfill: one single-member firm per existing PM login, carrying their HOA
-- mappings and any consolidated-billing Stripe customer. Firm name defaults
-- to the login email (renameable in the Team panel).
DO $$
DECLARE r record; fid uuid;
BEGIN
  FOR r IN SELECT DISTINCT supabase_user_id FROM property_manager_hoas LOOP
    INSERT INTO pm_firms (name, stripe_customer_id)
    VALUES (
      coalesce((SELECT email FROM auth.users WHERE id = r.supabase_user_id), 'Property management firm'),
      (SELECT stripe_customer_id FROM pm_billing WHERE supabase_user_id = r.supabase_user_id)
    )
    RETURNING id INTO fid;
    INSERT INTO pm_firm_members (firm_id, supabase_user_id, is_owner)
    VALUES (fid, r.supabase_user_id, true);
    INSERT INTO pm_firm_hoas (firm_id, hoa_id)
      SELECT fid, hoa_id FROM property_manager_hoas WHERE supabase_user_id = r.supabase_user_id;
  END LOOP;
END $$;
