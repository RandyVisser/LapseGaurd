# condo.insure (LapseGuard)

B2B SaaS for condo associations to track unit-owner insurance compliance. Associations add units, invite tenants, and the platform tracks policy status, parses uploaded dec pages with AI, and sends automated renewal alerts.

## Stack

- **Frontend**: React + Vite + Tailwind, deployed on Railway
- **Backend**: FastAPI (Python), deployed on Railway
- **Database/Auth/Storage**: Supabase (project ref: ykbjvmqdkczqyzyylwxo)
- **Email**: Resend (domain: condo.insure) — sent via raw `httpx` calls in `services/email.py`, no `resend` SDK
- **AI**: Claude Haiku for dec page parsing (pdfplumber for text extraction, vision fallback for scanned docs)
- **Billing**: Stripe (`stripe` package) — checkout/portal/webhook, flag-gated (see Feature flags)
- **Error tracking**: Sentry (`sentry-sdk[fastapi]` backend, `@sentry/react` frontend)
- **Charts**: `recharts` (compliance trend graphs)

Supabase user management (`onboarding.py`) and DB access (`models/db.py`) go through direct REST/`asyncpg` calls, not the `supabase-py` SDK.

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
    billing.py         # /hoa/{id}/billing, checkout/portal, Stripe webhook — BILLING_ENABLED
                        # + /pm/billing: PM-firm consolidated subscription (combined units,
                        # volume tiers as the incentive; covered HOA rows share the firm's
                        # stripe_customer_id so the webhook fans status out to all of them)
    rentals.py         # /unit/{id}/rental, /lease, rental invite — RENTALS_ENABLED
    pm_team.py         # /pm/team — firm roster: invite/remove teammates, rename firm
    feedback.py        # POST/GET/PATCH /feedback — backs in-app FeedbackWidget
    inbound.py         # POST /inbound/email — docs@condo.insure email-in flow
    analytics.py       # POST /analytics/event, GET /analytics/funnel
  services/
    email.py           # Resend email templates (raw httpx, no SDK)
    policy_parser.py   # Claude Haiku dec page extraction + validation
  scripts/
    run_alerts.py      # Alert logic (throttled to 1 per 7 days per tenant/type)

frontend/src/
  App.jsx              # Routes
  context/AuthContext.jsx  # Session, role, hoaId, unitId, profileError
  supabase.js          # supabase client, apiGet, apiPost helpers
  pages/
    Landing.jsx        # Marketing page (/)
    Login.jsx          # /login — has forgot password + signup links
    Signup.jsx         # /signup — association onboarding
    Join.jsx           # /join/:token — tenant invite acceptance
    ForgotPassword.jsx # /forgot-password
    ResetPassword.jsx  # /reset-password (handles Supabase recovery session)
    AdminSetup.jsx      # /admin-setup/:token — admin/PM invite acceptance
    AdminDashboard.jsx # /admin/dashboard — unit compliance table, invite/notify
    AdminTenantDetail.jsx  # /admin/tenant/:id — policy history, AI validation
    AdminDocuments.jsx # /admin/documents — upload shared HOA docs
    AdminSettings.jsx  # /admin/settings — HOA settings, billing panel (flag-gated)
    AdminFeedback.jsx  # /admin/feedback — super_user only
    TenantDashboard.jsx    # /tenant/dashboard — policy upload, building docs
    TenantDocuments.jsx    # /tenant/documents — HOA shared docs (tenant view)
    Pricing.jsx         # /pricing — not yet restyled to current brand (see BRANDING.md)
    Legal.jsx            # exports Privacy (/privacy) and Terms (/terms)
  components/
    Nav.jsx             # Top nav (uses React Router Link, not <a> tags)
    StatusBadge.jsx     # active/expiring/lapsed/missing pill
    ImportWizard.jsx    # bulk unit import (CSV) flow
    AddEmailsWizard.jsx # bulk tenant email add flow
    BillingPanel.jsx    # Stripe billing UI, flag-gated
    PmBillingPanel.jsx  # PM portfolio billing (all associations, one subscription), flag-gated
    FeedbackWidget.jsx  # in-app feedback submission
```

## Roles

- `hoa_admin` — association manager. `hoa_id` in JWT `app_metadata`. Sees admin routes.
- `property_manager` — staff at a PM firm (`pm_firms`). Admin-equivalent access to every association the FIRM manages (`pm_firm_members` → `pm_firm_hoas`); no single fixed `hoa_id` (selects an active HOA client-side, see `AuthContext`'s `effectiveHoaId`). The firm owner invites/removes teammates and manages the firm's consolidated billing from Settings → all-associations view.
- `super_user` — Randy + dad only. Admin-equivalent access across all HOAs, plus `/admin/feedback`.
- `tenant` — unit owner. No `hoa_id` in JWT; fetched from `/tenant/me`. Sees tenant routes.

Backend guards (`auth/jwt.py`): `require_hoa_admin` accepts `hoa_admin`, `super_user`, and `property_manager`; `require_super_user` is stricter (super_user only); `require_tenant` for tenant-only routes.

Role and `hoa_id` live in Supabase `app_metadata`, read by the backend JWT decoder and the frontend `AuthContext`.

## Key env vars

Backend (Railway):
- `DATABASE_URL` — Supabase Postgres connection string
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — Claude Haiku dec page parsing
- `RESEND_API_KEY` / `FROM_EMAIL=alerts@condo.insure`
- `APP_URL=https://www.condo.insure` — use the `www` host; the bare domain 301-redirects to it, so bare links in emails add a redirect hop
- `ALLOWED_ORIGINS=https://www.condo.insure`
- `INTERNAL_API_KEY` — cron endpoint auth
- `QUOTE_FORM_URL` — Typeform quote link (optional; buttons hidden when unset)
- `SENTRY_DSN` — backend error tracking (optional)
- `RENTALS_ENABLED` — gates `rentals.py` routes (`"true"` to enable; unset = off)
- `BILLING_ENABLED` — gates `billing.py` Stripe routes (`"true"` to enable; unset = off)
- Stripe: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (only needed when `BILLING_ENABLED=true`)

