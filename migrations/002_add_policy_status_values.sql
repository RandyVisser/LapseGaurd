-- Add pending_review and non_compliant to the policy_status enum
ALTER TYPE policy_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE policy_status ADD VALUE IF NOT EXISTS 'non_compliant';
