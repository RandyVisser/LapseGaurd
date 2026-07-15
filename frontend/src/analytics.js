// Anonymous funnel beacons — no PII. Sends an allow-listed event name + the page
// path + a random session id (localStorage) so the super-user funnel can count
// unique-ish visitors, plus first-touch campaign attribution (utm/referrer) so
// outbound-campaign clicks are distinguishable from bots. Sent as text/plain so
// navigator.sendBeacon works cross-origin with no CORS preflight. Must never
// throw / break the page.
const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

function sessionId() {
  try {
    let id = localStorage.getItem('ci.sid')
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2)
      localStorage.setItem('ci.sid', id)
    }
    return id
  } catch {
    return null
  }
}

// One-time self-exclude: visiting any page with ?notrack=1 permanently marks this
// browser as internal (for logged-out demos / incognito / a fresh device).
function selfExcluded() {
  try {
    if (location.search.includes('notrack=1')) localStorage.setItem('ci.notrack', '1')
    return localStorage.getItem('ci.notrack') === '1'
  } catch {
    return false
  }
}

// Founders/testers: the moment an internal account logs in on a browser, flag
// that browser permanently (same ci.notrack flag as ?notrack=1) so its
// logged-OUT browsing stops counting as prospect traffic too. Called from
// AuthContext whenever a session appears. Mirrors the backend's internal-email
// exclusions (_INTERNAL_EMAILS in routes/analytics.py).
const INTERNAL_DOMAINS = ['condo.insure', 'universalcondo.com']
const INTERNAL_GMAIL_INBOXES = ['troy.visser', 'randy.redfish'] // incl. +aliases

export function excludeIfInternal(email) {
  try {
    const [inbox, domain] = (email || '').toLowerCase().split('@')
    if (!domain) return
    const internal = INTERNAL_DOMAINS.includes(domain)
      || (domain === 'gmail.com' && INTERNAL_GMAIL_INBOXES.includes(inbox.split('+')[0]))
    if (internal) localStorage.setItem('ci.notrack', '1')
  } catch { /* analytics is best-effort; never break the page */ }
}

// First-touch campaign attribution: the first time this browser arrives with a
// recognized tag (utm_* on Apollo outbound links, or a short src/ref), remember
// the compact tag string forever (localStorage 'ci.utm') so every later beacon
// carries the ORIGINAL source — even after navigation strips the query string.
// Later visits with different tags never overwrite it (first touch wins).
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'src', 'ref']

function utmFirstTouch() {
  try {
    const saved = localStorage.getItem('ci.utm')
    if (saved) return saved
    const params = new URLSearchParams(location.search)
    const parts = []
    for (const k of UTM_KEYS) {
      const v = params.get(k)
      if (v) parts.push(`${k}=${v.slice(0, 80)}`)
    }
    if (!parts.length) return null
    const utm = parts.join('&')
    localStorage.setItem('ci.utm', utm)
    return utm
  } catch {
    return null
  }
}

// Cross-origin referrer only — same-origin navigation referrers are noise.
function externalReferrer() {
  try {
    const ref = document.referrer
    if (!ref || new URL(ref).origin === location.origin) return null
    return ref.slice(0, 200)
  } catch {
    return null
  }
}

// A real signup prospect is logged OUT through landing → pricing → signup, so a
// persisted Supabase session means it's us (founders) or an existing user —
// exclude them from the funnel. (Supabase stores the session under
// sb-<ref>-auth-token / .0 chunks.)
function hasSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('sb-') && k.includes('auth-token')) return true
    }
  } catch { /* ignore */ }
  return false
}

export function track(name) {
  try {
    if (selfExcluded()) return
    // owner_upload is a logged-in action by nature, so it bypasses the session
    // check; every other funnel event should only count logged-out prospects.
    if (name !== 'owner_upload' && hasSession()) return

    const body = JSON.stringify({
      name,
      path: location.pathname,
      session_id: sessionId(),
      utm: utmFirstTouch(),
      referrer: externalReferrer(),
    })
    const url = `${API_BASE}/analytics/event`
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {})
    }
  } catch {
    /* analytics is best-effort; never break the page */
  }
}
