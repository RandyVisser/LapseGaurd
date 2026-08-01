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
  **Exception:** `/guides/*` are static HTML files, not routes — link to them
  with a plain `<a>` or you land on the SPA catch-all.
- Status labels live in `StatusBadge.jsx` and the dashboard chips — they are
  product copy Randy tunes; don't "normalize" them.

## The `/guides/` static pages + serve config (SEO/GEO surface)

`public/guides/*.html` are hand-written static pages that exist to be read by
search engines and **AI crawlers** (GPTBot, ClaudeBot, PerplexityBot), which
mostly do not execute JS — so they deliberately bypass React entirely. They
carry their own `<head>`, JSON-LD, and `guides.css` (self-contained; it must
NOT reuse `landing.css`, whose `.reveal` rules render blank without JS).

Three ways to silently break them — all return HTTP 200, so nothing looks wrong:

- **Never re-add `-s`/`--single` to the `serve` command in `Dockerfile.prod`.**
  `-s` implies `cleanUrls`, which 301s `/foo.html` → `/foo`, which then hits the
  catch-all rewrite and returns `index.html`. Every guide becomes the SPA. The
  explicit `rewrites` entry in `public/serve.json` does the same SPA fallback
  without that side effect; `"cleanUrls": false` is what keeps `.html` reachable.
- **`serve.json` rejects unknown keys** (`must NOT have additional properties`)
  and the container then refuses to boot — do not add comment keys to it.
- URLs are `/guides/<slug>.html`. Extensionless and directory-index paths get
  swallowed by the catch-all; `/guides/` itself serves the SPA, which is why the
  index page is linked as `/guides/index.html`.

Verify after touching any of this: `npx vite build && npx serve dist -l 4173`,
then confirm a guide URL returns its own `<h1>` and contains **no** `id="root"`.
`robots.txt` and `sitemap.xml` live in `public/` and must return `text/plain` /
`application/xml` — if either returns `text/html`, the fallback has eaten them.
