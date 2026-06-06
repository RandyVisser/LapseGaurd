# condo.insure (LapseGuard)

B2B SaaS for condo associations to track unit-owner insurance compliance. Associations add units, invite tenants, and the platform tracks policy status, parses uploaded dec pages with AI, and sends automated renewal alerts.

## Stack

- **Frontend**: React + Vite + Tailwind, deployed on Railway
- **Backend**: FastAPI (Python), deployed on Railway
- **Database/Auth/Storage**: Supabase (project ref: ykbjvmqdkczqyzyylwxo)
- **Email**: Resend (domain: condo.insure)
- **AI**: Claude Haiku for dec page parsing (pdfplumber for text extraction, vision fallback for scanned docs)

## Repo layout

```
backend/
  main.py              # FastAPI app, CORS, router registration
  auth/jwt.py          # Supabase JWT validation, AuthUser, require_hoa_admin
  models/
    db.py              # asyncpg connection pool
    schemas.py         # Pydantic models
  routes/
    hoa.py             # GET/POST /hoa/{id}/units, /hoa/{id}/compliance
    units.py           # GET/POST /unit/{id}/policy (upload + AI parse)
    tenants.py         # GET /tenant/me, /tenant/{id}, POST notify + invite
    documents.py       # GET/POST /hoa/{id}/documents, /unit/{id}/documents
    onboarding.py      # POST /onboard/association, GET/POST /invite/{token}
    alerts.py          # POST /alerts/run (cron endpoint)
  services/
    email.py           # Resend email templates
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
    AdminDashboard.jsx # /admin/dashboard — unit compliance table, invite/notify
    AdminTenantDetail.jsx  # /admin/tenant/:id — policy history, AI validation
    AdminDocuments.jsx # /admin/documents — upload shared HOA docs
    TenantDashboard.jsx    # /tenant/dashboard — policy upload, building docs
  components/
    Nav.jsx            # Top nav (uses React Router Link, not <a> tags)
    StatusBadge.jsx    # active/expiring/lapsed/missing pill
```

## Roles

- `hoa_admin` — association manager. `hoa_id` in JWT `app_metadata`. Sees admin routes.
- `tenant` — unit owner. No `hoa_id` in JWT; fetched from `/tenant/me`. Sees tenant routes.

Role and `hoa_id` live in Supabase `app_metadata`, read by the backend JWT decoder and the frontend `AuthContext`.

## Key env vars

Backend (Railway):
- `DATABASE_URL` — Supabase Postgres connection string
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — Claude Haiku dec page parsing
- `RESEND_API_KEY` / `FROM_EMAIL=alerts@condo.insure`
- `APP_URL=https://condo.insure`
- `ALLOWED_ORIGINS=https://condo.insure`
- `INTERNAL_API_KEY` — cron endpoint auth
- `QUOTE_FORM_URL` — Typeform quote link (optional; buttons hidden when unset)

Frontend (Railway, baked at build time via Vite):
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` — Railway backend URL (no trailing slash)
- `VITE_QUOTE_FORM_URL` — same Typeform URL as backend (optional)

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
```

Storage buckets (both public):
- `policy-documents` — tenant dec page uploads, path: `{unit_id}/{timestamp}.{ext}`
- `hoa-documents` — admin shared docs, path: `{hoa_id}/{timestamp}.{ext}`

## Deploy

Push to `main` → Railway auto-deploys both frontend and backend services.
No build step needed locally — Railway handles it.

## Test accounts

HOA: "Test HOA" (id: 00000000-0000-0000-0000-000000000001)
Admin logins: randy@lapsegaurd.com / troy@visser.com (password: password123)
Tenant logins: any of the 15 seeded tenants in units 104–403 (password: password123)
