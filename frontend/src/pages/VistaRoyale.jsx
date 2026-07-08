import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { track } from '../analytics'
import './landing.css'

// Same Google Calendar booking link + 2-minute tour video the main landing uses.
const CAL_URL = 'https://calendar.app.google/FomLtiZGYqtmt8jUA'
const TOUR_VIDEO_URL = 'https://ykbjvmqdkczqyzyylwxo.supabase.co/storage/v1/object/public/public-assets/tour.mp4'

// Personalized postcard landing page for the Vista Royale board.
// Reachable at /vista_royale — pitches condo.insure adoption with
// "Start free" + "Book a demo" CTAs.
export default function VistaRoyale() {
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => track('vista_royale_view'), [])

  // Reveal-on-scroll for .reveal sections (same effect as the main landing page).
  useEffect(() => {
    const els = [...document.querySelectorAll('.lp .reveal')]
    if (!('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('in')); return }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } })
    }, { threshold: 0.12 })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className="lp">
      <header className="nav">
        <div className="wrap nav-in">
          <Link className="brand" to="/">
            <img src="/assets/logo-mark.svg" alt="condo.insure shield logo" />
            <span><span className="w-condo">condo</span><span className="w-ins">.insure</span></span>
          </Link>
          <nav className="nav-links">
            <a className="txt nav-section-link" href="/#features">Product</a>
            <a className="txt nav-section-link" href="/#how">How it works</a>
            <a className="txt nav-section-link" href="/#pricing">Pricing</a>
            <Link className="txt" to="/login">Sign in</Link>
            <Link className="btn btn-primary" to="/signup">Start free</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="hero">
        <div className="wrap">
          <div>
            <span className="eyebrow">For the Vista Royale board</span>
            <h1 className="display">
              Vista Royale, meet effortless<br />
              <span className="pop">insurance compliance.</span>
            </h1>
            <p className="lede">
              condo.insure tracks every owner&rsquo;s HO-6 policy, reads their declaration
              page with AI, and sends the renewal reminders for you &mdash; so the Vista
              Royale board always knows which units are covered, and which need follow-up.
            </p>
            <div className="hero-cta">
              <Link className="btn btn-primary" to="/signup">Start free</Link>
              <a className="btn btn-secondary" href={CAL_URL} target="_blank" rel="noopener noreferrer">Book a demo</a>
              <button type="button" className="btn btn-ghost" onClick={() => setTourOpen(true)}>
                <span className="play" aria-hidden="true"></span>Watch the 2-min tour
              </button>
            </div>
            <p style={{ marginTop: 14, fontSize: 14, color: 'var(--muted)' }}>
              90 days free &middot; no credit card required &middot; built for Florida condos.
            </p>
          </div>
        </div>
      </section>

      {/* Why it matters for the board */}
      <section className="stakes">
        <div className="wrap reveal">
          <span className="eyebrow">Why it matters for Vista Royale</span>
          <h2 className="display">One lapsed unit can become <span className="u">everyone&rsquo;s problem.</span></h2>
          <div className="stakes-grid">
            <div className="stake">
              <div className="k">Protect the master policy</div>
              <p>A claim on an <b>uninsured unit</b> can fall back to the association&rsquo;s master policy — and every owner&rsquo;s premium.</p>
            </div>
            <div className="stake">
              <div className="k">No more spreadsheets</div>
              <p>Every owner&rsquo;s coverage in <b>one live dashboard</b> — no chasing dec pages or tracking renewals by hand.</p>
            </div>
            <div className="stake">
              <div className="k">Stay ahead of renewals</div>
              <p>Automated reminders go out at <b>30, 7, and 1 day</b> before a policy expires — and the moment one lapses.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="how">
        <div className="wrap">
          <div className="how-head reveal">
            <span className="eyebrow">How it works</span>
            <h2 className="display">Up and running in a few minutes.</h2>
            <p>You bring the association. We build your Vista Royale unit list from public records, then keep every policy current for you.</p>
          </div>
          <div className="steps">
            <div className="step reveal"><div className="idx">01</div><div><h3>Sign up Vista Royale</h3><p>Just your name and the association address. We handle the rest.</p><div className="meta">~60 seconds</div></div></div>
            <div className="step reveal"><div className="idx">02</div><div><h3>We build it out for you</h3><p>We assemble your owner list from property-assessor records and invite you in once it&rsquo;s ready.</p><div className="meta">done before you log in</div></div></div>
            <div className="step reveal"><div className="idx">03</div><div><h3>Owners send their dec page</h3><p>Owners upload or email their declaration page — no login needed. AI reads it and checks it against your requirements.</p><div className="meta">AI-reviewed on upload</div></div></div>
            <div className="step reveal"><div className="idx">04</div><div><h3>Watch the board stay green</h3><p>See every unit&rsquo;s status at a glance, with reminders running on autopilot.</p><div className="meta">reminders on autopilot</div></div></div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="cta">
        <div className="wrap reveal">
          <h2 className="display">Put all of Vista Royale on one dashboard.</h2>
          <p>Set up your association in minutes. 90 days free — no credit card required.</p>
          <div className="hero-cta">
            <Link className="btn btn-light" to="/signup">Start free</Link>
            <a className="btn btn-ghost" href={CAL_URL} target="_blank" rel="noopener noreferrer">Book a demo</a>
            <button type="button" className="btn btn-ghost" onClick={() => setTourOpen(true)}>
              <span className="play" aria-hidden="true"></span>Watch the 2-min tour
            </button>
          </div>
        </div>
      </section>

      <footer style={{ textAlign: 'center', padding: '32px 16px', fontSize: 13, color: 'var(--muted-2)' }}>
        <p>© {new Date().getFullYear()} condo.insure · Insurance compliance for Florida condo associations.</p>
        <p style={{ marginTop: 8 }}>
          <Link to="/privacy" style={{ color: 'var(--muted)', marginRight: 16 }}>Privacy</Link>
          <Link to="/terms" style={{ color: 'var(--muted)' }}>Terms</Link>
        </p>
      </footer>

      {/* 2-minute tour modal */}
      {tourOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setTourOpen(false)}>
          <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setTourOpen(false)}
              className="absolute -top-9 right-0 text-white/80 hover:text-white text-2xl leading-none" aria-label="Close">✕</button>
            <div className="relative w-full rounded-xl overflow-hidden bg-black shadow-2xl" style={{ paddingBottom: '56.25%' }}>
              <video
                src={TOUR_VIDEO_URL}
                title="condo.insure — 2-minute tour"
                className="absolute inset-0 w-full h-full"
                controls
                autoPlay
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
