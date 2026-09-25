import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { track, loadRb2b } from '../analytics'
import './landing.css'

const TOUR_VIDEO_URL = 'https://ykbjvmqdkczqyzyylwxo.supabase.co/storage/v1/object/public/public-assets/tour.mp4'
const CAL_URL = 'https://calendar.app.google/FomLtiZGYqtmt8jUA'
// Email-in intake address — docs@condo.insure is live (Workspace forwards the
// apex mailbox to the Resend inbound subdomain). Env var overrides.
const INBOUND = import.meta.env.VITE_INBOUND_ADDRESS || 'docs@condo.insure'

export default function Landing() {
  const rootRef = useRef(null)
  const [tourOpen, setTourOpen] = useState(false)
  const openTour = () => { track('tour_play'); setTourOpen(true) }

  // Deep-link scroll: when arriving at /#features, /#how, /#pricing (e.g. from
  // the Vista Royale page or the /pricing redirect), the browser can't scroll to
  // the section because React hasn't rendered it yet at load time. Do it here,
  // once the DOM is committed, with a second pass after fonts/layout settle.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id) return
    const go = () => {
      const el = document.getElementById(id)
      if (!el) return
      const prev = document.documentElement.style.scrollBehavior
      document.documentElement.style.scrollBehavior = 'auto'
      el.scrollIntoView()
      document.documentElement.style.scrollBehavior = prev
    }
    const raf = requestAnimationFrame(go)
    const t = setTimeout(go, 250)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [])

  // Discovery nudge for visitors who land on the bare page: a scroll cue that
  // fades once they scroll, plus a ONE-TIME gentle auto-scroll to #features if
  // they're still idle after ~9s. Never loops; cancels permanently the moment
  // the visitor scrolls/taps/types/clicks. Skipped when arriving at a #hash or
  // under reduced-motion (the idle nudge; the cue still shows, just static).
  useEffect(() => {
    const cue = () => document.querySelector('.lp .scroll-cue')
    if (window.location.hash) { cue()?.classList.add('hide'); return }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let done = false
    let idle
    const evs = ['wheel', 'touchstart', 'keydown', 'mousedown']
    const stop = () => {
      if (done) return
      done = true
      clearTimeout(idle)
      window.removeEventListener('scroll', onScroll)
      evs.forEach((e) => window.removeEventListener(e, stop))
    }
    const onScroll = () => { if (window.scrollY > 40) { cue()?.classList.add('hide'); stop() } }
    window.addEventListener('scroll', onScroll, { passive: true })
    evs.forEach((e) => window.addEventListener(e, stop, { passive: true }))
    if (!reduce) {
      idle = setTimeout(() => {
        if (done || window.scrollY > 40) return
        document.querySelector('#features')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        cue()?.classList.add('hide')
        stop()
      }, 9000)
    }
    return () => { clearTimeout(idle); window.removeEventListener('scroll', onScroll); evs.forEach((e) => window.removeEventListener(e, stop)) }
  }, [])

  useEffect(() => {
    track('landing_view')
    loadRb2b()
    const root = rootRef.current
    if (!root) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const timers = []
    const observers = []
    let raf = 0
    const T = (ms, fn) => { const id = setTimeout(fn, ms); timers.push(id); return id }

    // scroll reveals
    const reveals = [...root.querySelectorAll('.reveal')]
    if (!reduce && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }),
        { threshold: 0.16 }
      )
      reveals.forEach((el) => io.observe(el)); observers.push(io)
    } else reveals.forEach((el) => el.classList.add('in'))

    // count-up helper
    function countUp(el, to, from, ms) {
      if (!el) return
      if (reduce) { el.textContent = to; return }
      const s = performance.now()
      ;(function t(n) {
        const p = Math.max(0, Math.min(1, (n - s) / ms)), e = 1 - Math.pow(1 - p, 3)
        el.textContent = Math.round(from + (to - from) * e)
        if (p < 1) requestAnimationFrame(t)
      })(performance.now())
    }

    // hero board count-up + lapse→active resolution
    function runBoard() {
      root.querySelectorAll('.hero .sm .n').forEach((el) => {
        const to = +el.dataset.count, from = el.dataset.from ? +el.dataset.from : 0
        countUp(el, from ? from : to, 0, 900)
      })
      if (reduce) { resolveHero(); return }
      T(1000, () => root.querySelector('#resolveRow')?.classList.add('resolving'))
      T(2600, resolveHero)
    }
    function resolveHero() {
      const pill = root.querySelector('#resolvePill'); if (!pill) return
      pill.classList.remove('lapsed'); pill.classList.add('active'); pill.textContent = 'Active'
      const sub = root.querySelector('#resolveSub'); if (sub) sub.textContent = 'Citizens · exp 05/27'
      root.querySelector('#resolveRow')?.classList.remove('resolving')
      const lap = root.querySelector('.hero .sm.lap .n'), act = root.querySelector('.hero .sm.act .n')
      if (!reduce) { countUp(lap, 1, 2, 500); countUp(act, 18, 17, 500) }
      else { if (lap) lap.textContent = '1'; if (act) act.textContent = '18' }
    }
    const heroBoard = root.querySelector('.hero .board')
    if ('IntersectionObserver' in window && heroBoard) {
      const bo = new IntersectionObserver((e) => { if (e[0].isIntersecting) { runBoard(); bo.disconnect() } }, { threshold: 0.4 })
      bo.observe(heroBoard); observers.push(bo)
    } else runBoard()

    // feature-tab board: two-beat story (lapsed→active, then expiring→active)
    let tabTimers = []
    function resolveTabBoard() {
      const row = root.querySelector('#tabRow'); if (!row) return
      const pill = root.querySelector('#tabPill'), sub = root.querySelector('#tabSub')
      const row2 = root.querySelector('#tabRow2'), pill2 = root.querySelector('#tabPill2'), sub2 = root.querySelector('#tabSub2')
      const act = root.querySelector('#tabActN'), exp = root.querySelector('#tabExpN'), lap = root.querySelector('#tabLapN')
      tabTimers.forEach(clearTimeout); tabTimers = []
      row.classList.remove('resolving'); pill.className = 'pill lapsed'; pill.textContent = 'Lapsed'; sub.textContent = 'No policy on file'
      row2.classList.remove('resolving'); pill2.className = 'pill expire'; pill2.textContent = 'Expiring'; sub2.textContent = 'Heritage · exp 07/26'
      act.textContent = '17'; exp.textContent = '2'; lap.textContent = '2'
      if (reduce) {
        pill.className = 'pill active'; pill.textContent = 'Active'; sub.textContent = 'Citizens · exp 05/27'
        pill2.className = 'pill active'; pill2.textContent = 'Active'; sub2.textContent = 'Heritage · exp 07/27'
        act.textContent = '19'; exp.textContent = '1'; lap.textContent = '1'; return
      }
      const TT = (ms, fn) => tabTimers.push(setTimeout(fn, ms))
      TT(1000, () => row.classList.add('resolving'))
      TT(1800, () => {
        row.classList.remove('resolving')
        pill.classList.remove('lapsed'); pill.classList.add('active', 'pop'); pill.textContent = 'Active'
        sub.textContent = 'Citizens · exp 05/27'
        countUp(act, 18, 17, 500); countUp(lap, 1, 2, 500)
        TT(650, () => pill.classList.remove('pop'))
      })
      TT(3600, () => row2.classList.add('resolving'))
      TT(4400, () => {
        row2.classList.remove('resolving')
        pill2.classList.remove('expire'); pill2.classList.add('active', 'pop'); pill2.textContent = 'Active'
        sub2.textContent = 'Heritage · exp 07/27'
        countUp(act, 19, 18, 500); countUp(exp, 1, 2, 500)
        TT(650, () => pill2.classList.remove('pop'))
      })
    }

    // ── auto-advancing feature tabs ──
    const tabs = [...root.querySelectorAll('.tab')]
    const panels = [...root.querySelectorAll('.panel')]
    const DUR = 10400
    let cur = 0, start = performance.now(), paused = false, elapsed = 0
    function render() {
      tabs.forEach((t, i) => t.setAttribute('aria-selected', i === cur))
      panels.forEach((p, i) => p.classList.toggle('show', i === cur))
      tabs.forEach((t, i) => { if (i !== cur) { const pr = t.querySelector('.prog'); if (pr) pr.style.width = '0%' } })
    }
    function go(i) { cur = (i + tabs.length) % tabs.length; start = performance.now(); elapsed = 0; render(); if (cur === 0) resolveTabBoard() }
    const clickHandlers = tabs.map((t, i) => { const h = () => go(i); t.addEventListener('click', h); return h })
    const stage = root.querySelector('.panel-stage')
    const onEnter = () => { if (!paused) { paused = true; elapsed = performance.now() - start } }
    const onLeave = () => { if (paused) { paused = false; start = performance.now() - elapsed } }
    if (stage) { stage.addEventListener('mouseenter', onEnter); stage.addEventListener('mouseleave', onLeave) }
    render()

    const tsec = root.querySelector('.tabs-sec')
    if ('IntersectionObserver' in window && tsec) {
      const tio = new IntersectionObserver((e) => { if (e[0].isIntersecting) { if (cur === 0) resolveTabBoard(); tio.disconnect() } }, { threshold: 0.3 })
      tio.observe(tsec); observers.push(tio)
    } else if (cur === 0) resolveTabBoard()

    // Section-reached beacons — the "where do we lose people" depth funnel.
    // One event per section per pageload; low threshold because tall sections
    // never reach high visibility fractions. Outside the reduced-motion guard:
    // measurement, not animation.
    const depthSections = [
      ['.tabs-sec', 'section_features'],
      ['.stakes', 'section_stakes'],
      ['.how', 'section_how'],
      ['.faq', 'section_faq'],
      ['.cta', 'section_cta'],
    ]
    if ('IntersectionObserver' in window) {
      for (const [sel, evName] of depthSections) {
        const el = root.querySelector(sel)
        if (!el) continue
        const dio = new IntersectionObserver((es) => {
          if (es.some((x) => x.isIntersecting)) { track(evName); dio.disconnect() }
        }, { threshold: 0.15 })
        dio.observe(el); observers.push(dio)
      }
    }

    // Funnel: the /pricing page is gone, so pricing_view fires here — once,
    // when the landing #pricing section scrolls into view. Deliberately
    // OUTSIDE the reduced-motion guard: it's measurement, not animation.
    const pricingSec = root.querySelector('#pricing')
    if ('IntersectionObserver' in window && pricingSec) {
      const pio = new IntersectionObserver((e) => {
        if (e.some((x) => x.isIntersecting)) { track('pricing_view'); pio.disconnect() }
      }, { threshold: 0.3 })
      pio.observe(pricingSec); observers.push(pio)
    }

    if (!reduce) {
      const loop = (now) => {
        if (!paused) {
          const p = Math.min(1, (now - start) / DUR)
          const pr = tabs[cur]?.querySelector('.prog'); if (pr) pr.style.width = (p * 100) + '%'
          if (p >= 1) go(cur + 1)
        }
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    }

    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      tabTimers.forEach(clearTimeout)
      observers.forEach((o) => o.disconnect())
      clickHandlers.forEach((h, i) => tabs[i]?.removeEventListener('click', h))
      if (stage) { stage.removeEventListener('mouseenter', onEnter); stage.removeEventListener('mouseleave', onLeave) }
    }
  }, [])

  return (
    <div className="lp" ref={rootRef}>
      <header className="nav">
        <div className="wrap nav-in">
          <Link className="brand" to="/">
            <img src="/assets/logo-full.svg" alt="condo.insure" />
          </Link>
          <nav className="nav-links">
            <a className="txt" href="#features">Product</a>
            <a className="txt" href="#how">How it works</a>
            <a className="txt" href="#firms">For PM firms</a>
            <a className="txt" href="#pricing">Pricing</a>
            <Link className="txt nav-owner" to="/owners">Unit owners</Link>
            <Link className="txt" to="/login">Sign in</Link>
            <a className="btn btn-primary" href="#start">Get started free</a>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="hero">
        <div className="wrap">
          <div>
            <span className="eyebrow">HO-6 compliance for Florida condo associations</span>
            <h1 className="display">Know every unit is insured,<br /><span className="pop">without chasing a single dec page.</span></h1>
            <p className="lede">Owners email or upload their declaration page. AI checks it against your association’s requirements in seconds. Reminders go out 30, 7 and 1 day before a policy expires. You see who’s covered, expiring, or lapsed on one board — instead of in a filing cabinet.</p>

            {/* Two-path split: boards and PM firms have different signup flows
                (association = setup request we fulfil by hand; firm = instant
                self-serve account), so say so up front instead of making a PM
                discover the firm path inside the association form. */}
            <div className="paths" id="start">
              <Link className="path" to="/signup">
                <span className="who">I’m on a condo board</span>
                <span className="what">Request a free setup. We build your unit list from public records and email your invite within one business day.</span>
                <span className="go">Set up my association →</span>
              </Link>
              <Link className="path" to="/signup/firm">
                <span className="who">I manage associations</span>
                <span className="what">Create a firm account in minutes. One login and one dashboard for every association you manage.</span>
                <span className="go">Create a firm account →</span>
              </Link>
            </div>
            <div className="hero-cta sub">
              <a className="btn btn-ghost" href={CAL_URL} target="_blank" rel="noopener noreferrer" onClick={() => track('demo_click')}>Book a 15-min walkthrough</a>
              <button type="button" className="btn btn-tour" onClick={openTour}>
                <span className="play" aria-hidden="true"></span>Watch the 2-min tour
              </button>
            </div>
            <p className="owner-hint">Unit owner? Got our postcard? <Link to="/owners">Start here →</Link></p>
            <div className="trust">
              <span><span className="chk">✓</span> 90 days free — no credit card</span>
              <span><span className="chk">✓</span> $1/unit/mo, every feature</span>
              <span><span className="chk">✓</span> Owners can email their dec page in — no login</span>
              <span><span className="chk">✓</span> Built by a licensed Florida insurance agency</span>
            </div>
          </div>

          <div className="frame">
            <div className="board" role="img" aria-label="Example compliance board with sample data: 18 active, 2 expiring, 1 lapsed.">
              <div className="board-top">
                <span className="ttl"><span className="pin" aria-hidden="true"></span>Harbor Point · Compliance</span>
                <span className="live">Example · 21 units</span>
              </div>
              <div className="summary">
                <div className="sm act"><div className="n" data-count="18">0</div><div className="l">Active</div></div>
                <div className="sm exp"><div className="n" data-count="2">0</div><div className="l">Expiring</div></div>
                <div className="sm lap"><div className="n" data-count="1" data-from="2">0</div><div className="l">Lapsed</div></div>
              </div>
              <div className="rows">
                <div className="row"><span className="unit">1203</span><span className="who">M. Okafor<small>Citizens · exp 03/27</small></span><span className="pill active">Active</span></div>
                <div className="row"><span className="unit">0907</span><span className="who">R. Delgado<small>Tower Hill · exp 11/26</small></span><span className="pill active">Active</span></div>
                <div className="row"><span className="unit">1511</span><span className="who">The Patels<small>Heritage · exp 07/26</small></span><span className="pill expire">Expiring</span></div>
                <div className="row" id="resolveRow"><span className="unit">0402</span><span className="who">J. Whitfield<small id="resolveSub">No policy on file</small></span><span className="pill lapsed" id="resolvePill">Lapsed</span></div>
                <div className="row"><span className="unit">1108</span><span className="who">S. Romano<small>Universal · exp 09/26</small></span><span className="pill active">Active</span></div>
              </div>
            </div>
          </div>
        </div>
        <a className="scroll-cue" href="#features" aria-label="See how it works — scroll to features">
          <span>See how it works</span>
          <span className="arrow" aria-hidden="true"></span>
        </a>
      </section>

      {/* AUTO-ADVANCING FEATURE TABS */}
      <section className="tabs-sec" id="features">
        <div className="wrap">
          <div className="tabs-head reveal">
            <span className="eyebrow">One place for everything</span>
            <h2 className="display">Everything your board or management team needs to prove every unit is covered.</h2>
          </div>

          <div className="tablist" role="tablist" aria-label="Product features">
            <button className="tab" role="tab" aria-selected="true" data-i="0">Compliance board<span className="prog"></span></button>
            <button className="tab" role="tab" aria-selected="false" data-i="1">AI dec-page review<span className="prog"></span></button>
            <button className="tab" role="tab" aria-selected="false" data-i="2">Email it in<span className="prog"></span></button>
            <button className="tab" role="tab" aria-selected="false" data-i="3">Document center<span className="prog"></span></button>
          </div>

          <div className="panel-stage">
            {/* 0: board */}
            <div className="panel show" role="tabpanel">
              <div className="cap"><h3>See your whole building at a glance</h3><p>Every unit’s status in one live view — active, expiring, lapsed, or missing.</p></div>
              <div className="stage stage-board">
                <div className="board">
                  <div className="board-top"><span className="ttl"><span className="pin"></span>Harbor Point · Compliance</span><span className="live">21 units</span></div>
                  <div className="summary">
                    <div className="sm act"><div className="n" id="tabActN">19</div><div className="l">Active</div></div>
                    <div className="sm exp"><div className="n" id="tabExpN">1</div><div className="l">Expiring</div></div>
                    <div className="sm lap"><div className="n" id="tabLapN">1</div><div className="l">Lapsed</div></div>
                  </div>
                  <div className="rows">
                    <div className="row"><span className="unit">1203</span><span className="who">M. Okafor<small>Citizens · exp 03/27</small></span><span className="pill active">Active</span></div>
                    <div className="row" id="tabRow2"><span className="unit">1511</span><span className="who">The Patels<small id="tabSub2">Heritage · exp 07/27</small></span><span className="pill active" id="tabPill2">Active</span></div>
                    <div className="row" id="tabRow"><span className="unit">0402</span><span className="who">J. Whitfield<small id="tabSub">Citizens · exp 05/27</small></span><span className="pill active" id="tabPill">Active</span></div>
                    <div className="row"><span className="unit">0615</span><span className="who">D. Nguyen<small>Slide · exp 12/26</small></span><span className="pill active">Active</span></div>
                    <div className="row"><span className="unit">1822</span><span className="who">Greentree LLC<small>Universal · exp 10/26</small></span><span className="pill active">Active</span></div>
                    <div className="row"><span className="unit">0301</span><span className="who">A. Bauer<small>Tower Hill · exp 02/27</small></span><span className="pill active">Active</span></div>
                  </div>
                </div>
                <div className="float f-tr"><span className="dotg"></span>Reminder sent to 3 owners</div>
                <div className="float f-bl"><span className="ring"></span>90% compliant</div>
              </div>
            </div>

            {/* 1: AI dec-page review */}
            <div className="panel" role="tabpanel">
              <div className="cap"><h3>The dec page reads itself</h3><p>Our AI reads each declaration page and checks it against the requirements your association sets — coverage minimums, wind, named insured, address, and whether the policy is in force. You only look at the ones it flags.</p></div>
              <div className="stage stage-dec">
                <div className="doc dec">
                  <div className="sheet">
                    <div className="h">Declaration Page</div>
                    <div className="bar l"></div><div className="bar m"></div><div className="bar s"></div>
                    <div className="bar m" style={{ marginTop: 14 }}></div><div className="bar l"></div><div className="bar s"></div>
                    <div className="bar m" style={{ marginTop: 14 }}></div><div className="bar s"></div>
                  </div>
                  <div>
                    <div className="field"><span className="lab">Coverage A</span><span className="val">$250,000 <span className="ok">✓</span></span></div>
                    <div className="field"><span className="lab">Liability (Cov. E)</span><span className="val">$300,000 <span className="ok">✓</span></span></div>
                    <div className="field"><span className="lab">Wind / Hurricane</span><span className="val">Included <span className="ok">✓</span></span></div>
                    <div className="field"><span className="lab">Expiration</span><span className="val">05/14/27 <span className="ok">✓</span></span></div>
                    <div className="verdict">✓ Meets association requirements</div>
                  </div>
                </div>
                <div className="float f-bl"><span className="spark">⚡</span> Parsed in 4s</div>
                <div className="float f-tr"><span className="dotg"></span>HO-6 verified</div>
              </div>
            </div>

            {/* 2: Email it in */}
            <div className="panel" role="tabpanel">
              <div className="cap"><h3>Owners just forward the email</h3><p>No login needed — an owner forwards their insurer’s email from the address on file, and we pull the declaration page, parse it, and attach it to the right unit.</p></div>
              <div className="stage stage-rem">
                <div className="emailflow">
                  <div className="phone">
                    <div className="phone-screen">
                      <span className="phone-island"></span>
                      <div className="mc-top"><span>Cancel</span><span className="mc-title">New Message</span><span className="mc-send">↑</span></div>
                      <div className="mc-row"><span className="mc-lab">To:</span>{INBOUND || 'docs@…'}</div>
                      <div className="mc-row"><span className="mc-lab">Subj:</span>Fwd: Citizens policy</div>
                      <div className="mc-body">Here’s my declaration page for unit 1511.</div>
                      <div className="attach"><span className="fileic"></span>Declaration-Page.pdf</div>
                    </div>
                  </div>
                  <div className="ef-wire"><span className="ef-pulse"></span></div>
                  <div className="ef-card ef-dash">
                    <div className="dash-top"><span className="pin"></span>Harbor Point<span className="dash-live">21 units</span></div>
                    <div className="dash-rows">
                      <div className="drow"><span className="unit">1108</span><span className="who">S. Romano</span><span className="pill active">Active</span></div>
                      <div className="drow ef-target"><span className="row-scan"></span><span className="unit">1511</span><span className="who">The Patels</span><span className="ef-statuses"><span className="pill lapsed ef-before">Missing</span><span className="pill active ef-after">Active ✓</span></span></div>
                      <div className="drow"><span className="unit">0907</span><span className="who">R. Delgado</span><span className="pill active">Active</span></div>
                    </div>
                  </div>
                  <div className="ef-token"><span className="fileic sm"></span>.pdf</div>
                </div>
                <div className="float f-tr"><span className="dotg"></span>Matched to Unit 1511</div>
                <div className="float f-bl"><span className="dotg"></span>No login needed</div>
              </div>
            </div>

            {/* 3: Document center */}
            <div className="panel" role="tabpanel">
              <div className="cap"><h3>Every shared document, in one place</h3><p>Master policy, wind mitigation, flood dec pages — shared with every owner, always findable.</p></div>
              <div className="stage stage-docs">
                <div className="doc docwrap">
                  <div className="docs-grid g3">
                    <div className="dtile"><span className="ic"></span><div><div className="nm">Wind Mitigation</div><div className="mt">PDF · updated Apr</div></div></div>
                    <div className="dtile"><span className="ic"></span><div><div className="nm">Master Policy</div><div className="mt">PDF · updated Jan</div></div></div>
                    <div className="dtile"><span className="ic"></span><div><div className="nm">Flood Dec Page</div><div className="mt">PDF · updated Mar</div></div></div>
                    <div className="dtile"><span className="ic"></span><div><div className="nm">Elevation Cert</div><div className="mt">PDF · updated 2024</div></div></div>
                    <div className="dtile"><span className="ic"></span><div><div className="nm">SIRS Report</div><div className="mt">PDF · updated Feb</div></div></div>
                    <div className="dtile"><span className="ic"></span><div><div className="nm">Bylaws</div><div className="mt">PDF · updated 2023</div></div></div>
                  </div>
                </div>
                <div className="float f-tr"><span className="dotg"></span>Shared with 21 owners</div>
                <div className="float f-bl"><span className="down">↓</span> 142 downloads</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STAKES */}
      <section className="stakes">
        <div className="wrap reveal">
          <span className="eyebrow">Why it matters</span>
          <h2 className="display">One lapsed unit can become <span className="u">everyone’s problem.</span></h2>
          <div className="stakes-grid">
            <div className="stake"><div className="k">Shared exposure</div><p>A claim on an <b>uninsured unit</b> can fall back to the master policy — and every owner’s premium.</p></div>
            <div className="stake"><div className="k">Silent renewals</div><p>Policies expire on their <b>own schedule</b>. Nobody tells the board until there’s a claim.</p></div>
            <div className="stake"><div className="k">Scattered proof</div><p>Declaration pages live in <b>inboxes and filing cabinets</b>, never where you need them.</p></div>
          </div>
          {/* Contextual links into the reference guides — plain <a>, not <Link>:
              /guides/* are static HTML files, not React Router routes. */}
          <p style={{ marginTop: 22, fontSize: 15.5 }}>
            Not sure what your association can actually require? We wrote the
            reference: <a className="inline-link" href="/guides/florida-condo-insurance-requirements.html">what Florida law puts on the association vs. the unit owner</a>,{' '}
            <a className="inline-link" href="/guides/florida-condo-loss-assessment-coverage.html">why loss assessment coverage rarely covers what boards assume</a>, and{' '}
            <a className="inline-link" href="/guides/florida-condo-milestone-inspection-sirs.html">where milestone inspections and SIRS stand now</a>.
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="how" id="how">
        <div className="wrap">
          <div className="how-head reveal">
            <span className="eyebrow">How it works</span>
            <h2 className="display">From a guess to a dashboard, in five steps.</h2>
            <p>You bring the association. We build your unit list from public records, then automatically track every owner’s HO-6 coverage.</p>
          </div>
          <div className="steps">
            <div className="step reveal"><div className="idx">01</div><div><h3>Request your setup</h3><p>Your name and email, plus the association’s name, address, and number of units. Management firms skip this step and set up their own account.</p><div className="meta">~60 seconds</div></div></div>
            <div className="step reveal"><div className="idx">02</div><div><h3>We build it out for you</h3><p>A person on our team assembles your unit and owner list from property-assessor records, then emails your invite.</p><div className="meta">within one business day</div></div></div>
            <div className="step reveal"><div className="idx">03</div><div><h3>Review owners, send invites</h3><p>Check the list, fill any missing emails, and send each owner a link tied to their unit.</p><div className="meta">one click per owner</div></div></div>
            <div className="step reveal"><div className="idx">04</div><div><h3>Owners send their declaration page</h3><p>Owners upload or email their <a className="inline-link" href="/guides/what-is-a-declarations-page.html">declaration page</a>, and our AI does the rest—instantly reading it, verifying coverage against your requirements, and updating their compliance status. You only review the ones it flags.</p><div className="meta">Reviewed by AI, not by hand</div></div></div>
            <div className="step reveal"><div className="idx">05</div><div><h3>Watch the board stay green</h3><p>See every unit’s status at a glance. Automated reminders go out 30, 7, and 1 day before renewal — and again if a policy lapses. Board-ready reports go out monthly.</p><div className="meta">reminders on autopilot</div></div></div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="pricing" id="pricing">
        <div className="wrap">
          <div className="sec-head center reveal">
            <span className="eyebrow" style={{ justifyContent: 'center' }}>Pricing</span>
            <h2 className="display">Priced by the unit. Built to grow.</h2>
            <p>Simple per-unit pricing with volume discounts as your portfolio grows. Every feature is included, regardless of size. <a className="inline-link" href="/guides/ho6-compliance-cost-calculator.html">Work out your exact cost →</a></p>
          </div>

          <div className="reveal" style={{ textAlign: 'center', marginBottom: 24 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#E4F5EE', color: '#0E8E68', border: '1px solid #B7E3D0',
              borderRadius: 999, padding: '8px 18px', fontWeight: 700, fontSize: 15,
            }}>
              <span aria-hidden="true">✓</span> 90 days free — no credit card required
            </span>
          </div>

          <div className="tiers reveal">
            <div className="tier feat">
              <div className="tag">Most associations</div>
              <div className="band">Up to 750 units</div>
              <div className="tprice">$1.00<span className="u">/unit/mo</span></div>
              <div className="tnote">$50/mo minimum</div>
            </div>
            <div className="tier">
              <div className="band">751–10,000 units</div>
              <div className="tprice">$0.50<span className="u">/unit/mo</span></div>
              <div className="tnote">Large Associations and Property Manager Portfolios</div>
            </div>
            <div className="tier">
              <div className="band">10,000+ units</div>
              <div className="tprice">$0.25<span className="u">/unit/mo</span></div>
              <div className="tnote">Large Management Companies</div>
            </div>
          </div>

          <div className="price-foot reveal">
            <div className="pf-left">
              <div className="price-incl-h">Every feature. Every plan.</div>
              <ul className="price-list price-list-2col">
                <li>Real-time compliance board</li>
                <li>AI declaration-page review</li>
                <li>Owners can email in declaration pages (no login required).</li>
                <li>Automated renewal reminders</li>
                <li>Shared document center</li>
                <li>Unlimited owners and administrators.</li>
              </ul>
            </div>
            <div className="pf-right">
              <div className="price-eg">A 120-unit association pays <b>$120/month</b>.</div>
              <Link className="btn btn-primary btn-block" to="/signup">Set up my association</Link>
              <Link className="price-alt" to="/signup/firm">Manage several? Create a firm account →</Link>
              <div className="price-mini">$50/mo minimum · no setup fee · cancel anytime</div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}

      {/* PM FIRMS — the mailer audience lands here; route them to the firm path
          instead of making them discover it inside the association form. */}
      <section className="stakes" id="firms">
        <div className="wrap reveal">
          <span className="eyebrow">Property management firms</span>
          <h2 className="display">Managing more than one association?</h2>
          <div className="stakes-grid">
            <div className="stake"><div className="k">One login, whole portfolio</div><p>Every association you manage on <b>one firm dashboard</b> — KPIs, lapses, and uploads needing review across the book.</p></div>
            <div className="stake"><div className="k">Your team, scoped</div><p>Owner, manager, and member roles with <b>per-manager assignments</b> — staff see their book, not the whole firm.</p></div>
            <div className="stake"><div className="k">Billing that fits the firm</div><p>One consolidated subscription, or each association pays its own way at your <b>firm bulk rate</b> — no monthly minimum.</p></div>
          </div>
          <p style={{ marginTop: 22, fontSize: 15.5 }}>
            How firms run it day to day: <a className="inline-link" href="/guides/property-manager-ho6-compliance-tracking.html" style={{ color: '#6FE3B6' }}>HO-6 compliance tracking for property managers</a>.
          </p>
          <div className="hero-cta" style={{ marginTop: 22 }}>
            <Link className="btn btn-light" to="/signup/firm">Create a firm account</Link>
            <a className="btn btn-ghost" href={CAL_URL} target="_blank" rel="noopener noreferrer" onClick={() => track('demo_click')} style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.45)' }}>Book a 15-min walkthrough</a>
          </div>
        </div>
      </section>

      {/* WHO WE ARE — honest disclosure of the agency relationship, framed as
          the trust asset it is. Keep claims verifiable: no years-in-business,
          customer counts, or license numbers unless Randy/Troy supply them. */}
      <section className="about" id="about">
        <div className="wrap about-in">
          <div className="reveal">
            <span className="eyebrow">Who we are</span>
            <h2 className="display">Built by a Florida condo insurance agency.</h2>
            <p className="lede2">
              condo.insure comes from the team behind <a className="inline-link" href="https://www.universalcondo.com" target="_blank" rel="noopener">universalcondo.com</a>,
              a licensed Florida insurance agency. HO-6 policies, declaration pages, and association
              insurance requirements are our day job — so the checks the software runs are the ones an
              agent would run by hand.
            </p>
            <p className="lede2">
              We’d rather tell you up front than have you find it in the fine print: yes, we sell
              insurance. Here’s exactly how that touches your association.
            </p>
          </div>
          <div className="about-pts reveal">
            <div className="about-pt">
              <div className="k">HO-6 know-how, built in</div>
              <p>Coverage minimums, wind, <b>named insured, property address, policy in force</b> — the requirement checks were designed by people who read dec pages every day.</p>
            </div>
            <div className="about-pt">
              <div className="k">Quotes are optional</div>
              <p>Owner reminder emails include an optional link to request a free quote from our agency. Owners can <b>keep any carrier and any agent</b> — compliance never depends on where a policy is bought.</p>
            </div>
            <div className="about-pt">
              <div className="k">Your data isn’t for sale</div>
              <p>We <b>never sell</b> owner or association data. Read our <Link className="inline-link" to="/privacy">privacy policy</Link> and <a className="inline-link" href="/security.html">security overview</a>.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="faq" id="faq">
        <div className="wrap faq-wrap">
          <div className="sec-head center reveal">
            <span className="eyebrow">Questions</span>
            <h2 className="display">Answers before you ask</h2>
          </div>
          <div className="faq-list reveal">
            <details className="faq-item" open>
              <summary>Do unit owners need to create an account?</summary>
              <p>Not to send in a policy. An owner can email their declaration page to docs@condo.insure from the address your association has on file, and it’s matched to their unit automatically—no login or password. Owners who prefer can set up a free owner login to upload, check their status, and download shared building documents.</p>
            </details>
            <details className="faq-item">
              <summary>What if we don’t have emails for every owner?</summary>
              <p>That’s normal. We build your owner list from public property records during setup. You can add email addresses over time and invite owners whenever you’re ready.</p>
            </details>
            <details className="faq-item">
              <summary>How long does setup take?</summary>
              <p>For an association, the request form takes about a minute. Our team builds your unit and owner list from public property records and emails your admin invite within one business day—no spreadsheets or manual imports. A property management firm can create its account and start adding associations right away.</p>
            </details>
            <details className="faq-item">
              <summary>Is our association’s data secure?</summary>
              <p>Yes. An association’s records are visible only to its own administrators and managers (and our support team), and each owner sees only their own unit plus shared building documents. Declaration pages are kept in private storage and opened through short-lived links. Details are in our <a className="inline-link" href="/security.html">security overview</a>.</p>
            </details>
            <details className="faq-item">
              <summary>What does it cost?</summary>
              <p>Most associations pay <a className="inline-link" href="/guides/ho6-compliance-cost-calculator.html">$1 per unit, per month, with a $50/month minimum</a>. Larger portfolios receive automatic volume discounts. No setup fee, and you can start free.</p>
            </details>
            <details className="faq-item">
              <summary>We manage multiple associations — does this work as a portfolio?</summary>
              <p>Yes. A property management firm gets one dashboard across every association it manages, with role-based access for staff and per-manager assignments. Billing is either one consolidated subscription for the firm or each association paying its own way at the firm’s bulk rate. Set up at condo.insure/signup/firm.</p>
            </details>
            <details className="faq-item">
              <summary>What insurance does it track?</summary>
              <p>Unit-owner <a className="inline-link" href="/guides/ho6-vs-ho4-vs-wind-only.html">HO-6</a> policies. Our AI reads each <a className="inline-link" href="/guides/what-is-a-declarations-page.html">declaration page</a> and checks it against the requirements your association sets—Coverage A and liability minimums, wind/hurricane coverage, that the policy is in force, and that the named insured and property address match the unit.</p>
            </details>
            <details className="faq-item">
              <summary>Who’s behind condo.insure—and will you try to sell our owners insurance?</summary>
              <p>condo.insure is built by the team behind universalcondo.com, a licensed Florida insurance agency. Owner reminder emails include an optional link to request a free HO-6 quote from our agency. Owners can ignore it and keep any carrier or agent—compliance never depends on where a policy is bought. We never sell owner or association data.</p>
            </details>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta">
        <div className="wrap reveal">
          <h2 className="display">Put your whole association on one dashboard.</h2>
          <p>90 days free, no credit card. Boards: request a setup and we’ll email your invite within one business day. Firms: create your account and start now.</p>
          <div className="hero-cta">
            <Link className="btn btn-light" to="/signup">Set up my association</Link>
            <Link className="btn btn-light" to="/signup/firm">Create a firm account</Link>
            <a className="btn btn-ghost" href={CAL_URL} target="_blank" rel="noopener noreferrer" onClick={() => track('demo_click')} style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.45)' }}>Book a 15-min walkthrough</a>
            <button type="button" className="btn btn-ghost" onClick={openTour} style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.45)' }}>
              <span className="play" aria-hidden="true"></span>Watch the 2-min tour
            </button>
          </div>
        </div>
      </section>

      {/* GUIDES & TOOLS — free reference pages. Contextual internal links from
          the homepage make them discoverable to readers and reachable by
          crawlers. These are static HTML files, so plain <a>, never <Link>. */}
      <section className="how">
        <div className="wrap">
          <div className="sec-head center reveal">
            <span className="eyebrow" style={{ justifyContent: 'center' }}>Free resources</span>
            <h2 className="display">Guides &amp; tools, no signup required.</h2>
            <p>Reference material on Florida condo insurance, cited to the statutes and the regulators — plus two calculators you can use right now.</p>
          </div>
          <div className="res-grid reveal">
            <a className="res" href="/guides/florida-condo-insurance-requirements.html">
              <span className="tag">Florida law</span>
              <div className="k">What the law actually requires</div>
              <p>Association vs. unit owner under § 718.111(11) — and why Florida repealed its HO-6 mandate in 2010.</p>
            </a>
            <a className="res" href="/guides/florida-condo-milestone-inspection-sirs.html">
              <span className="tag">Florida law</span>
              <div className="k">Milestone inspections &amp; SIRS</div>
              <p>The post-Surfside chain from SB 4-D to HB 913, current deadlines, and the coastal rule that no longer exists.</p>
            </a>
            <a className="res" href="/guides/loss-assessment-calculator.html">
              <span className="tag">Calculator</span>
              <div className="k">Loss assessment exposure</div>
              <p>Your master deductible split across units, against the $2,000 minimum most owners carry.</p>
            </a>
            <a className="res" href="/guides/ho6-compliance-cost-calculator.html">
              <span className="tag">Calculator</span>
              <div className="k">What compliance costs</div>
              <p>Your association's exact monthly and annual cost. No email address required.</p>
            </a>
            <a className="res" href="/guides/property-manager-ho6-compliance-tracking.html">
              <span className="tag">Property managers</span>
              <div className="k">Tracking HO-6 across a portfolio</div>
              <p>Requirement profiles, renewals, staff, and board reports across a portfolio of associations.</p>
            </a>
            <a className="res" href="/guides/florida-ho6-compliance-checklist.html">
              <span className="tag">Checklist</span>
              <div className="k">Florida HO-6 compliance checklist</div>
              <p>One printable page: what to require, collect, verify, and track.</p>
            </a>
            <a className="res" href="/guides/what-is-a-declarations-page.html">
              <span className="tag">Fundamentals</span>
              <div className="k">Reading a declarations page</div>
              <p>The six fields an association actually checks — and how a dec page differs from a COI.</p>
            </a>
            <a className="res" href="/guides/how-to-choose-hoa-insurance-tracking-software.html">
              <span className="tag">Buyer's guide</span>
              <div className="k">Choosing tracking software</div>
              <p>Twelve questions to ask any vendor — including us — and the red flags to watch for.</p>
            </a>
          </div>
          <p style={{ marginTop: 20, textAlign: 'center' }}>
            <a className="inline-link" href="/guides/index.html">See all guides →</a>
          </p>
        </div>
      </section>


      <footer className="ft">
        <div className="wrap ft-in">
          <Link className="brand" to="/">
            <img src="/assets/logo-mark.svg" alt="condo.insure" />
            <span><span className="w-condo">condo</span><span className="w-ins">.insure</span><sup style={{ fontSize: '.6em', fontWeight: 600, marginLeft: '1px' }}>™</sup></span>
          </Link>
          <span>Insurance Compliance. Simplified.</span>
          {/* Guides are STATIC HTML under public/guides/, not React Router routes — this
              must stay a plain <a> (a <Link> would hit the SPA catch-all). The other links
              here are correctly <Link>s. */}
          <span className="lk"><a href="/guides/index.html">Guides</a><Link to="/owners">Unit owners</Link><a href="/security.html">Security</a><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></span>
        </div>
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
