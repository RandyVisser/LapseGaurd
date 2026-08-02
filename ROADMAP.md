# Feature Backlog

Floating reminder list — knock these out as time allows. Check items off (or
delete them) as they ship; add new ideas at the bottom of the right section.
Effort tags are rough: (S) ≤ half day, (M) ~1 day, (L) multi-day.

## PM-firm growth (north star — physical mailers out as of 07-18: Vista
Royale owners + Broward PM firms + Palm Beach PM firms; Apollo cold email
still unconnected, lookalike domain warming since 07-08)

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

## Organic acquisition (SEO / GEO — started 2026-08-01)

Compounding channel, not a replacement for outbound. The point is that a PM who
gets a mailer and then searches us finds substance. Realistic signal window is
6–12 weeks; nothing here pays off next week.

- [x] **Crawlability foundation** — shipped 2026-08-01: the site was serving
      crawlers `<div id="root"></div>` and nothing else. Google renders JS so
      SEO limped, but LLM crawlers (GPTBot/ClaudeBot/PerplexityBot) mostly
      don't — so AI-answer visibility was *zero*, not low. Added head meta +
      JSON-LD (Organization/WebSite/SoftwareApplication/FAQPage), real
      robots.txt (AI crawlers explicitly allow-listed) and sitemap.xml — both
      previously returned 200 `text/html` because the files didn't exist and the
      SPA catch-all swallowed them. ⚠️ `serve -s` had to go: `-s` implies
      cleanUrls, which 301s `/foo.html` → `/foo` → catch-all, making every
      static page unreachable at HTTP 200. See `frontend/CLAUDE.md`.
- [x] **Seven cited guide pages** — shipped 2026-08-01 at `/guides/*.html`:
      FL insurance requirements · milestone inspections & SIRS · FL insurance
      statistics · loss assessment coverage · dec pages · HO-6 vs HO-4 vs
      wind-only · compliance tracking. Static HTML on purpose (crawlable
      without JS), own `guides.css` — NOT landing.css, whose `.reveal` renders
      blank without JS. Two corrections to things widely published as current
      law: the association force-place power was **repealed in 2010** (SB 1196),
      and the 3-mile coastal milestone trigger **no longer exists** (SB 154,
      2023).
- [x] **Guide analytics + super-user Pages card** — shipped 2026-08-01:
      `guide_view` beacon on the static pages, `/analytics/pages`, and a Pages
      card on /admin/feedback bucketing referrers campaign/ai/search/referral/
      direct. Also fixed a latent bug: first-touch **referrer** was never
      persisted, so a Google → guide → app → signup journey lost the Google
      referrer at the first same-origin click. Organic attribution could not
      have worked before this (`ci.ref`).
- [x] **OG social card** — shipped 2026-08-01: real 1200×630 card replacing the
      transparent logo PNG that cropped badly on social.
- [ ] ⚠️ **REVIEW THE THREE LEGAL PAGES** — requirements, SIRS, loss assessment
      are live and make statutory claims under our brand. All cited to
      flsenate.gov / leg.state.fl.us with not-legal-advice disclaimers, but
      Randy + Troy have not read them. **Only genuinely open risk in this work.**
- [ ] **G2 listing** — Capterra submitted 2026-08-01 (category **HOA**, not
      Association Management — see `docs/g2-capterra-listing-kit.md` §11 for
      why the name misleads). Kit has every answer; G2 is a repeat.
- [ ] **YouTube upload of `tour.mp4`** (S) — G2/Capterra want a YouTube/Vimeo
      URL; a Descript share page and a raw MP4 don't embed reliably.
- [ ] **Reviews for the listings** (3–5) — a listing with none reads abandoned.
      ⚠️ Realistic sources are 3 Island + Vista Royale: **real customers**, so
      needs Randy/Troy OK and must come from a human mailbox, never Resend.
- [ ] **Backlinks** (S each) — the actual bottleneck; a new domain with no
      inbound links won't rank however well it's crawled. LinkedIn company page
      (we have none), **Florida CAI chapter** (most relevant to real buyers),
      Crunchbase, Product Hunt.
- [ ] **Prerender the landing SPA body** (M) — its `<head>` is crawlable now,
      which captures most of the value, but non-JS crawlers still see an empty
      root on `/`, `/privacy`, `/terms`.
- [ ] **Pull the "65% of condo owners are underinsured" stat** (S) — no study
      behind it, and universalcondo.com repeats it. Our statistics page
      explicitly declines to use it; the agency collateral should too.

## Deadlines & housekeeping

- [ ] **Paywall decision + build** — `assert_billing_ok` is still a no-op; all
      three real trials end **2026-10-06**. Decide day-91 behavior (lockout /
      read-only / nag) and build it by September.
- [x] **UTM tracking for outbound** — shipped 2026-07-14 (migration 041):
      first-touch utm/referrer stored per browser, carried on every beacon;
      funnel card shows a "Where visitors came from" breakdown. (2026-07-16:
      analytics now also drops bot UAs, stores coarse device/browser buckets
      (migration 043), counts demo_click/tour_play/vista_royale_view, and
      the events table was cleared for a clean post-filter baseline —
      attribution is first-touch, so tag links BEFORE sending.) 2026-07-28:
      tagging convention + canonical links defined in `docs/utm-conventions.md`
      and handed to dad — apollo/mailer × broward-pm/palmbeach-pm; VR mailers
      stay page-tracked (vista_royale_view). ⚠️ REMAINING: dad must actually
      use the tagged links when Apollo goes live / on the next mailer print.
- [ ] **Live card test: firm checkout** — dad is on it (his test firm, ~$0 now,
      trial carries into Stripe). Verify webhook fans "paid" to all its condos.
- [ ] **Drop legacy tables** (S) — `property_manager_hoas` + `pm_billing`.
      Data-completeness verification DONE 2026-07-15 (every legacy row is
      covered by `pm_firm_*`, `pm_billing` is empty) — just needs the
      go-ahead on timing. (Randy 2026-07-16: hold for now.)
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

- [x] **Auto re-invite on bounced-email fix** — shipped 2026-07-16 (Randy OK'd):
      correcting a bouncing address that had a pending invite re-sends it to
      the new address automatically (owner rows only, placeholder/bouncing new
      addresses skipped). E2E-tested on Sandbox.
- [ ] **Alert links for account-less owners** (M) — renewal/lapse emails link
      to /tenant/dashboard, a login wall for owners who never signed up; link
      a /join/{token} upload page instead. (Touches alert emails — needs OK.)
- [ ] **Inbound auth verification data** (S) — sender-auth check shipped
      2026-07-15 but is fail-open and inert unless Resend's webhook payload
      carries an Authentication-Results header; capture one real inbound
      webhook body to confirm, and tighten if the data is there.
- [x] **Persist ToS acceptance for firm signups** — shipped 2026-07-16
      (migration 044): /onboard/firm stamps tos_accepted_at/version/ip on
      pm_firms; firms from the 07-14→07-16 window legitimately have NULLs.
- [ ] **Supabase Auth: enable leaked-password protection** — one toggle in the
      Supabase dashboard (advisor WARN; can't be set via SQL).
- [x] **Firm-dashboard "needs attention" deep-link** — shipped 2026-07-16
      (Randy chose combined filter): new 'attention' filter covers
      lapsed+non_compliant+missing exactly, the deep link lands on it, and
      the action strip's header toggles it.
