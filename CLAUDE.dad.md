# CLAUDE.dad.md — tacit knowledge handoff (DRAFT)

Draft knowledge capture for the team-account handoff. Written to be merged into
the main docs later — **do not merge into CLAUDE.md yet**; that file is being
rewritten separately. Items marked **[CONFIRM]** were not fully confirmed and
need a check before merge.

## 1. Business context

**condo.insure is two businesses in one.** It's a SaaS product *and* a
lead-generation funnel for the family insurance agency (universalcondo.com).
Renewal/lapse alerts carry agency quote links, and the parsed dec-page data
(expirations, carriers, premiums) doubles as a renewal-lead source — ROADMAP's
"insurance revenue engine." Feature priorities often serve the agency channel,
not just SaaS metrics; don't "clean up" quote links or de-prioritize parsing
fields that look unused by the dashboard.

**Naming:** condo.insure is the canonical brand. "LapseGuard" is the legacy
internal codename; the repo spelling "LapseGaurd" is a known typo, deliberately
left (not worth the churn). Keep the `lapseguard.*` localStorage key prefix —
renaming it silently resets every user's saved preferences.

**North star:** PM firms managing multi-association portfolios (see ROADMAP).
Volume pricing, the firm console, and consolidated billing all exist to serve
that motion.

## 2. Rationale — deliberate choices that look wrong

- **No SDKs, on purpose.** Supabase via raw REST + asyncpg; Resend via raw
  httpx. Fewer dependencies, full control, easier debugging. New code should
  follow suit — don't introduce `supabase-py` or the `resend` package.
- **Volume pricing over graduated.** One count × one rate is easier to quote
  and understand ("simplicity sells"). The cliff — 751 units costs less than
  750 — is known and accepted. `_volume_monthly_cents()` in
  `backend/routes/billing.py` must mirror the Stripe volume price (the $50
  minimum is modeled in Stripe as a flat fee on the 1–50 tier); change both
  together or invoices diverge from the UI.
- **Firm bulk rate has NO $50 minimum** — that's the firm-deal incentive, not
  an oversight.
- **Invites can never set or reset a password on an existing account.** A
  forwarded invite email must not let a third party hijack an account.
  Existing accounts get metadata-only updates and a TOS-only accept page;
  invites never demote a super_user.
- **Alerts email `units.email_primary` first**, tenant-record email only as
  fallback — tenant rows can hold stale/placeholder addresses;
  `@condo.insure` placeholders are skipped.
- **Manual approval lives in `policies.review_overrides.manual_approval`
  (jsonb)**, not a column — it records who/when/why and forces the unit
  compliant until withdrawn.
- **Import dedup key is (street_address, unit_number).** Unit numbers repeat
  across buildings; unit_number alone is NOT unique in an association.
- **B2 backup is append-only** (`rclone copy`, never `sync`) so a doc deleted
  in Supabase is never deleted from the backup. Don't "optimize" it.
- **Inbound email lives on a subdomain** (inbound.condo.insure) because the
  apex MX points at Google Workspace; docs@condo.insure cannot reach Resend.
- **`www.condo.insure` is canonical** — the bare domain 301s, so bare links in
  emails add a redirect hop.
- **Billing quantity sync uses `proration_behavior='none'`** — quantity
  changes apply from the next invoice, deliberately no mid-cycle prorations.
- **Password reset uses the `token_hash` flow consumed client-side**
  (`verifyOtp`) so email-scanner prefetches don't burn the one-time token.
  Don't simplify to Supabase's verify-GET redirect.

## 3. Gotchas / load-bearing weirdness

- **Dev talks to PRODUCTION Supabase.** There is no staging (wanted before the
  team grows — treat as future work). **Sandbox Condo** (id
  `00000000-0000-0000-0000-000000000001`) is the only safe HOA; **3 Island and
  Vista Royale are real customers with real owner emails.**
- **The units table doubles as a contact list.** `assoc_title='Property
  Manager'` rows all share unit_number `'PM'`; Admin rows use `'ADMIN'`.
  They're filtered out of compliance counts, and this is partly why
  unit_number has no unique constraint.
- **Renter sub-units** have `parent_unit_id` set and are excluded from
  association counts and billing.
- **The `'__all__'` sentinel** (all-associations view) must never reach
  UUID-typed SQL — guards exist at endpoint tops; keep them when adding
  endpoints.
- **`_compliance_status_by_tenant` returns a 3-tuple including its empty-case
  return.** A 2-tuple early return once 500'd every empty association. Update
  *every* return when changing arity.
- **`.reveal` in landing.css is opacity:0 until an IntersectionObserver adds
  `.in`.** Any new page reusing landing.css classes renders blank sections
  without wiring the observer (bit us on /vista_royale).
