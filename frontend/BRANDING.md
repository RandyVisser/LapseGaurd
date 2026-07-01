# condo.insure — Branding & Styling Reference

Single source of truth for the marketing/auth visual system. Read this before
touching `Landing.jsx`, the auth pages, `landing.css`, or any logo asset.
(Everything here is **live in prod** as of 2026-06-30.)

---

## 1. Brand palette

Pulled from the shield logo. **Color encodes meaning** (status), it isn't decoration.

| Token | Hex | Use |
|-------|-----|-----|
| Navy (ink/brand) | `#001842` | primary buttons, headings, "near-black" text. Darker variant `#0A2A63` for hover, `#06245C` mid-gradient |
| Blue (accent) | `#014AC5` | links, `.insure`, focus rings, secondary button. (The new logo art uses a near-identical blue `#014dd0` internally — use `#014AC5` in CSS.) |
| Green (Active/covered) | `#0E8E68` (bg `#E2F4EC`) | "Active/compliant" status only. On dark panels use mint `#6FE3B6` |
| Amber (Expiring) | `#946410` (bg `#FAEDD2`) | expiring status |
| Coral (Lapsed) | `#C0492F` (bg `#F9E1DA`) | lapsed status |
| Ink body | `#0B1B33` | body text |
| Muted | `#54627A` / `#8493A8` | secondary/tertiary text |
| Lines | `#E8ECF2` / `#DCE3EC` | borders |
| Navy brand gradient | `linear-gradient(150deg,#001842 0%,#06245C 62%,#014AC5 150%)` | auth brand panels, CTA band |

## 2. Typography

Loaded globally via Google Fonts `<link>` in `frontend/index.html` (available app-wide):

