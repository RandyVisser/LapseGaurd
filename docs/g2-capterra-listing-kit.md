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

- **Primary: HOA.** Settled on the live Capterra taxonomy — see §11 for the
  evidence and why "Association Management" is the wrong list despite the name.
- **Secondary:** Property Management, or an insurance category if offered.
- **Do NOT use Association Management** — wrong audience, not merely weaker.

Prefer a *narrower* category where offered. Being credible in a small, precise
category beats being invisible in Property Management, which is dominated by
AppFolio, Buildium and Yardi.

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

---

## 7. Assets to upload

| Asset | Where it is | Status |
|---|---|---|
| Logo (square) | `frontend/public/assets/logo-icon.png` (512×512, transparent) | ✅ ready |
| Logo (horizontal) | `frontend/public/assets/logo.png` (1520×380, transparent) | ✅ ready |
| Social/banner | `frontend/public/assets/og-image.png` (1200×630) | ✅ ready |
| Product screenshots | `~/Desktop/lapsegaurd-promo/shots/out/` | ✅ **14 captured** |
| Demo video | see §7a below | ✅ 2-min tour |

Screenshots were captured against **Sandbox Condo only** (never 3 Island or
Vista Royale — real customers with real owner emails), at 1440×900 @2× retina.
The capture script is `lapsegaurd-promo/shots/capture.cjs`; it sets `?notrack=1`
first so no funnel beacons are recorded, and it is read-only — it never submits
a form, uploads, invites, or notifies.

⚠️ One hazard the script deliberately avoids: clicking a **Missing** unit row in
the dashboard POSTs to `/unit/{id}/tenant` and **creates a tenant record**. The
unit-detail shots navigate directly to known tenant IDs instead.

### Recommended six, with captions

⚠️ **Captions are capped at 80 characters** on both platforms. Every caption
below is verified under that limit — the length is shown so you can see the
headroom if you want to edit one. Paste exactly; don't add a trailing period,
several platforms append their own punctuation.

Upload in this order — the first is what appears on the category listing card.

| # | File | Caption | Len |
|---|---|---|---|
| 1 | `04-compliance-dashboard.png` | `Every unit's HO-6 status on one live dashboard` | 46 |
| 2 | `10-unit-detail-clean.png` | `AI checks each policy against your association's requirements` | 61 |
| 3 | `06-unit-detail-approved.png` | `Expired and non-compliant policies are flagged automatically` | 60 |
| 4 | `05-unit-table.png` | `Sort, filter and export every unit by compliance status` | 55 |
| 5 | `08-document-center.png` | `Shared association documents, available to every owner` | 54 |
| 6 | `02-landing-features.png` | `Compliance board, AI dec-page review, email-in, documents` | 57 |

### Also available

| File | Caption | Len |
|---|---|---|
| `01-landing-hero.png` | `Know every unit is covered, without a spreadsheet` | 49 |
| `11-unit-detail-flagged.png` | `See exactly which requirement a policy failed` | 45 |
| `09-settings.png` | `Set the coverage minimums your association requires` | 51 |
| `03-landing-how.png` | `From a guess to a dashboard in five steps` | 41 |

Plus `-scrolled` variants of the unit-detail shots showing the extracted policy
fields and history. Reuse the caption of the shot they belong to.

### Not captured, and why

- **Firm portfolio dashboard** — the sandbox firm ("Sandbox Property Group")
  manages exactly one association, and a PM who can see one association is
  deliberately routed to the classic per-association dashboard instead. Getting
  this shot needs a second sandbox association, which is a product decision, not
  a screenshot decision.
- **Email-in flow / board report email** — not app screens. The landing page's
  "Email it in" feature tab is the closest existing visual.

## 7a. Demo video

Both of these resolve (verified 2026-08-01):

- **Descript share page:** `https://share.descript.com/view/yR7DW1QXNOZ` — a real
  watch page, best for fields wanting a URL
- **Direct MP4 (what the site actually plays):**
  `https://ykbjvmqdkczqyzyylwxo.supabase.co/storage/v1/object/public/public-assets/tour.mp4`
  (10.8 MB, in the public `public-assets` bucket)

