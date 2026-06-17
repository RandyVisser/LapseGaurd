-- Billing (Stripe) — additive and DORMANT. These columns are nullable / default
-- to an inert state, so existing associations and every current flow are
-- unaffected until BILLING_ENABLED is turned on. Safe to apply anytime.

alter table hoas add column if not exists stripe_customer_id     text;
alter table hoas add column if not exists stripe_subscription_id text;
-- Optional per-association price override (e.g. founding/pilot rate). When null,
-- billing falls back to the STRIPE_PRICE_ID env default.
alter table hoas add column if not exists stripe_price_id        text;
-- none | active | trialing | past_due | canceled | incomplete  (mirrors Stripe)
alter table hoas add column if not exists billing_status         text not null default 'none';
