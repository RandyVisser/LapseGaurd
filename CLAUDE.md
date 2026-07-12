# condo.insure (repo: LapseGaurd — the typo is known, deliberately kept)

B2B SaaS for condo associations to track unit-owner HO-6 insurance compliance:
associations add units, invite owners, and the platform parses uploaded dec
pages with AI, tracks policy status, and sends automated renewal alerts. It is
also a lead source for the family insurance agency — see @CLAUDE.dad.md for
business context, decision rationale, and the domain glossary (that draft
merges into this file eventually). North star: PM firms managing
multi-association portfolios. Backlog of record: @ROADMAP.md

Module context: @backend/CLAUDE.md and @frontend/CLAUDE.md.

## ⚠️ Read before touching anything

- **Dev talks to PRODUCTION Supabase. There is no staging.** The only safe
  test HOA is **Sandbox Condo** (`00000000-0000-0000-0000-000000000001`).
  **3 Island and Vista Royale are real customers with real owner emails —
  never send them anything.**
- Test logins MUST use `sandbox-*@condo.insure` emails — that pattern is
  excluded from the analytics funnel; any other address pollutes the tickers.
- Push to `main` = deploy (Railway, both services). No PR gate. Multiple
  Claude sessions + Troy work in parallel: `git fetch && git pull --rebase`
  before starting AND before pushing; never commit or stash working-tree
  changes you didn't make without finding out whose they are. Run git from
  the repo root (cwd persists across shell calls).

## Stack

- **Frontend**: React + Vite + Tailwind, deployed on Railway
- **Backend**: FastAPI (Python), deployed on Railway
- **Database/Auth/Storage**: Supabase (project ref: ykbjvmqdkczqyzyylwxo)
- **Email**: Resend (sending domain: send.condo.insure) — raw `httpx` in
  `services/email.py`, no `resend` SDK
- **AI**: Claude Haiku for dec page parsing (pdfplumber text extraction,
  vision fallback for scanned docs)
- **Billing**: Stripe — live in prod (checkout/portal/webhook + daily sync)
- **Error tracking**: Sentry (`sentry-sdk[fastapi]` backend, `@sentry/react` frontend)
- **Charts**: `recharts`

No SDKs is deliberate: Supabase user management (`onboarding.py`) and DB
access (`models/db.py`) go through raw REST/`asyncpg`, not `supabase-py`.
Fewer dependencies, easier debugging — new code follows suit.

## Repo layout