⚠️ `Landing.jsx` and `VistaRoyale.jsx` both play the **Supabase MP4**, not the
Descript embed — so the MP4 is the current tour. Confirm the Descript version
matches before linking it publicly; if it is an older cut, upload the MP4
instead.

⚠️ **G2 and Capterra generally expect a YouTube or Vimeo URL** for the video
field. Neither a Descript share page nor a raw MP4 reliably embeds. The clean
fix is a one-time unlisted YouTube upload of `tour.mp4`, then use that URL
everywhere — including a `VideoObject` on the landing page later.

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

---

## 11. Answers used on the Capterra submission (2026-08-01)

Reuse these verbatim for G2 — same decisions apply.

### Category: **HOA**, not Association Management

Counterintuitive, and the feature lists are the evidence. "Association
Management" on Capterra means **membership organizations** — its feature list is
Chapter Management, Fundraising, Job Board, Member Directory, Event Ticketing,
Dues Management. That's chambers of commerce and trade bodies, not community
associations.

The HOA list is the right world (HOA Violation Enforcement, Property Database,
Work Order Management, Fee Collection) and — decisively — it contains
**Portfolio Management**, which Association Management does not. That is the
PM-firm north star as a literal filter checkbox.

Do **not** use Association Management as a secondary either; it is the wrong
audience, not merely the weaker one.

### Features — 15 of 43 checked

Generative AI · Portfolio Management · Access Controls/Permissions · Reminders ·
Alerts/Notifications · Activity Dashboard · Reporting/Analytics · Document
Management · File Management · Self Service Portal · Property Database · Member
Database · Contact Management · Member Communication · Activity Tracking

**Deliberately unchecked, and why it matters:** every money feature — Fee
Collection, Billing & Invoicing, Accounting, General Ledger, Bank Reconciliation,
Payment Processing, Electronic Payments, Expense Tracking, Transaction History,
Recurring/Subscription Billing. Our Stripe integration bills *the association for
condo.insure*; it does not collect dues from owners. In this category those
checkboxes mean the latter, and ticking them invites a head-to-head with Vantaca
and CINC on their strongest ground.

Also unchecked: HOA Violation Enforcement, Work Order Management, Maintenance
Scheduling, Vendor Management, **Inspection Management** (we *write* about
milestone inspections — the product does not manage them; don't let content
credibility leak into a product claim), SMS Messaging (roadmap, not built),
AI Copilot (parsing is not a chat assistant), API, Third-Party Integrations,
Real-Time Notifications (alerts run on a daily cron).

Checking ~15 of 43 reads as a focused point solution. Checking 30 reads as a
thin all-in-one, and surfaces us in filters we cannot satisfy.

### Target market (200-char limit — this is 185)

```
Condo and homeowner associations, and the property management firms that run them. Board presidents, treasurers, and community association managers running multi-association portfolios.
```

ASCII-only on purpose; smart quotes and em-dashes can shift the count on paste.
Florida is deliberately omitted — the version naming it landed at exactly 200,
and geography belongs in the long description rather than a hard filter.

### Target industries

Priority order, nearest match wins: Real Estate → Property Management →
Insurance → Facilities Services. Stop at four; more dilutes rather than broadens.

### Target company size: 1 · 2-10 · 11-50 · 51-200 · 201-500

"Company size" means **employees, not units** — a firm managing 10,000 units may
have 80 people, so 51-200 already covers a large Florida firm. `1` and `2-10`
are real: a self-managed association is a volunteer board. Stopped at 201-500;
above that is national operators with entrenched vendors.

### Target number of users: 1 · 2-10 · 11-50

Smaller than company size **because owners don't need accounts** — they forward
an email. Seats are board members and PM staff only, so a 300-unit association
might be three users. Left 51-200 off: not a claim we can back with a reference
customer yet.

⚠️ Keep this consistent with pricing. A $50/mo minimum and a 1–750 unit first
tier signal small-to-mid; enterprise sizing next to a $50 floor reads as confused.
