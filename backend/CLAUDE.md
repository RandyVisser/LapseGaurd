# Backend context

## The one access rule

PM access is a single predicate: `_MAY_SEE` in `services/firms.py` — the firm
manages the association AND (firm is open-visibility OR role ∈ {owner, manager}
OR direct assignment OR group membership). **Never add per-endpoint PM
checks** — one predicate, one audit point; `firm_manages_hoa` (single lookups)
and `visible_hoas_sql` (listing queries) both wrap it.

Roles: owner = billing, firm settings, promotions; manager = people ops
(invite/remove members, assignments, groups), always sees the whole portfolio,
read-only billing (sees cost, can't cancel — deliberate); member = their book.
Ownership transfer is deliberately NOT self-serve (`set_member_role` refuses
owner). Managers can't remove managers. Groups are flat by design — no
nesting, no "primary group"; grants are additive with direct assignments.
Members may add associations (auto-assigned to themselves — the "bring your
book" flow); removal/reassignment stays manager+. CAB# is an attribute on
pm_firms, never a join key (license numbers get typo'd and reissued).

## Billing invariants

- **Volume pricing lives in THREE places that must agree**:
  `_volume_monthly_cents` here, `frontend/src/pricing.js`, and the live
  Stripe Price. Change all or none. The 750→751 price cliff is known and
  accepted ("simplicity sells").
- Groups/assignments must NEVER affect billing — billing reads `pm_firm_hoas`
  only.
- Pass-through (`billing_mode='association'`): each HOA subscribes itself at
  the firm's volume-tier bulk rate, **no $50 minimum (deliberate firm-deal
  incentive)**, via ad-hoc Stripe `price_data`. The rate locks at checkout —
  the nightly sync adjusts quantities, never re-blends rates (known
  limitation, not a bug).
- `proration_behavior='none'` everywhere — quantity changes bill from the
  next invoice, deliberately no mid-cycle prorations.
- Firm auto-delete (association fires its last PM) cancels live Stripe subs
  first (`cancel_firm_subscriptions`); if cancellation fails the firm + login
  are KEPT so the billing portal stays reachable — that's the design, don't
  "fix" the surviving login.
- The daily sync (`sync_billing_quantities`) stamps `hoas.stripe_customer_id`
  onto associations newly added to a subscribed firm (they show paid, start
  being billed) and detaches ones that left (revert to unsubscribed). The
  webhook fans subscription status by customer id — that's why covered HOA
  rows share the firm's customer.
- Webhook signature failures: check `STRIPE_WEBHOOK_SECRET` vs
  `RESEND_WEBHOOK_SECRET` FIRST — both start `whsec_` and they have been
  cross-pasted in Railway before.
- Checkout carries remaining trial into Stripe (`subscription_data.trial_end`,
  ≥48h out) so subscribing mid-trial never shortens the free 90 days.

## Email

- ALL email goes through `services/email.send_email` — it paces to Resend's
  10 req/s cap and retries 429s. A set-but-blank `FROM_NAME` builds a
  malformed From header that silently kills every send.
- Recipient selection: `units.email_primary` first, tenant-record email as
  fallback (tenant rows can hold stale/placeholder addresses).
  `@condo.insure` placeholders and bounced addresses (`email_bounces`) are
  skipped — a bounced address is never mailed again; the fix is the admin
  correcting it (surfaced by the dashboard "Email bouncing" pill), not
  retrying.
- Invites NEVER set or reset a password on an existing account (forwarded-
  invite hijack protection). Existing accounts get metadata-only updates and
  a ToS-only accept page; invites never demote a super_user.

## Alerts / cron

The cron is GitHub Actions → `POST /alerts/run`. `scripts/run_alerts.py
main()` does NOT run in production: **every processor must also be imported
and called in `routes/alerts.py` `/alerts/run`** — this gap has shipped
silently-dead features twice. Throttling is per tenant/type via `alert_log`.

## Data access

- asyncpg with `statement_cache_size=0` (pgbouncer requirement).
- Migrations: numbered SQL in `migrations/` (canonical), applied manually to
  prod before pushing dependent code. Never reuse a number.
- The `'__all__'` sentinel (all-associations view) must never reach
  UUID-typed SQL — keep the guard at the top of new HOA-scoped endpoints.
- Legacy `property_manager_hoas` + `pm_billing`: never read or write; drop is
  a future cleanup requiring verification that `pm_firm_*` data is complete.

## Analytics

The beacon stores no IP/UA (deliberate privacy stance). Funnel tickers
exclude founder emails (`_INTERNAL_EMAILS`) and the `sandbox-%` email pattern
— which is why test logins must use `sandbox-*@condo.insure`. `?notrack=1` on
any page permanently flags that browser via localStorage. The
owners-invited / staff-activated tickers read from the invite tables, not
`events` — clearing events does not reset them.
