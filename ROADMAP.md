# Feature Backlog

Floating reminder list — knock these out as time allows. Check items off (or
delete them) as they ship; add new ideas at the bottom of the right section.
Effort tags are rough: (S) ≤ half day, (M) ~1 day, (L) multi-day.

## PM-firm growth (north star — outbound campaign is live)

- [x] **Firm self-serve onboarding** — shipped 2026-07-14: public firm signup
      at /signup/firm (POST /onboard/firm) + persona fork on /signup; a new
      firm lands on an empty portfolio with an add-association CTA. Note: ToS
      acceptance is required but not yet persisted for firm signups (no
      column) — small follow-up if legal recordkeeping matters.
- [ ] **Portfolio digest email for PMs** (M) — weekly summary across the firm's
      associations: newly lapsed, expiring soon, uploads needing review.
      Retention hook; PMs live in email. (On hold pending Randy/Troy OK —
      it's a new automated email.)
- [x] **Firm-level board reports** — shipped 2026-07-14: "Email board reports"
      on the firm dashboard fans out via POST /pm/reports/board/run (reuses
      `build_board_report`; skips missing contacts + bounced addresses;
      20h/HOA cooldown shared with the monthly cron).

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

- [x] **Expiring-soon lead list** — shipped 2026-07-14: /admin/leads
      (super-user, "Leads" in nav) — policies expiring in 30/60/90 days
      across all HOAs with owner contact, insurer, parsed premium + CSV
      export (GET /leads/expiring).
- [ ] **Agent-CC on renewal alerts** (S→M) — owners can add their insurance
      agent's email; alerts CC the agent. Faster compliance + agent network.
      (Needs a migration for the agent-email column + `cc` support in
      send_email — audited 2026-07-14, bumped to M.)

## Deadlines & housekeeping

- [ ] **Paywall decision + build** — `assert_billing_ok` is still a no-op; all
      three real trials end **2026-10-06**. Decide day-91 behavior (lockout /
      read-only / nag) and build it by September.
- [x] **UTM tracking for outbound** — shipped 2026-07-14 (migration 041):
      first-touch utm/referrer stored per browser, carried on every beacon;
      funnel card shows a "Where visitors came from" breakdown. ⚠️ REMAINING
      ACTION: tag the Apollo/mailer links with `utm_source`/`utm_campaign`
      (or short `src=`) params or nothing attributes.
- [ ] **Live card test: firm checkout** — dad is on it (his test firm, ~$0 now,
      trial carries into Stripe). Verify webhook fans "paid" to all its condos.
- [ ] **Drop legacy tables** (S) — `property_manager_hoas` + `pm_billing`.
      Data-completeness verification DONE 2026-07-15 (every legacy row is
      covered by `pm_firm_*`, `pm_billing` is empty) — just needs the
      go-ahead on timing.
- [x] **Pricing page restyle** — stale item: the landing redesign shipped
      2026-06-30, its `#pricing` section is canonical, and `/pricing` now
      redirects there (old `Pricing.jsx` route is gone). Delete this line
      next pass if agreed.

## Later / at scale

- [ ] **Server-side aggregation** for all-associations + firm-portfolio
      dashboards — the per-HOA fan-out is fine at ~10 associations, not at 100.
      (Partial 2026-07-15: hot-path indexes shipped in migration 042, which
      buys a lot of headroom; the sequential per-HOA loop in /pm/overview +
      /pm/associations is the remaining piece — needs pool-level parallelism
      or a single aggregate query, mind pgbouncer's connection budget.)
- [ ] **Multi-vertical expansion** (apartments, marinas, storage) — the 10x
      vision; revisit after the PM-firm engine is proven.

## Small follow-ups from the 2026-07-14/15 audits

- [ ] **Auto re-invite on bounced-email fix** (S–M) — admin corrects a bounced
      address; system re-sends the invite instead of waiting for the admin to
      remember. (Sends email — needs OK.)
- [ ] **Alert links for account-less owners** (M) — renewal/lapse emails link
      to /tenant/dashboard, a login wall for owners who never signed up; link
      a /join/{token} upload page instead. (Touches alert emails — needs OK.)
- [ ] **Inbound auth verification data** (S) — sender-auth check shipped
      2026-07-15 but is fail-open and inert unless Resend's webhook payload
      carries an Authentication-Results header; capture one real inbound
      webhook body to confirm, and tighten if the data is there.
- [ ] **Persist ToS acceptance for firm signups** (S) — required at signup,
      not stored (no column yet).
- [ ] **Supabase Auth: enable leaked-password protection** — one toggle in the
      Supabase dashboard (advisor WARN; can't be set via SQL).
- [ ] **Firm-dashboard "needs attention" deep-link** — clicking the count
      filters to Needs Attention only (no combined lapsed+missing filter
      exists), so the number can exceed the filtered rows. Product call:
      combined filter vs relabel.
