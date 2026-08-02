# G2 + Capterra listing kit

Everything needed to claim and fill both vendor profiles. Prepared 2026-08-01.

**Why this is a doc and not a done task:** claiming a vendor profile means
creating an account as an authorized representative of condo.insure, verifying a
business email, and accepting a vendor agreement. Capterra (Gartner) listings
also feed a pay-per-click lead program. Those are commercial commitments only
Randy or Troy can make. The copy below is ready to paste.

**Why bother:** these are two of the highest-authority backlinks available to a
new B2B SaaS domain, and LLMs cite them constantly when asked "best X software."
For the GEO work this is worth more than another guide page.

---

## 1. Where to go

| | URL | Notes |
|---|---|---|
| **G2** | `g2.com` → Vendor Solutions → "Claim your profile" / add product | Free tier is enough. Verify with `randy@condo.insure`. |
| **Capterra** | `capterra.com/vendors` | Gartner network — one submission also populates **Software Advice** and **GetApp**. Free listing available; decline PPC until you want paid leads. |

Use `randy@condo.insure` for both (Google Workspace, so the verification mail
arrives normally). Do **not** use a `sandbox-*` address — those are the analytics
exclusion pattern and are not real mailboxes.

---

## 2. Core fields

**Product name:** `condo.insure`

**Website:** `https://www.condo.insure`
(the `www` host — the bare domain 301s)

**Tagline (≤60 chars):**
> HO-6 insurance compliance, tracked automatically

**Short description (~150 chars):**
> HO-6 insurance compliance tracking for condo associations and property
> management firms. AI reads every declaration page and chases renewals for you.

**Long description:**
> condo.insure tells a condominium board or property manager exactly which units
> have current HO-6 insurance — without anyone maintaining a spreadsheet.
>
> Owners submit a declaration page by forwarding the email their insurer already
> sent them. No account, no password, no portal. AI reads the document, extracts
> the insurer, policy number, expiration date and coverage limits, and checks
> them against what the association requires. Every unit lands on one dashboard
> as Active, Expiring, Lapsed or Missing.
>
> Renewal reminders send themselves on a schedule, so a policy that lapses in
> March is chased in February rather than discovered at a claim. Bounced email
> addresses are surfaced instead of silently swallowed, and units are matched on
> street address plus unit number — which matters in associations where unit
> numbers repeat across buildings.
>
> Property management firms get a portfolio view across every association they
> manage, with role-based access, staff assignment groups, and either
> consolidated billing or pass-through billing at the firm's bulk rate.
>
> Built for Florida condominiums first: the platform understands wind-excluded
> HO-6 policies paired with a separate wind-only policy, loss assessment limits,
> and the coverage lines Florida declarations actually require.

**Founded:** 2026 · **HQ:** Florida, United States · **Employees:** 1–10

---

## 3. Categories

Taxonomies shift, so pick the nearest match to these:

- **Primary:** Association Management / HOA software
- **Secondary:** Property Management software
- **Also relevant:** Insurance compliance, Document management, Compliance
  tracking

Prefer a *narrower* category where offered. Being credible in "HOA / association
management" beats being invisible in "Property Management," which is dominated
by AppFolio and Yardi.

---

## 4. Pricing — must match the app

⚠️ These three must always agree: `_volume_monthly_cents` in
`backend/routes/billing.py`, the live Stripe Price, and the landing `#pricing`
copy. **This listing is now a fourth place.** If pricing changes, update it here
too or the listing contradicts the invoice.

- **Model:** per unit, per month · **Free trial:** 90 days · **No setup fee**
- **1–750 units:** $1.00 / unit / month
- **751–10,000 units:** $0.50 / unit / month
- **10,000+ units:** $0.25 / unit / month
- **Minimum:** $50 / month
- Volume pricing — every unit bills at the rate of the tier the *total* lands in
- Example to enter: *a 120-unit association pays $120/month*
- Management firms: no $50 minimum on the firm bulk rate

Starting price to enter: **$50.00 / month**

---

## 5. Feature list