- **Bricolage Grotesque** (600/700/800) — display/headings. Friendly, homey. `letter-spacing:-.02em`, weight 800.
- **Hanken Grotesk** (400–700) — body / UI.
- **JetBrains Mono** (400/500/700) — data (unit #s, dates, prices), eyebrows/labels (uppercase, `letter-spacing:.14em`).

In React auth pages these are applied via inline `style={{ fontFamily: DISPLAY|BODY|MONO }}` constants (see §5). The landing applies them via `landing.css`.

## 3. Logo assets — `frontend/public/assets/`

| File | What | Used by |
|------|------|---------|
| `logo-full.svg` | full horizontal lockup (shield + `condo.insure` + "HO-6 Insurance Compliance. Automated." tagline). Transparent. | auth page headers (`Login/Signup/ForgotPassword/ResetPassword`) |
| `logo-mark.svg` | shield only (same art, cropped via viewBox). Transparent. | landing nav + footer lockups (paired with a text `condo.insure` wordmark) |
| `logo.png` | full lockup PNG, transparent, 1520×380 | email signatures / `www.condo.insure/assets/logo.png` |
| `logo-icon.png` | shield only PNG, transparent, square 512×512 | email signatures / `/assets/logo-icon.png` |
| `mark.svg` | OLD shield (pre-new-logo). **Unused** — safe to ignore/delete. |

**⚠️ Logo gotcha (important):** the source (`~/Desktop/new.svg`, Inkscape export) has
transparent bg + real letter counters, but Inkscape saved all geometry at **negative-Y
coords outside its `0 0 1174 585` viewBox** → renders **blank** in browsers (looks fine
in Inkscape, which shows off-canvas art). The fix already applied: reframe the viewBox to
the true `getBBox()` bounds:
- `logo-full.svg` → `viewBox="-62 -409 1087 272"`
- `logo-mark.svg` → `viewBox="-60 -407 234 268"`

**Regenerating PNGs from an SVG:** render with headless Chromium via
`page.goto('file:///tmp/x.html')` on a **real file page** — NOT `page.setContent()`
(about:blank blocks `file://` image loads → you silently export a transparent/blank PNG).
Screenshot the `<img>` element with `{ omitBackground: true }` for transparency.

## 4. Landing page — `frontend/src/pages/Landing.jsx` + `landing.css`

- **`landing.css`**: the full design system, **every selector scoped under `.lp`** (the
  root wrapper `<div className="lp">`) so its semantic class names (`.btn`, `.row`,
  `.board`, `.tab`, `.pill`, …) can't collide with the app's Tailwind utilities. CSS
  vars (`--navy` etc.) live on `.lp`. Global resets (`*`, `a`, reduced-motion) are also
  scoped to `.lp`. The ONE intentional global is `html{scroll-behavior:smooth}` (for nav
  anchor links `#features`/`#how`/`#pricing`).
- **Animation is JS-driven, ported into ONE `useEffect` keyed to `rootRef`** (all DOM
  queries scoped to the component root; cleanup cancels rAF, clears timers, disconnects
  observers — StrictMode-safe). Pieces: hero board resolves Lapsed→Active on scroll-in;
  auto-advancing feature tabs (`DUR=10400`ms, progress bars, pause-on-hover scoped to
  `.panel-stage` ONLY — don't widen it); two-beat tab board (`resolveTabBoard`); per-panel
  CSS showcase animations gated on `.panel.show ...` (replay each cycle); `.reveal`
  scroll-reveals via IntersectionObserver.
- **4 feature tabs:** Compliance board · AI dec-page review · Email it in (fake iPhone →
  .pdf flies → mini dashboard flips Missing→Active) · Document center.
- **Sections in order:** nav → hero (live board) → feature tabs → stakes (navy) → how (5
  steps) → pricing → FAQ (`<details>`) → CTA → footer.

## 5. Auth pages — pattern (Login / Signup / ForgotPassword / ResetPassword)

All restyled with **plain Tailwind + inline font styles — NO new CSS file** (deliberately
delicate; kept the app's Tailwind convention). Shared constants at top of each file:

```js
const DISPLAY = '"Bricolage Grotesque", sans-serif'
const BODY = '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif'
const MONO = '"JetBrains Mono", monospace'
const BRAND_GRAD = 'linear-gradient(150deg,#001842 0%,#06245C 62%,#014AC5 150%)'
const INPUT = 'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-[#0B1B33] placeholder-slate-400 focus:outline-none focus:border-[#014AC5] focus:ring-1 focus:ring-[#014AC5]'
const LABEL = 'block text-sm font-medium text-[#0B1B33] mb-1.5'
```

- Brand colors via **Tailwind arbitrary values**: `bg-[#001842]`, `hover:bg-[#0A2A63]`,
  `text-[#001842]`, `text-[#54627A]`, `text-[#014AC5]`, etc. (Tailwind v3 JIT — fine.)
- **Primary button** = navy: `bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold`.
- **Layout:** Login + Signup use a **split** — white form left (`flex-1`), navy gradient
  **brand panel right** (`hidden lg:flex`, mint `#6FE3B6` bullets); panel drops away on
  mobile. Forgot + Reset are single centered columns. Every page has the full logo
  (`logo-full.svg`) at top.
- **Brand panel "squares":** the panel has a `SQUARES` overlay `<div aria-hidden>` — a
  faint 32px white grid faded by a radial mask (`radial-gradient(90% 90% at 80% 25%,#000,
  transparent 72%)`), over the `BRAND_GRAD`. Ported from the offline mockup's `.auth-brand`.
  Panel copy: an eyebrow, a Bricolage headline, a mint feature/step list, and a bottom
  quote line with `border-t border-white/15`.
- **⚠️ DO NOT touch the auth logic.** All Supabase calls, form fields, validation, the
  Signup HO-6 requirements + certifications + success state, the ResetPassword
  recovery-session `verify()` effect (token_hash / PKCE / error / implicit flows) and its
  3 states (verifying/invalid/ready) are load-bearing. Restyle presentation only.

## 6. Footer & legal

Footer shows **`condo.insure™`** (TM superscript on the wordmark) and **no `©`/copyright
line** — Randy holds a trademark, not a registered copyright. Middle line: "Insurance
Compliance. Simplified." Don't reintroduce a `©`.

## 7. Key links / values (wired in Landing.jsx)

- **Book a demo** → `https://calendar.app.google/FomLtiZGYqtmt8jUA` (dad's Google
  Appointment Schedule; `target="_blank"`). Single source of truth for demo CTAs.
- **Watch the 2-min tour** → Descript modal, embed `https://share.descript.com/embed/yR7DW1QXNOZ`.
- **Start free** → `/signup` · **Sign in** → `/login`.
- **Pricing (REAL, 3-band graduated, $50/mo minimum):** $1.00/unit up to 750 units ·
  $0.50/unit 751–10,000 · $0.25/unit 10,000+. (A separate older `/pricing` route
  `Pricing.jsx` still exists with the old look — reconcile someday.)

## 8. Status

**Done & live:** Landing redesign, all 4 auth pages restyled, new logo everywhere, footer TM.

**Open follow-ups:** old `/pricing` route (`Pricing.jsx`) not restyled; `docs@condo.insure`
email-in address is a placeholder (needs inbound subdomain); reconcile landing pricing
copy with dad's Framer packaging ($50 + $500 mins, $750 cap) if desired.

## 9. Previewing / screenshots (no ffmpeg; Swift toolchain broken on this Mac)

Playwright lives in the sibling scratch dir `~/Desktop/lapsegaurd-promo/` (keep tooling
OUT of the prod repo). Typical loop: `npm run build` then `npm run preview -- --port 4173`
in `frontend/`, then a `.cjs` Playwright script (promo `package.json` is ESM → must be
`.cjs`) that `goto`s `http://localhost:4173/...`. Downscale shots over 2000px with
`sips -Z 1400 in.png --out out.png` before viewing. Landing `.reveal` sections start
`opacity:0` — scroll or force `.in` to see them in a static capture.
