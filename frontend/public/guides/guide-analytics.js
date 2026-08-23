/* Guide-page analytics beacon.
 *
 * The /guides/ pages are static HTML with no bundler, so they can't import
 * src/analytics.js. This is a hand-maintained vanilla mirror of it.
 *
 * ⚠️ src/analytics.js is the SOURCE OF TRUTH. It and this file MUST agree on the
 * localStorage keys — ci.sid / ci.notrack / ci.utm / ci.ref — because a visitor
 * who lands on a guide from Google and later signs up has to stitch into one
 * session. Change one, change the other.
 *
 * __API_BASE__ is substituted at build time by scripts/postbuild-guides.mjs
 * (public/ is copied verbatim by Vite, so import.meta.env is not available here).
 *
 * Crawlers don't execute JS, so this is inert for them — and the backend drops
 * bot user-agents at ingest anyway. Best-effort throughout: never throw.
 */
(function () {
  var API_BASE = '__API_BASE__'

  // Unsubstituted placeholder means the build step didn't run or VITE_API_URL
  // was missing. Bail loudly in the console rather than beaconing to a bad URL.
  if (API_BASE.indexOf('__API') === 0) {
    if (window.console && console.warn) {
      console.warn('[condo.insure] guide analytics disabled: API base was not substituted at build time.')
    }
    return
  }

  function ls(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  function save(k, v) { try { localStorage.setItem(k, v) } catch (e) { /* private mode */ } }

  // ?notrack=1 permanently marks this browser internal (same flag the SPA uses).
  function selfExcluded() {
    try {
      if (location.search.indexOf('notrack=1') !== -1) save('ci.notrack', '1')
      return ls('ci.notrack') === '1'
    } catch (e) { return false }
  }

  // A logged-in browser is us or an existing customer, not a prospect.
  function hasSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i)
        if (k && k.indexOf('sb-') === 0 && k.indexOf('auth-token') !== -1) return true
      }
    } catch (e) { /* ignore */ }
    return false
  }

  function sessionId() {
    var id = ls('ci.sid')
    if (!id) {
      id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2)
      save('ci.sid', id)
    }
    return id
  }

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'src', 'ref']

  function utmFirstTouch() {
    try {
      var saved = ls('ci.utm')
      if (saved) return saved
      var params = new URLSearchParams(location.search)
      var parts = []
      for (var i = 0; i < UTM_KEYS.length; i++) {
        var v = params.get(UTM_KEYS[i])
        if (v) parts.push(UTM_KEYS[i] + '=' + v.slice(0, 80))
      }
      if (!parts.length) return null
      var utm = parts.join('&')
      save('ci.utm', utm)
      return utm
    } catch (e) { return null }
  }

  // First-touch referrer. Organic search is the whole point of these pages: a
  // visitor arrives from Google onto a guide, then clicks through to the SPA —
  // at which point document.referrer is same-origin and the Google referrer is
  // gone forever. Persisting it here is what makes organic attribution survive
  // to signup.
  function referrerFirstTouch() {
    try {
      var saved = ls('ci.ref')
      if (saved) return saved
      var ref = document.referrer
      if (!ref) return null
      if (new URL(ref).origin === location.origin) return null
      ref = ref.slice(0, 200)
      save('ci.ref', ref)
      return ref
    } catch (e) { return null }
  }

  // Exclusion (notrack flag / logged-in browser) gates the BEACONS, not the
  // listeners — the checklist form below must still navigate for everyone.
  var excluded = false
  try { excluded = selfExcluded() || hasSession() } catch (e) { excluded = false }

  function payload(extra) {
    var p = {
      path: location.pathname,
      session_id: sessionId(),
      utm: utmFirstTouch(),
      referrer: referrerFirstTouch()
    }
    for (var k in extra) p[k] = extra[k]
    return JSON.stringify(p)
  }

  function post(endpoint, body) {
    if (excluded) return
    try {
      var url = API_BASE + endpoint
      // text/plain keeps it a CORS-simple request (no preflight), same as the SPA.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))
      } else {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true })
          .catch(function () {})
      }
    } catch (e) { /* analytics is best-effort; never break the page */ }
  }

  function send(name) {
    try { post('/analytics/event', payload({ name: name })) } catch (e) { /* best-effort */ }
  }

  try {
    send('guide_view')

    // Demo bookings leave for an external calendar page, so the click is the
    // last moment we can observe — same demo_click event the SPA fires, so the
    // funnel card counts landing and guide bookings together.
    document.addEventListener('click', function (ev) {
      var t = ev.target
      var a = t && t.closest ? t.closest('a[href*="calendar.app.google"]') : null
      if (a) send('demo_click')
    })

    // Checklist form: store the lead (backend keeps it for PERSONAL follow-up,
    // never automated email), then go to the checklist page. Without JS the
    // form's own action performs the same navigation.
    document.addEventListener('submit', function (ev) {
      var f = ev.target
      if (!f || !f.hasAttribute || !f.hasAttribute('data-checklist')) return
      ev.preventDefault()
      try {
        var input = f.querySelector('input[type="email"]')
        var email = input && input.value ? input.value.trim() : ''
        if (email) post('/analytics/checklist-lead', payload({ email: email }))
      } catch (e) { /* the lead is best-effort; the navigation is not */ }
      location.href = f.getAttribute('action') || '/guides/florida-ho6-compliance-checklist.html'
    })
  } catch (e) { /* analytics is best-effort; never break the page */ }
})()