- AI declaration-page parsing (insurer, policy number, expiration, coverage limits)
- Compliance dashboard: Active / Expiring / Lapsed / Missing per unit
- Automated renewal reminders (30/7/1 day, lapsed, non-compliant)
- Email-in submission — owners forward their insurer's email, no login required
- Owner invitations with secure one-time links
- Bounced-address detection and automatic re-invite on correction
- Wind-excluded HO-6 + wind-only policy pairing
- Loss assessment and coverage-limit verification against association minimums
- Shared association document library
- Multi-association portfolio view for management firms
- Role-based access (owner / manager / member) and assignment groups
- Board reports, emailed on a monthly schedule
- CSV import from property records and CSV export
- Manual approval override with audit trail
- Consolidated or pass-through firm billing
- Rental/renter HO-4 tracking for sub-units

---

## 6. Differentiators (for "why choose us" fields)

1. **Owners never create an account.** Forwarding an email is the whole workflow.
   Every login requirement costs response rate.
2. **Documents are read, not just stored.** Most tools file a PDF and still need
   a human to type the expiration date. If nobody types it, nothing watches the
   calendar.
3. **Built for Florida's actual policy structures** — a wind-excluded HO-6 plus a
   separate wind-only policy is a compliant pair, not two errors.
4. **Matching on address + unit number**, so multi-building associations don't get
   silent wrong-unit matches.
5. **Portfolio-native for management firms**, not one login per association.

Named competitor to expect on comparison pages: **Mackoul**.

---

## 7. Assets to upload

| Asset | Where it is | Status |
|---|---|---|
| Logo (square) | `frontend/public/assets/logo-icon.png` (512×512, transparent) | ✅ ready |
| Logo (horizontal) | `frontend/public/assets/logo.png` (1520×380, transparent) | ✅ ready |
| Social/banner | `frontend/public/assets/og-image.png` (1200×630) | ✅ ready |
| Product screenshots | — | ❌ **needed — 4–6 shots** |
| Demo video | `https://share.descript.com/view/yR7DW1QXNOZ` | ✅ existing 2-min tour |

**Screenshots still to produce** (capture against **Sandbox Condo** only — never
3 Island or Vista Royale, which are real customers with real owner emails):

1. Compliance dashboard — hero gauge + unit table
2. AI dec-page review — extracted fields beside the document
3. Firm portfolio dashboard — multi-association KPIs
4. Owner submission flow — the email-in path
5. Document center
6. Board report email

---

## 8. Getting reviews

Listings without reviews rank poorly and read as abandoned. G2 and Capterra both
gate "leader"-style placement on review count, and LLMs quote review text.

Target: **3–5 reviews.** Realistic sources are 3 Island, Vista Royale, and the
management firm contacts from the mailer campaign.

⚠️ **HARD RULE — do not email 3 Island or Vista Royale without Randy/Troy's
explicit OK.** They are real customers with real owner addresses. A review
request should come from Randy or his dad **personally, from their own mailbox** —
not through Resend, and not through any automated product email.

Draft, to be sent by a human:

> Subject: Quick favor — 2 minutes?
>
> Hi [name],
>
> You've been using condo.insure for a few months now to keep on top of HO-6
> compliance at [association]. We're listing on G2 and Capterra, where boards and
> managers go to compare software, and reviews are what make a new listing
> credible.
>
> Would you be willing to leave an honest review? It takes about two minutes:
> [link]
>
> Honest is genuinely what's useful — if something's been frustrating, say so.
> That's more helpful to us than five stars.
>
> Thanks either way,
> [name]

Both platforms prohibit incentivizing positive reviews. G2 sometimes offers a
gift card *for reviewing*, regardless of sentiment — that's allowed and comes
from them, not you. Never offer anything yourself.

---

## 9. What to expect afterwards

- **Sales calls.** Both will pitch paid placement within days. The free listing
  is what you want right now; paid leads only make sense once the trial-to-paid
  motion is proven.
- **Capterra PPC is opt-in.** Decline until you have a reason.
- **Gartner network spillover.** One Capterra submission usually appears on
  Software Advice and GetApp too — three backlinks for one form.
- **Timeline:** moderation typically takes a few business days. Reviews need
  independent verification, so budget a couple of weeks before the profile looks
  populated.

---

## 10. Adjacent, same afternoon

While you're doing vendor profiles, these are the same kind of work and cheap:

- **LinkedIn company page** — currently missing; a free authoritative backlink
- **Crunchbase** — free profile, well-crawled
- **Product Hunt** — one-time launch spike, decent link
- **Florida CAI chapter** — vendor/sponsor listing, exactly your vertical and
  more relevant to buyers than any of the above
