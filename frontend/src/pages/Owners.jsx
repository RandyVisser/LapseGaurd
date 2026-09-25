import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { track } from '../analytics'
import usePageTitle from '../usePageTitle'
import useHeadTags from '../useHeadTags'

// /owners (+ /owner) — destination for the postcard mailers sent to condo UNIT
// OWNERS. Mobile-first: most visitors type the URL off a postcard on a phone.
// Two offers: (a) a free HO-6 quote from the agency behind condo.insure (the
// lead-gen side of the business — see CLAUDE.dad.md §1), (b) a prefilled email
// the owner sends from THEIR OWN mail client to their board/manager. Nothing on
// this page sends email from our side.
//
// Plain Tailwind + inline font constants (the auth-page pattern in
// BRANDING.md §5) — deliberately NOT landing.css, whose .reveal sections stay
// invisible unless an IntersectionObserver is wired.

const DISPLAY = '"Bricolage Grotesque", sans-serif'
const BODY = '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif'
const MONO = '"JetBrains Mono", monospace'
const BRAND_GRAD = 'linear-gradient(150deg,#001842 0%,#06245C 62%,#014AC5 150%)'
const INPUT = 'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-base text-[#0B1B33] placeholder-slate-400 focus:outline-none focus:border-[#014AC5] focus:ring-1 focus:ring-[#014AC5]'
const LABEL = 'block text-sm font-medium text-[#0B1B33] mb-1.5'

// Same agency quote page the reminder emails use (backend services/email.py
// QUOTE_FORM_URL); the env var overrides, matching the rest of the app.
const QUOTE_BASE = import.meta.env.VITE_QUOTE_FORM_URL || 'https://www.universalcondo.com/quote'
function tagged(base) {
  try {
    const u = new URL(base)
    u.searchParams.set('utm_source', 'condo.insure')
    u.searchParams.set('utm_medium', 'owner_page')
    return u.toString()
  } catch {
    return base
  }
}
const QUOTE_URL = tagged(QUOTE_BASE)

const REFERRAL_URL = 'https://www.condo.insure/?src=owner-referral'
const INBOUND = import.meta.env.VITE_INBOUND_ADDRESS || 'docs@condo.insure'

function referralEmail(assocName) {
  const assoc = assocName.trim()
  const subject = assoc
    ? `An idea for ${assoc}: automated HO-6 insurance tracking`
    : 'An idea for our association: automated HO-6 insurance tracking'
  const body = [
    'Hi,',
    '',
    `I'm an owner${assoc ? ` at ${assoc}` : ' in the association'} and came across condo.insure, which tracks every unit owner's HO-6 insurance for condo associations.`,
    '',
    'Owners email or upload their declaration page, it checks the coverage against the association\'s requirements, and it sends renewal reminders before policies lapse. The board or manager sees every unit\'s status on one dashboard instead of chasing paperwork.',
    '',
    'It\'s $1 per unit per month ($50/month minimum) with a 90-day free trial, and they build the unit list from public property records. Might be worth a look:',
    REFERRAL_URL,
    '',
    'Thanks,',
  ].join('\n')
  return { subject, body }
}

function Check() {
  return <span className="text-[#0E8E68] font-extrabold flex-shrink-0" aria-hidden="true">✓</span>
}