```
backend/
  main.py              # FastAPI app, CORS, router registration
  auth/jwt.py          # Supabase JWT validation, AuthUser, require_hoa_admin
  models/
    db.py              # asyncpg connection pool
    schemas.py         # Pydantic models
  routes/
    hoa.py             # /hoa/{id}/units, /compliance, /compliance/trend, import wizard,
                        # admin+PM management, contacts, CSV export, board reports
    units.py           # /unit/{id}/policy (upload + AI parse), owner transfer, policy approve
    tenants.py         # /tenant/me, /tenant/{id}, notify + bulk-notify, invite flows
    documents.py       # GET/POST /hoa/{id}/documents, /unit/{id}/documents
    onboarding.py      # POST /onboard/association, admin/PM invite tokens
    alerts.py          # POST /alerts/run (cron endpoint), /reports/board/run
    billing.py         # /hoa/{id}/billing, checkout/portal, Stripe webhook, daily
                        # quantity sync + /pm/billing (firm consolidated subscription)
    rentals.py         # /unit/{id}/rental, /lease, rental invite — RENTALS_ENABLED
    pm_team.py         # firm console backend: /pm/team (roster, roles, invites w/
                        # pre-assignments), /pm/groups CRUD, /pm/overview, /pm/associations
                        # (registry + firm-side add), /firms (super_user directory)
    feedback.py        # POST/GET/PATCH /feedback — backs in-app FeedbackWidget
    inbound.py         # POST /inbound/email — docs@condo.insure email-in flow
    analytics.py       # POST /analytics/event, GET /analytics/funnel
  services/
    email.py           # Resend templates + send_email (rate-paced; ALL email goes through it)
    firms.py           # THE PM access rule (_MAY_SEE) + firm helpers — see backend/CLAUDE.md
    policy_parser.py   # Claude Haiku dec page extraction + validation
  scripts/
    run_alerts.py      # Alert processor logic (see Scheduled jobs — the cron does NOT run this file)

frontend/src/
  App.jsx              # Routes
  context/AuthContext.jsx  # Session, role, hoaId selection model (see frontend/CLAUDE.md)
  supabase.js          # supabase client, apiGet/apiPost/... helpers
  pricing.js           # volume pricing math — mirrors backend + Stripe (change together)
  pages/
    Landing.jsx        # Marketing page (/) — pricing section is canonical (/pricing retired)
    Login.jsx / Signup.jsx / ForgotPassword.jsx / ResetPassword.jsx
    Join.jsx           # /join/:token — owner invite acceptance
    AdminSetup.jsx     # /admin-setup/:token — admin/PM invite acceptance
    AdminDashboard.jsx # /admin/dashboard — classic compliance dashboard; multi-assoc PMs
                        # get FirmDashboard here instead (see frontend/CLAUDE.md)
    AdminTenantDetail.jsx  # /admin/tenant/:id — policy history, AI validation
    AdminDocuments.jsx # /admin/documents — upload shared HOA docs
    AdminSettings.jsx  # /admin/settings — HOA settings, billing panel
    AdminFirm.jsx      # /admin/firm — Firm console: Users/Groups/Billing/Settings
                        # (PMs); firm directory (super_user). PM+super_user only
    AdminFeedback.jsx  # /admin/feedback — super_user only
    AdminHo6Summary.jsx    # HO-6 dec-page summary (super_user)
    TenantDashboard.jsx / TenantDocuments.jsx
    Legal.jsx          # exports Privacy (/privacy) and Terms (/terms)
  components/
    Nav.jsx             # Top nav (React Router Link, never <a>)
    StatusBadge.jsx     # status pill (labels: Approved / Needs Attention / ...)
    ImportWizard.jsx / AddEmailsWizard.jsx
    BillingPanel.jsx    # per-association Stripe billing UI
    PmBillingPanel.jsx  # firm billing (consolidated vs pass-through modes)
    FirmDashboard.jsx   # multi-assoc PM landing: KPIs + association list + add-association
    FirmDirectory.jsx   # super_user firm directory (billing hover)
    HoaOptions.jsx      # firm-grouped association switcher options
    FeedbackWidget.jsx

migrations/            # numbered SQL — CANONICAL schema history (see Database)
demo/                  # sales-demo assets (dec-page generator) — not product code
.github/workflows/     # ci.yml (build+import checks), scheduled-jobs.yml (THE cron),
                       # backup-docs.yml (append-only B2 doc backup — never make it sync)
```

## Roles

- `hoa_admin` — association manager. `hoa_id` in JWT `app_metadata`. Sees admin routes.
- `property_manager` — staff at a PM firm (`pm_firms`), role-tiered
  (`pm_firm_members.role`): owner (billing, firm settings, promote/demote), manager
  (people ops — invite/remove members, assignments, groups; read-only billing; always
  sees all), member (their book). Visibility per firm (`pm_firms.open_visibility`,
  owner-toggled): open (default) = everyone sees the whole portfolio; assignment-based =
  members see direct assignments (`pm_member_hoas`) ∪ their groups' books
  (`pm_groups`/`pm_group_members`/`pm_group_hoas`). Access resolves through
  `services/firms.py` (`_MAY_SEE` / `firm_manages_hoa` / `visible_hoas_sql`) — change it
  there, not per-endpoint. Groups change what people SEE, never what gets billed. No
  single fixed `hoa_id` (client-side selection, see `AuthContext`). Firm-level UI: a PM
  who can see exactly ONE association lands straight in the classic per-association
  dashboard (indistinguishable from an hoa_admin); multi-association PMs land on the
  firm dashboard (FirmDashboard.jsx). The Firm page at /admin/firm is Users / Groups /
  Billing / Settings.
