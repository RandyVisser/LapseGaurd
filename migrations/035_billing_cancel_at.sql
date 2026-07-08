-- When a subscription is set to cancel at period end (the Stripe portal's
-- default cancel), it stays active/trialing until that date. Store the date so
-- the Billing panel can say "canceled — access ends <date>" instead of looking
-- like a normal subscription. NULL = not scheduled to cancel.
ALTER TABLE hoas ADD COLUMN IF NOT EXISTS billing_cancel_at timestamptz;
