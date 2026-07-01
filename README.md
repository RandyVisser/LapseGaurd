# LapseGuard

B2B SaaS compliance tool for condo HOA insurance tracking. HOA admins get a real-time compliance dashboard; tenants upload proof of insurance and receive automated expiration alerts.

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI (Python 3.12) |
| Frontend | React 18 + Tailwind CSS + Vite |
| Database | PostgreSQL 15 (Supabase) |
| Auth | Supabase (JWT, multi-role) |
| File storage | Supabase Storage |
| Email | Resend (raw `httpx`, no SDK) |
| Billing | Stripe (flag-gated, see Environment variables) |
| Error tracking | Sentry (`sentry-sdk`, `@sentry/react`) |
| Charts | `recharts` |
| Hosting target | Railway |

## Quick start

Actual day-to-day dev workflow — talks to the real Supabase project, no local DB:

```bash
cp .env.example .env   # fill in your Supabase/Resend/Anthropic secrets

# backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# frontend (separate terminal)
cd frontend
npm install
npm run dev
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |

**Optional/legacy — `docker compose up`:** `docker-compose.yml` spins up a local Postgres container (applying every file in `migrations/` on first init) instead of connecting to Supabase. It dates back to the original scaffold and isn't part of the current workflow (auth still requires a real Supabase project either way), but it's left in place as a fallback if you want a throwaway local DB. Not actively maintained — expect drift.

## Project structure

```
lapseguard/
├── docker-compose.yml
├── .env.example
├── migrations/
│   └── 001_initial_schema.sql      # all tables + seed data
├── backend/
│   ├── main.py                     # FastAPI app + CORS
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── auth/
│   │   └── jwt.py                  # Supabase JWT decode, role guards
│   ├── models/
│   │   ├── db.py                   # asyncpg connection pool
│   │   └── schemas.py              # Pydantic models
│   ├── routes/
│   │   ├── hoa.py                  # /hoa/{id}/units, /compliance, import wizard, admin+PM mgmt, CSV export
│   │   ├── units.py                # /unit/{id}/policy, owner transfer, AI parse, approval
│   │   ├── tenants.py              # /tenant/me, notify, invite flows
│   │   ├── documents.py            # /unit/{id}/documents, /hoa/{id}/documents
│   │   ├── onboarding.py           # /onboard/association, admin/PM invite tokens
│   │   ├── alerts.py               # /alerts/run (internal cron endpoint), board reports
│   │   ├── billing.py              # Stripe checkout/portal/webhook — BILLING_ENABLED
│   │   ├── rentals.py              # subrental tracking — RENTALS_ENABLED
│   │   ├── feedback.py             # in-app feedback widget
│   │   ├── inbound.py              # docs@condo.insure email-in flow
│   │   └── analytics.py            # event tracking + funnel
│   └── scripts/
│       └── run_alerts.py           # standalone alert job (Railway cron)
└── frontend/
    └── src/
        ├── pages/
        │   ├── Login.jsx / Signup.jsx / Join.jsx
        │   ├── ForgotPassword.jsx / ResetPassword.jsx / AdminSetup.jsx
        │   ├── AdminDashboard.jsx / AdminTenantDetail.jsx / AdminDocuments.jsx
        │   ├── AdminSettings.jsx / AdminFeedback.jsx (super_user only)
        │   ├── TenantDashboard.jsx / TenantDocuments.jsx
        │   ├── Pricing.jsx / Legal.jsx (Privacy + Terms)
        │   └── Landing.jsx
        └── components/
            ├── Nav.jsx             # role-aware navigation
            ├── StatusBadge.jsx     # active / expiring / lapsed / missing
            ├── ImportWizard.jsx    # bulk unit CSV import
            ├── AddEmailsWizard.jsx # bulk tenant email add
            ├── BillingPanel.jsx    # Stripe billing UI, flag-gated
            └── FeedbackWidget.jsx  # in-app feedback submission
```

## Data model

```
hoas ──< units ──< tenants ──< policies
  └──────────────────────────< documents
                    tenants ──< alert_log
