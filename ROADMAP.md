# Feature Backlog

Floating reminder list — knock these out as time allows. Check items off (or
delete them) as they ship; add new ideas at the bottom of the right section.
Effort tags are rough: (S) ≤ half day, (M) ~1 day, (L) multi-day.

## PM-firm growth (north star — outbound campaign is live)

- [ ] **Firm self-serve onboarding** (L) — the front door for Apollo prospects:
      PM firm signs up → creates firm → adds associations → CSV-imports each
      one's owners. Today firms only form one association-side invite at a time.
- [ ] **Portfolio digest email for PMs** (M) — weekly summary across the firm's
      associations: newly lapsed, expiring soon, uploads needing review.
      Retention hook; PMs live in email.
- [ ] **Firm-level board reports** (S) — one click generates each association's
      board report for the PM to forward. Reuses `build_board_report`.

## Core compliance hardening

- [x] **Bounce handling, remaining slice** — shipped 2026-07-11: alert cron
      skips bounced addresses (falling back to the owner's other email when
      only one bounced) and the dashboard's needs-attention strip shows an
      "Email bouncing" pill that filters to the affected units.
- [ ] **Most-current dec page AI agent** (M) — when a unit has multiple uploads,
      have Claude pick the governing one instead of trusting upload order.
- [ ] **Master policy tracking** (M) — track the association's own building
      policy (same parsing pipeline, new policy type). Natural agency upsell at
      renewal.
- [ ] **SMS reminders** (M) — Twilio texts for lapsed/expiring policies; owners
      ignore email. Needs opt-in handling.

## Insurance revenue engine (dad's commissions)

- [ ] **Expiring-soon lead list** (S) — super-user view: policies expiring in
      30/60 days with owner contact, insurer, premium. A renewal-lead calendar
      from data we already parse.
- [ ] **Agent-CC on renewal alerts** (S) — owners can add their insurance
      agent's email; alerts CC the agent. Faster compliance + agent network.

## Deadlines & housekeeping

- [ ] **Paywall decision + build** — `assert_billing_ok` is still a no-op; all
      three real trials end **2026-10-06**. Decide day-91 behavior (lockout /
      read-only / nag) and build it by September.
- [ ] **UTM tracking for outbound** (S) — tag Apollo links, store query/referrer
      in the analytics beacon so funnel tickers count prospects, not bots.
- [ ] **Live card test: firm checkout** — dad is on it (his test firm, ~$0 now,
      trial carries into Stripe). Verify webhook fans "paid" to all its condos.
- [ ] **Drop legacy tables** (S) — `property_manager_hoas` + `pm_billing` once
      the firm model has been stable in prod for a while.
- [ ] **Pricing page restyle** — still on the old brand (see BRANDING.md); port
      the lapsegaurd-promo landing redesign to `Landing.jsx` while at it.

## Later / at scale

- [ ] **Server-side aggregation** for all-associations + firm-portfolio
      dashboards — the per-HOA fan-out is fine at ~10 associations, not at 100.
- [ ] **Multi-vertical expansion** (apartments, marinas, storage) — the 10x
      vision; revisit after the PM-firm engine is proven.
