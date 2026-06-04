# LapseGuard

B2B SaaS compliance tool for condo HOA insurance tracking. HOA admins get a real-time compliance dashboard; tenants upload proof of insurance and receive automated expiration alerts.

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI (Python 3.12) |
| Frontend | React 18 + Tailwind CSS + Vite |
| Database | PostgreSQL 15 |
| Auth | Supabase (JWT, multi-role) |
| File storage | Supabase Storage |
| Email | Resend |
| Hosting target | Railway |

## Quick start

```bash
cp .env.example .env   # fill in your secrets
docker compose up
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |
| Postgres | localhost:5432 |

The database schema is applied automatically on first run from `migrations/001_initial_schema.sql`, including a seeded demo HOA and three units.

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
│   │   ├── hoa.py                  # /hoa/{id}/units, /hoa/{id}/compliance
│   │   ├── units.py                # /unit/{id}/policy
│   │   ├── documents.py            # /unit/{id}/documents, /hoa/{id}/documents
│   │   └── alerts.py               # /alerts/run (internal cron endpoint)
│   └── scripts/
│       └── run_alerts.py           # standalone alert job (Railway cron)
└── frontend/
    └── src/
        ├── pages/
        │   ├── Login.jsx
        │   ├── AdminDashboard.jsx
        │   ├── AdminDocuments.jsx
        │   └── TenantDashboard.jsx
        └── components/
            ├── Nav.jsx             # role-aware navigation
            └── StatusBadge.jsx     # active / expiring / lapsed / missing
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

Roles are stored in Supabase user metadata (`user_metadata.role`):

| Role | Access |
|---|---|
| `hoa_admin` | All units and documents within their HOA |
| `tenant` | Their own unit and HOA shared documents |

Set role when creating users in Supabase:
```json
{ "role": "hoa_admin", "hoa_id": "<hoa-uuid>" }
{ "role": "tenant" }
```

## API routes

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/hoa/{id}/units` | admin | List all units with compliance status |
| GET | `/hoa/{id}/compliance` | admin | Summary counts (compliant, expiring, lapsed, missing) |
| POST | `/unit/{id}/policy` | tenant/admin | Upload policy metadata + doc URL |
| GET | `/unit/{id}/documents` | tenant/admin | List HOA shared documents |
| POST | `/hoa/{id}/documents` | admin | Upload HOA shared document |
| POST | `/alerts/run` | internal | Run expiration check + send emails |

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
| `VITE_SUPABASE_URL` | Supabase project URL (frontend) |
| `VITE_QUOTE_FORM_URL` | TypeForm URL for the quote CTA |

## Deploying to Railway

1. Create a Railway project with three services: `backend`, `frontend`, `db` (or point to Supabase for DB)
2. Set all env vars from `.env.example` in the Railway dashboard
3. Add a Railway cron job: `POST https://<backend-url>/alerts/run` with `X-Api-Key` header, daily schedule
