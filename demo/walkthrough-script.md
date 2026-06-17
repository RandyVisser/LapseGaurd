# condo.insure — Product Walk-through Script

A ~3–4 minute screen-recorded demo in two acts:

- **Act 1 — The Association Manager:** sign up, import the owner list, set requirements, invite an owner.
- **Act 2 — The Unit Owner:** receive the invite, create an account, upload a policy, watch it auto-verify.

> Timings are targets for a brisk, narrated pace. Everything in `code font` is an exact
> on-screen label or value. Narration is the voiceover (or on-screen captions).

---

## Pre-production checklist

Do these **before** you hit record so the take is clean:

1. **Two browser profiles (or one normal + one incognito window).**
   - Window A = the manager (Maria's *association*).
   - Window B = the unit owner (Maria Garcia). Keeping them separate avoids session
     collisions and makes the "two sides" obvious on screen.
2. **A real inbox you control for the owner.** Unit 204's `Owner Email` in
   `demo/sample-units.csv` is already set to **`troy@universalcondo.com`** — make sure you can
   open that inbox on camera, since the invite link is emailed there. (Swap it for a different
   address if you'd rather receive the invite somewhere else.)
3. **Assets ready on the desktop:**
   - `demo/sample-units.csv` — the owner list to import.
   - `demo/sample-dec-page.pdf` — Maria Garcia's HO-6 declaration page to upload (it's
     built to *pass* the requirements you set, so the demo ends on a green "You're covered").
4. **Pick a clean association name** you'll type at signup: **`Sunset Villas Condominium Association`**.
5. **Zoom the browser to ~110–125%** so text is legible in the recording, and hide your
   bookmarks bar / personal tabs.

---

## ACT 1 — The Association Manager

### Scene 1 · Sign up the association · ~30s
**Screen:** `/signup` (from the landing page, click **Get started / Sign up**).

**Actions:**
1. Fill the form:
   - `Association Name` → `Sunset Villas Condominium Association`
   - `Address` → `1420 Seabreeze Blvd, Clearwater, FL 33767`
   - `Your Name` → `Jordan Reyes` (the manager)
   - `Email` → your manager test inbox
   - `Password` → `demo-pass-123`
2. Scroll to **HO-6 Policy Requirements**. Set:
   - `Coverage A (Dwelling) min` → `50000`
   - `Coverage E (Liability) min` → `300000`
   - Leave checked: *in-force policy*, *named insured matches*, *property address matches*,
     *wind coverage* (already on by default).
3. Click **`Create Account`**.

**Narration:** "Setting up an association takes about a minute. I name the association, add
the property address, and set the insurance requirements every owner has to meet — minimum
dwelling and liability coverage, and wind coverage, which matters here in Florida."

> After submit you'll see a "Your account is ready" screen. Click **Sign in** — the account is
> active immediately, no email confirmation needed.

---

### Scene 2 · Sign in · ~10s
**Screen:** `/login`.

**Actions:** Enter the manager email + `demo-pass-123` → **Sign in** → lands on the
**Compliance Dashboard**.

**Narration:** "Now I log into my dashboard. It's empty — let's bring in our owners."

---

### Scene 3 · Import the unit-owner list · ~45s
**Screen:** Admin dashboard. A **Getting started** panel is showing.

**Actions:**
1. Click **Import units** (toolbar button, top-right — or step 1 of the Getting started panel).
2. In the wizard, click the dashed box and choose **`sample-units.csv`**.
3. The wizard reads the file and shows the **Column matchup** — *your* spreadsheet's columns
   auto-mapped to condo.insure's fields. Pause here a beat to let it land.
4. Point out the amber warning: **`1 email looks invalid`** (that's Unit `201`, whose address
   is missing the `@`). Hover the warning — the offending row highlights. Click that email
   cell and fix it to `dthompson.demo@gmail.com`.
5. Click **`Import 9 units`**. Land on the **🎉 9 units imported** confirmation → **Done**.

**Narration:** "I don't have to reformat anything — I just drop in the spreadsheet exactly
as it is. condo.insure reads my columns automatically and maps them. It even flags a bad
email before I import, so I fix it right here. One click, and all nine units are in."

> The grid now lists Units 101–302, each as **No policy on file / Not invited yet**.

---

### Scene 4 · Review requirements in Settings · ~25s
**Screen:** `/admin/settings` (top nav → **Settings**).

**Actions:**
1. Scroll to **HO-6 Policy Requirements** — show the coverage minimums and toggles you set
   at signup; this is where they can be changed any time.
2. Scroll up to **Email Alert Settings** — show the automatic reminders (invite re-sends,
   renewal 30/7/1, expired, non-compliant). Don't change anything; just show it exists.

**Narration:** "Every requirement lives in Settings, so I can tighten or relax them later.
And condo.insure handles the nagging for me — automatic invite, renewal, and lapse reminders
go out on a schedule, so I'm not chasing owners by hand."

---

### Scene 5 · Invite an owner · ~25s
**Screen:** Back to the dashboard (top nav → **Dashboard**).

**Actions:**
1. Find the **Unit `204` — Maria Garcia** row.
2. Click the **⋯** action menu on that row → **`Invite Primary Owner`**.
3. The invite dialog opens with Maria's email pre-filled. Click **`Send Invite`**.
4. The row shows **Invite sent ✓**, and the **Invite Sent** stat ticks up.

**Narration:** "When I'm ready, inviting an owner is one click. Maria gets a secure link to
set up her account and send in her policy. Let's switch over and become Maria."

---

## ACT 2 — The Unit Owner

### Scene 6 · Receive the invite · ~20s
**Screen:** Window B — the owner's email inbox.

**Actions:**
1. Open the email from **condo.insure** ("You're invited to …").
2. Read the one-liner, then click the **invite / set-up-your-account** button. It opens
   `/join/<token>`.

**Narration:** "Maria gets an email inviting her to join Sunset Villas. She clicks the link —
no app to download, no account number to find."

> If you'd rather not show a live inbox, you can preview the exact email first from the
> manager side: **Settings → Email Previews → Invite**. But to actually *click through*,
> use the real email.

---

### Scene 7 · Create the owner account · ~20s
**Screen:** `/join/<token>` — "Create your account", showing `Sunset Villas…`, `Unit 204`,
and her email.

**Actions:**
1. `Your Name` → `Maria Garcia`
2. `Set a Password` → `owner-pass-123`
3. Click **`Create Account`** → redirected to sign in → log in as Maria.

**Narration:** "The link already knows who she is and which unit she owns. She just sets a
name and password, and she's in."

---

### Scene 8 · Upload the policy · ~35s
**Screen:** Maria's **tenant dashboard**. The hero banner is red: **No policy on file**, and
a **Next Steps** helper points at the yellow upload box.

**Actions:**
1. Click the **yellow dashed upload box** (it says "Drag & drop your dec page").
2. Choose **`sample-dec-page.pdf`**. The box turns green with the filename.
3. Click **`Submit`**.
4. The banner switches to **Reading your document…** — let the AI parse run (10–30s; the page
   polls and updates itself). Narrate over this beat.
5. It resolves to a green **You're covered** hero, with the extracted **Insurer**,
   **Expires** date, and **Policy #** filled in automatically.

**Narration:** "Maria uploads her declaration page — a PDF straight from her insurer. This is
the magic: condo.insure reads the document with AI, pulls out the carrier, the policy number,
the expiration date, and the coverage amounts, and checks them against the association's
requirements. A few seconds later… she's verified. Green means she's fully compliant — no
spreadsheet, no phone tag, no manual review."

---

### Scene 9 · Close the loop (optional) · ~15s
**Screen:** Switch back to Window A — the manager dashboard. Refresh.

**Actions:** Show **Unit 204** now reads **Active · Meets Requirements** (green), and the
**Active** stat has gone up by one.

**Narration:** "And back on the manager's side, Maria's unit flips to compliant
automatically. That's condo.insure — every owner's insurance, tracked and verified on its own."

---

## Shot list (quick reference)

| # | Side | Screen | Key click |
|---|------|--------|-----------|
| 1 | Mgr | `/signup` | Create Account |
| 2 | Mgr | `/login` | Sign in |
| 3 | Mgr | Dashboard → Import wizard | Import 9 units |
| 4 | Mgr | `/admin/settings` | (show requirements + alerts) |
| 5 | Mgr | Dashboard | ⋯ → Invite Primary Owner → Send Invite |
| 6 | Owner | Email inbox | Click invite link |
| 7 | Owner | `/join/<token>` | Create Account |
| 8 | Owner | Tenant dashboard | Upload dec page → Submit |
| 9 | Mgr | Dashboard | (show Unit 204 now green) |

---

## Known gotchas (fix or film around these)

- **The owner invite needs a real inbox.** Demo emails in the CSV (`*.demo@gmail.com`) won't
  reach you. Swap Unit 204's email for a real alias before recording (see checklist #2).
- **AI parsing takes ~10–30s.** Don't cut immediately after Submit — let the banner go from
  "Reading your document…" to the green "You're covered" so the payoff lands on camera.
- **Use the provided PDF.** `sample-dec-page.pdf` is built to satisfy the exact requirements
  in Scene 1 (Coverage A ≥ $50k, Coverage E ≥ $300k, wind included, named insured + address
  matching Unit 204). A random dec page may come back non-compliant and change the ending.
