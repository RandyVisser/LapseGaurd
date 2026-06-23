// Anonymous funnel beacons — no PII. Sends an allow-listed event name + the page
// path + a random session id (localStorage) so the super-user funnel can count
// unique-ish visitors. Sent as text/plain so navigator.sendBeacon works
// cross-origin with no CORS preflight. Must never throw / break the page.
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

export function track(name) {
  try {
    const body = JSON.stringify({ name, path: location.pathname, session_id: sessionId() })
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