```

Policy status is computed automatically:
- **active** — expiration date > 30 days out
- **expiring** — expiration date within 30 days
- **lapsed** — expiration date in the past
- **missing** — no policy on file

## Auth & roles

Roles are stored in Supabase `app_metadata.role` (falls back to `user_metadata.role` if unset):

| Role | Access |
|---|---|
| `hoa_admin` | All units and documents within their HOA |
| `property_manager` | Admin-equivalent access across the HOAs they manage; picks an active HOA client-side |
| `super_user` | Admin-equivalent access across all HOAs, plus `/admin/feedback`. Randy + dad only |
| `tenant` | Their own unit and HOA shared documents |

Set role when creating users in Supabase:
```json
{ "role": "hoa_admin", "hoa_id": "<hoa-uuid>" }
{ "role": "property_manager" }
{ "role": "super_user" }
{ "role": "tenant" }
```

## API routes

Not exhaustive — see `backend/routes/` for the full list (~70 endpoints across 11 files).

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/hoa/{id}/units` | admin | List all units with compliance status |
| GET | `/hoa/{id}/compliance` | admin | Summary counts (compliant, expiring, lapsed, missing) |
| GET | `/hoa/{id}/compliance/trend` | admin | Compliance history for charts |
| POST | `/hoa/{id}/units/import` | admin | Bulk unit CSV import (+ `/import/preview`, `/import/commit`) |
| GET | `/hoa/{id}/export` | admin | CSV export |
| POST | `/hoa/{id}/property-manager`, `/hoa/{id}/admin` | admin | Add PM / admin to an HOA |
| POST | `/hoa/{id}/report/send` | admin | Send board report |
| GET | `/unit/{id}/policy` | tenant/admin | Current policy for a unit |
| POST | `/unit/{id}/policy` | tenant/admin | Upload policy metadata + doc URL |
| POST | `/policy/{id}/run-ai` | tenant/admin | Run Claude Haiku dec-page parse |
| POST | `/policy/{id}/approve` | admin | Manually approve a policy |
| PATCH | `/unit/{id}/owner`, POST `/unit/{id}/new-owner` | admin | Owner transfer |
| GET | `/tenant/me`, `/tenant/me/policies` | tenant | Own profile + policy history |
| POST | `/tenant/{id}/notify`, `/hoa/{id}/notify-bulk` | admin | Send renewal reminders |
| POST | `/unit/{id}/invite`, `/hoa/{id}/invite-all` | admin | Tenant invite flow |
| GET/POST | `/invite/{token}` | public | Tenant invite acceptance |
| GET/POST | `/admin-invite/{token}` | public | Admin/PM invite acceptance |
| GET | `/unit/{id}/documents` | tenant/admin | List HOA shared documents |
| POST | `/hoa/{id}/documents` | admin | Upload HOA shared document |
| POST | `/onboard/association` | public | New association self-serve onboarding |
| POST | `/alerts/run` | internal | Run expiration check + send emails |
| POST | `/reports/board/run` | internal | Run board report job |
| GET/POST | `/hoa/{id}/billing`, `/billing/checkout`, `/billing/portal` | admin | Stripe billing — `BILLING_ENABLED` only |
| POST | `/billing/webhook` | internal | Stripe webhook receiver |
| POST/DELETE | `/unit/{id}/rental`, POST `/unit/{id}/lease` | admin | Subrental tracking — `RENTALS_ENABLED` only |
| POST/GET/PATCH | `/feedback` | any/super_user | In-app feedback widget |
| POST | `/inbound/email` | internal | `docs@condo.insure` inbound document parsing |
| POST/GET | `/analytics/event`, `/analytics/funnel` | internal/super_user | Product analytics |

## Alert job

`backend/scripts/run_alerts.py` queries all policies expiring within 30 days or already lapsed, updates their status, and sends an HTML email via Resend.

**Run manually:**
```bash
docker compose exec backend python scripts/run_alerts.py
```

**Railway cron** — set a cron job to call `POST /alerts/run` with header `X-Api-Key: <INTERNAL_API_KEY>` on your desired schedule (e.g. daily at 8am).

## Lead funnel

When a policy is lapsed or missing, tenants see a "Get a Quote" CTA that links to a TypeForm with prefilled query params:

```
?tenant_name=Jane+Smith&unit=101&hoa=<hoa-id>
```

Set `VITE_QUOTE_FORM_URL` in `.env` to your TypeForm URL. No backend required.

## Environment variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|---|---|
| `SUPABASE_JWT_SECRET` | From Supabase → Settings → API → JWT Secret |
| `RESEND_API_KEY` | Resend API key for outbound email |
| `INTERNAL_API_KEY` | Shared secret for the `/alerts/run` cron endpoint |
| `RENTALS_ENABLED` / `VITE_RENTALS_ENABLED` | Gate the subrental feature (`"true"` to enable; unset = off everywhere today) |
| `BILLING_ENABLED` / `VITE_BILLING_ENABLED` | Gate the Stripe billing feature (`"true"` to enable; unset = off everywhere today) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Only needed when `BILLING_ENABLED=true` |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | Error tracking (optional) |
| `VITE_SUPABASE_URL` | Supabase project URL (frontend) |
| `VITE_QUOTE_FORM_URL` | TypeForm URL for the quote CTA |

New `VITE_` vars must also be added as `ARG`+`ENV` in `frontend/Dockerfile.prod`, or Railway silently drops them from the production build.

## Deploying to Railway

1. Create a Railway project with three services: `backend`, `frontend`, `db` (or point to Supabase for DB)
2. Set all env vars from `.env.example` in the Railway dashboard
3. Add a Railway cron job: `POST https://<backend-url>/alerts/run` with `X-Api-Key` header, daily schedule