Frontend (Railway, baked at build time via Vite):
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` — Railway backend URL (no trailing slash)
- `VITE_QUOTE_FORM_URL` — same Typeform URL as backend (optional)
- `VITE_SENTRY_DSN` — frontend error tracking (optional)
- `VITE_RENTALS_ENABLED` / `VITE_BILLING_ENABLED` — must match their backend counterparts; any new `VITE_` var must also be added as ARG+ENV in `frontend/Dockerfile.prod` or Railway silently drops it from the build

Both feature flags are OFF by default and undocumented in `.env.example` today — code is merged but dark.

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

## Database schema (Supabase)

```
hoas          id, name, address
units         id, hoa_id, unit_number
tenants       id, unit_id, supabase_user_id, name, email
policies      id, tenant_id, insurer, policy_number, expiration_date, status,
              document_url, uploaded_at, extracted_data (jsonb), parsed_at
unit_invites  id, unit_id, email, token, accepted_at
documents     id, hoa_id, name, file_url, uploaded_by
alert_log     id, tenant_id, alert_type, sent_at
pm_firms          id, name, stripe_customer_id   # PM company: members share the portfolio; consolidated billing hangs here
pm_firm_members   firm_id, supabase_user_id (unique — one firm per login), is_owner
pm_firm_hoas      firm_id, hoa_id                # associations the firm manages
admin_invites     also carries firm_id (nullable) for teammate invites; hoa_id nullable
# property_manager_hoas and pm_billing are LEGACY (superseded by the pm_firm_* tables); kept only so
# pre-firm deploys keep working — drop both in a later cleanup.
```

Storage buckets:
- `policy-documents` (private) — tenant dec page uploads, path: `{unit_id}/{timestamp}.{ext}`. INSERT-only RLS; reads go through backend-minted signed URLs (`services/storage.py`), never a public URL.
- `hoa-documents` (private) — admin shared docs, path: `{hoa_id}/{timestamp}.{ext}`. Same private/signed-URL pattern as `policy-documents`.
- `public-assets` (public) — static marketing assets meant for anonymous visitors (e.g. the landing page tour video), served directly via Supabase's CDN URL. Not for tenant/HOA documents — those stay in the private buckets above.

## Deploy

Push to `main` → Railway auto-deploys both frontend and backend services.
No build step needed locally — Railway handles it.

## Scheduled alerts (cron)

The scheduler is a **GitHub Actions workflow** (`.github/workflows/scheduled-jobs.yml`),
NOT a Railway cron service. It curls the backend with `x-api-key: INTERNAL_API_KEY`
(secrets `INTERNAL_API_KEY` + `BACKEND_URL` live in the GitHub repo settings):
- daily `0 13 * * *` (≈9am ET) → `POST /alerts/run` — all reminder emails
  (renewal 30/7/1, lapsed, non-compliant, pending invites, trial expiry) plus
  the Stripe quantity sync
- monthly `30 13 1 * *` → `POST /reports/board/run` — board reports
- manual runs: GitHub → Actions tab → "Scheduled jobs" → Run workflow

IMPORTANT: `/alerts/run` (routes/alerts.py) must import every processor that
`scripts/run_alerts.py main()` runs — the script itself is NOT what the cron
executes, so a processor added only to the script never runs in production.

All reminders are evaluated each run and throttled per type/interval, so a daily
cadence never double-sends.

The billing sync (`sync_billing_quantities` in routes/billing.py) makes every
live subscription's quantity match today's billable unit counts, stamps
associations newly added to a subscribed firm (they show paid and start being
billed), and detaches ones that left (firm stops paying; they revert to
unsubscribed). Quantity changes use proration_behavior='none' — they apply
from the next invoice.

## Test accounts

HOA: "Sandbox Condo" (id: 00000000-0000-0000-0000-000000000001) — the only HOA safe to test against; 3 Island and Vista Royale are real customers with real owner emails.
Admin login: testadmin@condo.insure / sandbox-gecko-42 (hoa_admin scoped to Sandbox Condo)
PM logins (firm "Sandbox Property Group", manages Sandbox Condo):
- sandbox-pm1@condo.insure / sandbox-heron-77 (owner)
- randy.redfish+pmtest@gmail.com / sandbox-otter-33 (member)
The former randy@lapsegaurd.com / troy@visser.com / seeded-tenant password123 logins had their passwords rotated and no longer work.