- **Every `VITE_*` var must be ARG+ENV in `frontend/Dockerfile.prod`** or
  Railway silently drops it from the build.
- **All email must go through `services/email.send_email`** — it paces to
  Resend's 10 req/s account cap and retries 429s. Also: `FROM_NAME`
  set-but-blank builds a malformed From header that silently kills ALL sends.
- **`/alerts/run` must import every alert processor** —
  `scripts/run_alerts.py main()` is NOT what the cron executes; a processor
  added only to the script never runs in production.
- **Two migrations are numbered 005** (historical). Never reuse a number going
  forward; take the next integer.
- **Known bug:** the Add-Emails wizard still matches units by unit number
  alone — wrong matches possible in multi-building associations (pending fix).
- **AI-extracted summary fields** (premium, Coverage C, wind-mit credit, water
  exclusion) populate only on new parses; re-parse is idempotent via an
  `ho6_reparsed_at` stamp (`force_since` re-parses everything once). Treat the
  flag lists as "worth reviewing," not ground truth.

## 4. Domain glossary (as THIS system uses the terms)

- **Association / HOA** — the customer org (`hoas`). **Unit** — one condo
  unit… or a PM/ADMIN contact row (see §3).
- **Tenant** — a unit **OWNER**. Historical schema name from before the
  owner/renter split; UI always says "owner," schema/code say tenant.
  **Renter** — occupant of a rented unit; carries an HO-4; lives in a
  sub-unit.
- **Dec page** — declaration page, the document AI parses. **HO-6 / HO-4 /
  wind-only** — policy types; an `ho6_wind_excluded` + separate wind-only
  *pair* satisfies wind requirements together.
- **Coverage A / C / E** — dwelling / personal property / liability limits.
- **Firm** — `pm_firms`, a PM company; has an **owner** and members; **open**
  visibility (everyone sees the portfolio) vs **assignment-based**
  (`pm_member_hoas`). **Portfolio** — all associations a firm manages
  (`pm_firm_hoas`).
- **Billing modes** — `firm` (one consolidated subscription) vs `association`
  (each HOA pays itself at the firm's bulk rate).
- **Manual approval** — staff override marking a failing unit compliant.
  **Superseded** — `policies.superseded_by`; the doc with the newest
  expiration governs.
- **Status labels** — active="AI Approved", non_compliant="Needs Attention",
  missing="Missing Policy", manual="Manual Approval".
- **CAM / CAB** — Florida manager / management-firm licenses (stored in
  `units.pm_license`, shared across a PM's rows by email). **PropRadar** —
  property-records vendor behind the Radar-ID import format. **Email-in** —
  the docs@ inbound flow.

## 5. Workflow

- **Everything ships from `main`; push = deploy** (Railway, both services).
  Small commits; `git pull --rebase origin main` before every push. Multiple
  sessions work in parallel: **check `git status` before committing and never
  commit or stash working-tree changes you didn't make without finding out
  whose they are.**
- **Run git from the repo root** — `cd frontend && git add frontend/...`
  breaks (cwd persists in shells).
- **Definition of done:** frontend builds, backend imports (CI covers both),
  then a **manual smoke test on the live site** — Sandbox Condo for anything
  data-touching. There is **no E2E suite**; ci.yml's mention of one is
  aspirational.
- **Migrations:** numbered SQL in `migrations/`, applied **manually to prod
  before pushing dependent code** (asyncpg with `statement_cache_size=0` —
  pgbouncer chokes otherwise). Fix the numbering discipline going forward.
  [CONFIRM: applied by whoever ships the change, using DATABASE_URL from
  `.env`?]
- **Ask Randy/Troy first (hard rules):** any **live Stripe change**
  (subscriptions, prices, manual billing-sync runs) and **deleting an
  association** (endpoint or SQL) — even a test one.
- **Convention:** anything emailing real owners or writing real-customer
  rows — prefer Sandbox, use judgment, ask when unsure.
- **Cron** is GitHub Actions (`scheduled-jobs.yml`), manually runnable from
  the Actions tab; secrets `INTERNAL_API_KEY` + `BACKEND_URL` live in repo
  settings.

## 6. Boundaries

- **CLAUDE.md — do not edit right now**; it's being rewritten separately
  (this file exists to avoid collisions and will be merged later).
- **Legacy tables `property_manager_hoas` + `pm_billing`** — new code must
  never read or write them; dropping them is a future cleanup that requires
  verifying the `pm_firm_*` data is complete first.
- **No active refactor hot-zones flagged** beyond the CLAUDE.md rewrite.
- **`demo/`** — sales-demo assets (dec-page generator, walkthrough script),
  not product code.
- **`frontend/BRANDING.md`** — design tokens/notes. [CONFIRM: CLAUDE.md's note
  about restyling /pricing is stale — that page was deleted; the landing
  `#pricing` section is canonical.]
