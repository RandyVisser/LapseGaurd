import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { track } from '../analytics'
import './landing.css'

const TOUR_VIDEO_URL = '/assets/tour.mp4'
const CAL_URL = 'https://calendar.app.google/FomLtiZGYqtmt8jUA'

export default function Landing() {
  const rootRef = useRef(null)
  const [tourOpen, setTourOpen] = useState(false)

  useEffect(() => {
    track('landing_view')
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
        const p = Math.min(1, (n - s) / ms), e = 1 - Math.pow(1 - p, 3)
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
            <img src="/assets/logo-mark.svg" alt="condo.insure shield logo" />
            <span><span className="w-condo">condo</span><span className="w-ins">.insure</span></span>
          </Link>
          <nav className="nav-links">
            <a className="txt" href="#features">Product</a>
            <a className="txt" href="#how">How it works</a>
            <a className="txt" href="#pricing">Pricing</a>
            <Link className="txt" to="/login">Sign in</Link>
            <Link className="btn btn-primary" to="/signup">Start free</Link>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="hero">
        <div className="wrap">
          <div>
            <span className="eyebrow">Insurance compliance for condos &amp; HOAs</span>
            <h1 className="display">Every unit covered,<br /><span className="pop">without the paperwork chase.</span></h1>
            <p className="lede">condo.insure tracks each owner’s policy, reads their declaration page, and sends the reminders for you — so your board always knows who’s covered.</p>
            <div className="hero-cta">
              <Link className="btn btn-primary" to="/signup">Start free</Link>
              <a className="btn btn-secondary" href={CAL_URL} target="_blank" rel="noopener noreferrer">Book a demo</a>
              <button type="button" className="btn btn-ghost" onClick={() => setTourOpen(true)}>
                <span className="play" aria-hidden="true"></span>Watch the 2-min tour
              </button>
            </div>
            <div className="trust">
              <span><span className="chk">✓</span> No credit card</span>
              <span><span className="chk">✓</span> Set up in minutes</span>
              <span><span className="chk">✓</span> Owners need no login</span>
              <span><span className="chk">✓</span> Built for Florida</span>
            </div>
          </div>

          <div className="frame">
            <div className="board" role="img" aria-label="Live compliance board: 18 active, 2 expiring, 1 lapsed.">
              <div className="board-top">
                <span className="ttl"><span className="pin" aria-hidden="true"></span>Harbor Point · Compliance</span>
                <span className="live">21 units · live</span>
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
      </section>

      {/* AUTO-ADVANCING FEATURE TABS */}
      <section className="tabs-sec" id="features">
        <div className="wrap">
          <div className="tabs-head reveal">
            <span className="eyebrow">One place for everything</span>
            <h2 className="display">Everything your board needs to stay covered</h2>
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
              <div className="cap"><h3>The dec page reads itself</h3><p>We read each declaration page and check it against your HO-6 requirements automatically.</p></div>
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
                    <div className="field"><span className="lab">Loss Assessment</span><span className="val">$50,000 <span className="ok">✓</span></span></div>
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
              <div className="cap"><h3>Owners just forward the email</h3><p>No login, no upload — an owner forwards their insurer’s email and we pull the declaration page, parse it, and attach it to the right unit.</p></div>
              <div className="stage stage-rem">
                <div className="emailflow">
                  <div className="phone">
                    <div className="phone-screen">
                      <span className="phone-island"></span>
                      <div className="mc-top"><span>Cancel</span><span className="mc-title">New Message</span><span className="mc-send">↑</span></div>
                      <div className="mc-row"><span className="mc-lab">To:</span>docs@condo.insure</div>
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
          <h2 className="display">When one unit lapses, the bill <span className="u">doesn’t stop at their door.</span></h2>
          <div className="stakes-grid">
            <div className="stake"><div className="k">Shared exposure</div><p>A claim on an <b>uninsured unit</b> can fall back to the master policy — and every owner’s premium.</p></div>
            <div className="stake"><div className="k">Silent renewals</div><p>Policies expire on their <b>own schedule</b>. Nobody tells the board until there’s a claim.</p></div>
            <div className="stake"><div className="k">Scattered proof</div><p>Declaration pages live in <b>inboxes and filing cabinets</b>, never where you need them.</p></div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="how" id="how">
        <div className="wrap">
          <div className="how-head reveal">
            <span className="eyebrow">How it works</span>
            <h2 className="display">From a guess to a board, in five steps.</h2>
            <p>You bring the association. We build the unit list from public records, then keep every policy current for you.</p>
          </div>
          <div className="steps">
            <div className="step reveal"><div className="idx">01</div><div><h3>Sign up your association</h3><p>Add your name and address. That’s the whole form.</p><div className="meta">~60 seconds</div></div></div>
            <div className="step reveal"><div className="idx">02</div><div><h3>We build it out for you</h3><p>We assemble your owner list from property-assessor records and invite you in once it’s ready.</p><div className="meta">done before you log in</div></div></div>
            <div className="step reveal"><div className="idx">03</div><div><h3>Review owners, send invites</h3><p>Check the list, fill any missing emails, and send each owner a link tied to their unit.</p><div className="meta">one click per owner</div></div></div>
            <div className="step reveal"><div className="idx">04</div><div><h3>Owners upload their dec page</h3><p>Each owner adds their declaration page. We read it and check it against your HO-6 requirements.</p><div className="meta">AI-reviewed on upload</div></div></div>
            <div className="step reveal"><div className="idx">05</div><div><h3>Watch the board stay green</h3><p>Active, expiring, lapsed, or missing — at a glance. Automated reminders go out at 30, 7, and 1 day, and the moment a policy lapses.</p><div className="meta">reminders on autopilot</div></div></div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="pricing" id="pricing">
        <div className="wrap">
          <div className="sec-head center reveal">
            <span className="eyebrow" style={{ justifyContent: 'center' }}>Pricing</span>
            <h2 className="display">Priced by the unit. Cheaper at scale.</h2>
            <p>Units are billed by band, so the per-unit rate drops as you grow — with a $50/month minimum. Every feature included at every size.</p>
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
              <div className="tnote">Large portfolios</div>
            </div>
            <div className="tier">
              <div className="band">10,000+ units</div>
              <div className="tprice">$0.25<span className="u">/unit/mo</span></div>
              <div className="tnote">Management companies</div>
            </div>
          </div>

          <div className="price-foot reveal">
            <div className="pf-left">
              <div className="price-incl-h">Everything included, at every tier</div>
              <ul className="price-list price-list-2col">
                <li>Real-time compliance board</li>
                <li>AI declaration-page review</li>
                <li>Email-in — owners need no login</li>
                <li>Automated renewal reminders</li>
                <li>Shared document center</li>
                <li>Unlimited owners &amp; admins</li>
              </ul>
            </div>
            <div className="pf-right">
              <div className="price-eg">A 120-unit association = <b>$120 / month</b></div>
              <Link className="btn btn-primary btn-block" to="/signup">Start free</Link>
              <div className="price-mini">$50/mo minimum · no setup fee · cancel anytime</div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq" id="faq">
        <div className="wrap faq-wrap">
          <div className="sec-head center reveal">
            <span className="eyebrow">Questions</span>
            <h2 className="display">Answers before you ask</h2>
          </div>
          <div className="faq-list reveal">
            <details className="faq-item" open>
              <summary>Do unit owners need to create an account?</summary>
              <p>No. Owners can forward their insurer’s email or use a one-time link to send their declaration page — no account, no password. We match it to their unit automatically.</p>
            </details>
            <details className="faq-item">
              <summary>What if we don’t have emails for every owner?</summary>
              <p>That’s normal. We assemble your owner list from public property records during setup, and you fill in emails as you collect them. You can invite owners one at a time as you go.</p>
            </details>
            <details className="faq-item">
              <summary>How long does setup take?</summary>
              <p>Minutes to start. You add your association; we pre-build the unit list from public property records and invite you in to review — no spreadsheet to upload.</p>
            </details>
            <details className="faq-item">
              <summary>Is our association’s data secure?</summary>
              <p>Yes. Documents are stored privately and access is scoped to your association. Owners only ever see their own unit and the shared building documents.</p>
            </details>
            <details className="faq-item">
              <summary>What does it cost?</summary>
              <p>$1 per unit, per month for most associations (with a $50/month minimum), dropping to $0.50 and then $0.25 per unit at large-portfolio scale. Billed to the association — no setup fee, and you can start free.</p>
            </details>
            <details className="faq-item">
              <summary>What insurance does it track?</summary>
              <p>Unit-owner HO-6 policies, checked against your association’s requirements — Coverage A, loss assessment, wind/hurricane, and more, pulled straight from the declaration page.</p>
            </details>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta">
        <div className="wrap reveal">
          <h2 className="display">Put your whole building on one board.</h2>
          <p>Set up your association in minutes. No credit card required.</p>
          <div className="hero-cta">
            <Link className="btn btn-light" to="/signup">Start free</Link>
            <a className="btn btn-ghost" href={CAL_URL} target="_blank" rel="noopener noreferrer" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.45)' }}>Book a demo</a>
            <button type="button" className="btn btn-ghost" onClick={() => setTourOpen(true)} style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.45)' }}>
              <span className="play" aria-hidden="true"></span>Watch the 2-min tour
            </button>
          </div>
        </div>
      </section>

      <footer className="ft">
        <div className="wrap ft-in">
          <Link className="brand" to="/">
            <img src="/assets/logo-mark.svg" alt="condo.insure" />
            <span><span className="w-condo">condo</span><span className="w-ins">.insure</span><sup style={{ fontSize: '.6em', fontWeight: 600, marginLeft: '1px' }}>™</sup></span>
          </Link>
          <span>Insurance Compliance. Simplified.</span>
          <span className="lk"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></span>
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
