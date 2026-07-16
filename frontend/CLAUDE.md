# Frontend context

Design system: @BRANDING.md — read it before any UI/logo/auth-page work.
Fonts (global via index.html): Bricolage Grotesque (display) / Hanken Grotesk
(body) / JetBrains Mono (data, eyebrows, unit numbers, prices).

## The classic dashboard is sacred (Randy, 2026-07-12)

Single-association viewers — an hoa_admin, or a PM who can see exactly one
association — always get the classic per-association dashboard: hero gauge,
chips, needs-attention strip, unit table (visual reference:
`lapsegaurd-promo/dashboard/index.html`, outside this repo). **Never stack
firm KPI blocks or merged tables on top of it.** Multi-association PMs land
on `FirmDashboard.jsx` instead (portfolio KPIs + association list; a row
click opens that association's classic dashboard), which makes exactly TWO
aggregate calls (`/pm/overview` + `/pm/associations`) — no per-HOA fan-out.
Keep it that way; the fan-out pattern elsewhere is the thing that won't scale.

## Selection model (AuthContext)

`selectedHoaId` is global state shared across pages. Landing defaults:
super_user → Sandbox (never default to the heavy all-associations aggregate —
perf decision); PM → their one association if they can see exactly one, else
`'__all__'` (the firm list); hoa_admin → their association. The Settings
page's all-associations default and the dashboard's super-user firm-portfolio
view are PAGE-LOCAL overlays — they must never write `'__all__'` or `firm:*`
values into the global selection, or other pages get dragged onto expensive
views.

## Gotchas

- Every new `VITE_*` var must be declared ARG+ENV in `Dockerfile.prod` or
  Railway silently drops it from the build (env is baked at build time).
- The landing `#pricing` section's static tier copy mirrors backend
  `_volume_monthly_cents` and the live Stripe Price — the three change
  together or invoices diverge from the UI (`src/pricing.js` is gone,
  deleted 2026-07-12; billing panels read backend-computed rates).
- `landing.css` is fully scoped under `.lp`; `.reveal` elements are opacity:0
  until an IntersectionObserver adds `.in` — reusing landing classes on a new
  page without wiring the observer renders invisible sections (bit us on
  /vista_royale).
- Keep the `lapseguard.*` localStorage key prefix — renaming it silently
  resets every user's saved preferences.
- Nav uses React Router `<Link>`, never `<a>` (full-page reloads lose state).
- Status labels live in `StatusBadge.jsx` and the dashboard chips — they are
  product copy Randy tunes; don't "normalize" them.
