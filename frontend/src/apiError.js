// Turn a failed fetch Response into one readable sentence for a form.
//
// FastAPI returns three shapes, and the signup forms used to assume only one:
//   - HTTPException:      {"detail": "Some message"}
//   - validation (422):   {"detail": [{"loc": [...], "msg": "...", ...}, ...]}
//   - proxy/crash (502…): an HTML or empty body — res.json() THROWS on it
// Rendering the 422 array directly shows "[object Object]"; letting res.json()
// throw shows "Unexpected token <". Both read as "this site is broken".
const SUPPORT = 'support@condo.insure'

const FIELD_LABELS = {
  email: 'Email',
  association_name: 'Association name',
  address: 'Address',
  admin_name: 'Your name',
  unit_count: 'Number of units',
  firm_name: 'Firm name',
  contact_name: 'Your name',
  password: 'Password',
  cab_number: 'CAB license number',
}

function describeValidation(items) {
  const parts = items.slice(0, 3).map((it) => {
    const loc = Array.isArray(it?.loc) ? it.loc : []
    const field = loc.filter((x) => x !== 'body').pop()
    const label = FIELD_LABELS[field] || (typeof field === 'string' ? field.replace(/_/g, ' ') : '')
    const msg = String(it?.msg || 'is invalid').replace(/^value is not a valid email address:?\s*/i, 'is not a valid email address. ')
    return label ? `${label}: ${msg}` : msg
  })
  return parts.join(' · ').trim()
}

export async function readError(res, fallback = 'Something went wrong') {
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  const detail = data && data.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) {
    const text = describeValidation(detail)
    if (text) return `Please check the form — ${text}`
  }
  if (res.status === 429) return 'Too many attempts. Please wait a bit and try again.'
  if (res.status >= 500 || !data) {
    return `We couldn’t reach our servers just now. Please try again in a minute — or email ${SUPPORT} and we’ll set you up by hand.`
  }
  return fallback
}

// fetch() itself rejects on network failure (offline, DNS, CORS) with a
// TypeError whose message is browser-specific gibberish ("Failed to fetch").
export function networkErrorMessage(err) {
  if (err && err.name === 'TypeError') {
    return `We couldn’t reach our servers. Check your connection and try again — or email ${SUPPORT}.`
  }
  return (err && err.message) || `Something went wrong. Email ${SUPPORT} and we’ll help.`
}