- `super_user` — **Randy + Troy only, ever** (the Claude team account changes nothing
  about app roles). Admin-equivalent access across all HOAs, plus `/admin/feedback`.
- `tenant` — unit OWNER (historical schema name; UI says "owner"). No `hoa_id` in JWT;
  fetched from `/tenant/me`. Sees tenant routes.

Backend guards (`auth/jwt.py`): `require_hoa_admin` accepts `hoa_admin`, `super_user`,
and `property_manager`; `require_super_user` is stricter; `require_tenant` for
tenant-only routes. Role and `hoa_id` live in Supabase `app_metadata`.

## Key env vars

Backend (Railway):
- `DATABASE_URL` — Supabase Postgres connection string
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — Claude Haiku dec page parsing
- `RESEND_API_KEY` / `FROM_EMAIL=alerts@condo.insure`
- `APP_URL=https://www.condo.insure` — use the `www` host; the bare domain
  301-redirects, so bare links in emails add a redirect hop
- `ALLOWED_ORIGINS=https://www.condo.insure`
- `INTERNAL_API_KEY` — cron endpoint auth
- `QUOTE_FORM_URL` — Typeform quote link (optional; buttons hidden when unset)
- `SENTRY_DSN` — optional
- `RENTALS_ENABLED` / `BILLING_ENABLED` — **both "true" in prod** (billing
  E2E-verified: per-HOA 2026-07-08, firm-consolidated 2026-07-12)
- Stripe: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID`
- [CONFIRM] `STRIPE_PRICE_ID` must point at a VOLUME-tier Price (1–50 flat $50 /
  51–750 $1 / 751–10k $0.50 / 10k+ $0.25 per unit). Code switched to volume
  pricing 2026-07-12; Troy owns creating the Price + updating the env var —
  until then displayed prices and Stripe charges disagree.

Frontend (Railway, baked at build time via Vite):
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` — Railway backend URL (no trailing slash)
- `VITE_QUOTE_FORM_URL` / `VITE_SENTRY_DSN` — optional
- `VITE_RENTALS_ENABLED` / `VITE_BILLING_ENABLED` — must match backend; **any
  new `VITE_` var must also be ARG+ENV in `frontend/Dockerfile.prod`** or
  Railway silently drops it from the build

## Local dev

Copy `.env.example` to `.env` and fill in values, then:

```bash
# backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Frontend proxies `/api` to `http://localhost:8000` via Vite config in dev.
Remember: `.env` points at PROD — test against Sandbox Condo only.

## Database schema (Supabase)

Schema history is the numbered SQL in `migrations/` — **canonical**. Rules:
take the next integer (two 005s exist historically — never reuse a number),
apply manually to prod BEFORE pushing dependent code (asyncpg needs
`statement_cache_size=0`; pgbouncer chokes otherwise). 036–040 were applied
via the Supabase MCP on 2026-07-10/12 and backfilled into the folder — do not
re-apply them.

```
hoas          id, name, address
units         id, hoa_id, unit_number
tenants       id, unit_id, supabase_user_id, name, email
policies      id, tenant_id, insurer, policy_number, expiration_date, status,
              document_url, uploaded_at, extracted_data (jsonb), parsed_at
unit_invites  id, unit_id, email, token, accepted_at
documents     id, hoa_id, name, file_url, uploaded_by
alert_log     id, tenant_id, alert_type, sent_at
pm_firms          id, name, stripe_customer_id, cab_number, open_visibility,
                  billing_mode ('firm' = consolidated sub | 'association' = each HOA
                  subscribes itself at the firm's bulk rate)   # PM company
pm_firm_members   firm_id, supabase_user_id (unique — one firm per login),
                  role ('owner'|'manager'|'member'; is_owner kept in sync, legacy)
pm_firm_hoas      firm_id, hoa_id                # associations the firm manages (billing scope)
pm_member_hoas    firm_id, supabase_user_id, hoa_id   # per-PM direct assignments (visibility scope
                  # when open_visibility=false); composite FKs onto members + portfolio, cascade
pm_groups         id, firm_id, name, color            # AD-style groups: membership grants the
pm_group_members  group_id, firm_id, supabase_user_id # group's whole book (additive with direct
pm_group_hoas     group_id, firm_id, hoa_id           # assignments); flat, no nesting
admin_invites     firm_id (nullable, teammate invites) + preassign_hoa_ids uuid[] (assigned on
                  acceptance); hoa_id nullable
# property_manager_hoas and pm_billing are LEGACY (superseded by the pm_firm_* tables);
# new code must never read or write them — drop both in a later cleanup.
```