export default function Owners() {
  usePageTitle('For condo unit owners')
  useHeadTags({
    description: 'Condo unit owner in Florida? Get a free, no-obligation HO-6 quote, learn why your association asks for your declarations page, and tell your board about automated HO-6 compliance tracking.',
    canonical: 'https://www.condo.insure/owners',
  })
  useEffect(() => { track('owner_view') }, [])

  const [assoc, setAssoc] = useState('')
  const [to, setTo] = useState('')
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef(null)
  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const { subject, body } = referralEmail(assoc)
  const mailto = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  async function copyLink() {
    track('owner_referral_copy')
    let ok = false
    try {
      await navigator.clipboard.writeText(REFERRAL_URL)
      ok = true
    } catch {
      // Older mobile browsers / non-secure contexts: textarea fallback
      try {
        const ta = document.createElement('textarea')
        ta.value = REFERRAL_URL
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        ta.remove()
      } catch { ok = false }
    }
    setCopied(ok ? 'yes' : 'no')
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="min-h-screen bg-white text-[#0B1B33]" style={{ fontFamily: BODY }}>
      <header className="border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link to="/" aria-label="condo.insure home">
            <img src="/assets/logo-full.svg" alt="condo.insure" className="h-9 sm:h-11" />
          </Link>
          <Link to="/" className="text-sm font-semibold text-[#54627A] hover:text-[#001842] whitespace-nowrap">
            For boards &amp; managers &rarr;
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden text-white" style={{ background: BRAND_GRAD }}>
        <div className="max-w-3xl mx-auto px-4 py-10 sm:py-14 relative">
          <span className="text-xs uppercase tracking-[.14em] text-[#6FE3B6]" style={{ fontFamily: MONO }}>
            For condo unit owners
          </span>
          <h1 className="mt-3 text-[32px] sm:text-[44px] leading-[1.06] text-white" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
            Your HO-6 covers what the building&rsquo;s policy doesn&rsquo;t.
          </h1>
          <p className="mt-4 text-[17px] text-[#CBD8EC] max-w-xl">
            In Florida the association insures the structure. The inside of your unit &mdash; floors, cabinets,
            fixtures, appliances, your belongings &mdash; is on you. Here&rsquo;s a free way to check you&rsquo;re
            covered, and an easy way to help your board keep every unit on track.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <a href="#quote" className="rounded-full bg-white text-[#001842] font-semibold px-6 py-3 text-center">
              Get a free HO-6 quote
            </a>
            <a href="#board" className="rounded-full border border-white/45 text-white font-semibold px-6 py-3 text-center">
              Tell your board
            </a>
          </div>
        </div>
      </section>

      <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-8">
        {/* (a) quote */}
        <section id="quote" className="rounded-2xl border border-slate-200 p-5 sm:p-7 shadow-sm scroll-mt-4">
          <span className="text-[11px] uppercase tracking-[.14em] text-[#014AC5]" style={{ fontFamily: MONO }}>01 · Free quote</span>
          <h2 className="mt-2 text-2xl text-[#001842]" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
            Get a free HO-6 quote
          </h2>
          <p className="mt-2 text-[#54627A]">
            Renewing soon, or not sure your limits still fit? Compare your current policy against a quote from a
            Florida insurance agency focused on condo coverage.
          </p>
          <ul className="mt-4 space-y-2 text-[15px]">
            <li className="flex gap-2.5"><Check /><span>No cost and no obligation &mdash; keep your current carrier and agent if you like</span></li>
            <li className="flex gap-2.5"><Check /><span>Ask about the coverages associations commonly require: Coverage A, loss assessment, wind</span></li>
          </ul>
          <a
            href={QUOTE_URL}
            target="_blank"
            rel="noopener"
            onClick={() => track('owner_quote_click')}
            className="mt-5 block sm:inline-block text-center rounded-full bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold px-7 py-3 transition-colors"
          >
            Get my free quote &rarr;
          </a>
          <p className="mt-4 text-xs text-[#54627A] leading-relaxed">
            Quotes come from <strong>universalcondo.com</strong>, the licensed Florida insurance agency that builds
            condo.insure. Your association&rsquo;s compliance never depends on where you buy your policy, and we never
            sell your information.{' '}
            <Link to="/privacy" className="text-[#014AC5] hover:underline">Privacy policy</Link>
          </p>
        </section>

        {/* (b) refer the board */}
        <section id="board" className="rounded-2xl border border-slate-200 p-5 sm:p-7 shadow-sm scroll-mt-4">
          <span className="text-[11px] uppercase tracking-[.14em] text-[#014AC5]" style={{ fontFamily: MONO }}>02 · Your board</span>
          <h2 className="mt-2 text-2xl text-[#001842]" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
            Tell your board about condo.insure
          </h2>
          <p className="mt-2 text-[#54627A]">
            One uninsured unit can turn a leak or a storm into a special assessment for everyone. condo.insure
            gives your board or property manager one dashboard showing which units are covered, expiring, or
            lapsed &mdash; and sends the renewal reminders for them.
          </p>
          <p className="mt-3 text-[#54627A]">
            We&rsquo;ll draft a short note; it opens in <strong className="text-[#0B1B33]">your own email app</strong>, so
            you can edit it and it comes from you. We don&rsquo;t send anything.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="own-assoc">Association name <span className="text-slate-400 font-normal">(optional)</span></label>
              <input id="own-assoc" type="text" value={assoc} onChange={(e) => setAssoc(e.target.value)}
                placeholder="Sunset Villas" className={INPUT} autoComplete="organization" />
            </div>
            <div>
              <label className={LABEL} htmlFor="own-to">Board or manager email <span className="text-slate-400 font-normal">(optional)</span></label>
              <input id="own-to" type="email" value={to} onChange={(e) => setTo(e.target.value)}
                placeholder="board@yourcondo.org" className={INPUT} autoComplete="off" inputMode="email" />
            </div>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <a
              href={mailto}
              onClick={() => track('owner_referral_email')}
              className="text-center rounded-full bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold px-7 py-3 transition-colors"
            >
              Open the email &rarr;
            </a>
            <button
              type="button"
              onClick={copyLink}
              className="rounded-full border border-slate-300 hover:border-[#001842] text-[#001842] font-semibold px-7 py-3 transition-colors"
            >
              {copied === 'yes' ? 'Link copied ✓' : copied === 'no' ? 'Copy failed — press and hold the link below' : 'Copy link to share'}
            </button>
          </div>
          <p className="mt-3 text-xs text-[#54627A] break-all" style={{ fontFamily: MONO }}>{REFERRAL_URL}</p>

          <details className="mt-4 text-sm text-[#54627A]">
            <summary className="cursor-pointer font-semibold text-[#0B1B33]">Preview the note</summary>
            <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-3">
              <p className="font-semibold text-[#0B1B33]">{subject}</p>
              <p className="mt-2 whitespace-pre-line">{body}</p>
            </div>
          </details>
        </section>

        {/* (c) HO-6 basics */}
        <section className="rounded-2xl bg-slate-50 border border-slate-200 p-5 sm:p-7">
          <span className="text-[11px] uppercase tracking-[.14em] text-[#014AC5]" style={{ fontFamily: MONO }}>HO-6 in a minute</span>
          <h2 className="mt-2 text-2xl text-[#001842]" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
            Why your association asks for proof
          </h2>
          <div className="mt-3 space-y-3 text-[15.5px] text-[#54627A] leading-relaxed">
            <p>
              <strong className="text-[#0B1B33]">An HO-6 is condo unit-owner insurance.</strong> Florida law requires
              the association&rsquo;s master policy to exclude what&rsquo;s inside your unit &mdash; floor, wall and
              ceiling coverings, built-in cabinets and countertops, fixtures, appliances, water heaters, and your
              personal property &mdash; and makes those the owner&rsquo;s responsibility. An HO-6 is the policy that
              covers them, plus your liability and your share of association assessments.
            </p>
            <p>
              <strong className="text-[#0B1B33]">Why proof?</strong> The statute doesn&rsquo;t force owners to buy
              one, but many declarations of condominium do, and so do many mortgage lenders. The standard proof
              is your policy&rsquo;s <em>declarations page</em> &mdash; the summary page your insurer sends at every renewal.
            </p>
            <p>
              <strong className="text-[#0B1B33]">An HO-6 isn&rsquo;t an HO-4, and wind may be separate.</strong> Renter
              policies (HO-4) don&rsquo;t satisfy an owner requirement, and some Florida HO-6 policies exclude wind,
              which then needs its own policy.
            </p>
          </div>
          <ul className="mt-5 space-y-2.5 text-[15px]">
            <li><a className="text-[#014AC5] underline underline-offset-2" href="/guides/ho6-vs-ho4-vs-wind-only.html">HO-6 vs. HO-4 vs. wind-only: which policy satisfies which requirement</a></li>
            <li><a className="text-[#014AC5] underline underline-offset-2" href="/guides/what-is-a-declarations-page.html">What is a declarations page — and how to find yours</a></li>
            <li><a className="text-[#014AC5] underline underline-offset-2" href="/guides/florida-condo-insurance-requirements.html">Florida condo insurance requirements: association vs. unit owner</a></li>
          </ul>
        </section>

        {/* already a user */}
        <section className="rounded-2xl border border-slate-200 p-5 sm:p-7">
          <h2 className="text-xl text-[#001842]" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
            Does your association already use condo.insure?
          </h2>
          <p className="mt-2 text-[15.5px] text-[#54627A]">
            Email your declaration page to{' '}
            <a href={`mailto:${INBOUND}`} className="text-[#014AC5] hover:underline font-semibold">{INBOUND}</a>{' '}
            from the email address your association has on file &mdash; no login needed. Or{' '}
            <Link to="/login" className="text-[#014AC5] hover:underline font-semibold">sign in</Link> to upload it and
            see your status.
          </p>
        </section>
      </main>

      <footer className="border-t border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-6 text-sm text-[#8493A8] flex flex-wrap gap-x-5 gap-y-2 items-center justify-between">
          <span>condo.insure<sup className="text-[.6em] font-semibold ml-px">™</sup> · Insurance Compliance. Simplified.</span>
          <span className="flex gap-4">
            <a href="/guides/index.html" className="hover:text-[#001842]">Guides</a>
            <a href="/security.html" className="hover:text-[#001842]">Security</a>
            <Link to="/privacy" className="hover:text-[#001842]">Privacy</Link>
            <Link to="/terms" className="hover:text-[#001842]">Terms</Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