Storage buckets:
- `policy-documents` (private) — dec page uploads, path `{unit_id}/{timestamp}.{ext}`.
  INSERT-only RLS (never `upsert: true`); reads via backend-minted signed URLs
  (`services/storage.py`), never a public URL.
- `hoa-documents` (private) — admin shared docs, `{hoa_id}/{timestamp}.{ext}`. Same pattern.
- `public-assets` (public) — anonymous marketing assets only (landing tour video),
  served via Supabase CDN. Never tenant/HOA documents.

## Deploy & definition of done

Push to `main` → Railway auto-deploys both services. CI (ci.yml) only checks
that the frontend builds and the backend imports — it catches white-screens
and startup crashes, not behavior. **There is no E2E suite.** Definition of
done: `npx vite build` passes, backend `python -c "import main"` passes, and
a manual smoke test on the live site — against Sandbox Condo for anything
data-touching.

## Scheduled jobs (cron)

The scheduler is a **GitHub Actions workflow** (`.github/workflows/scheduled-jobs.yml`),
NOT a Railway cron service. It curls the backend with `x-api-key: INTERNAL_API_KEY`
(secrets `INTERNAL_API_KEY` + `BACKEND_URL` live in the GitHub repo settings):
- daily `0 13 * * *` (≈9am ET; GitHub often fires 1–3h late) → `POST /alerts/run` —
  all reminder emails (renewal 30/7/1, lapsed, non-compliant, pending invites,
  trial expiry) plus the Stripe quantity sync
- monthly `30 13 1 * *` → `POST /reports/board/run` — board reports
- manual runs: GitHub → Actions tab → "Scheduled jobs" → Run workflow

IMPORTANT: `/alerts/run` (routes/alerts.py) must import every processor that
`scripts/run_alerts.py main()` runs — the script itself is NOT what the cron
executes, so a processor added only to the script never runs in production
(this has bitten twice).

All reminders are evaluated each run and throttled per type/interval, so a
daily cadence never double-sends. Billing sync details: @backend/CLAUDE.md.

## Hard rules (ask Randy/Troy first — no exceptions)

- Any **live Stripe write**: subscriptions, Prices, manual `/billing/sync` runs.
- **Deleting an association** — even a test one.
- **Emailing anything** to the real-customer HOAs.
- **Outbound/cold email never goes through Resend** — Apollo + a lookalike
  domain only (protects the product sending domain's deliverability).
- Don't replace **Supabase auth** or the **Claude parsing pipeline** — standing
  directive.
- Test/promo/Playwright tooling stays **out of this repo** (a separate
  `lapsegaurd-promo` scratch dir exists for that).
- ⏰ **Paywall decision needed before trials end 2026-10-06** —
  `assert_billing_ok` (routes/billing.py) is a documented no-op today; day-91
  behavior (lockout / read-only / nag) is an open product decision.

## Test accounts

HOA: "Sandbox Condo" (id: 00000000-0000-0000-0000-000000000001) — the only HOA
safe to test against; 3 Island and Vista Royale are real customers with real
owner emails.
Admin login: testadmin@condo.insure / sandbox-gecko-42 (hoa_admin scoped to Sandbox Condo)
PM logins (firm "Sandbox Property Group", manages Sandbox Condo):
- sandbox-pm1@condo.insure / sandbox-heron-77 (owner)
- randy.redfish+pmtest@gmail.com / sandbox-otter-33 (member)
The former randy@lapsegaurd.com / troy@visser.com / seeded-tenant password123
logins had their passwords rotated and no longer work.
New test staff: always `sandbox-*@condo.insure` (see the warning block up top).
