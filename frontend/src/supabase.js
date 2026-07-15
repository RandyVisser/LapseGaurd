import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'dev-anon-key'

// Implicit flow so password-reset links work CROSS-DEVICE (people read email on
// their phone but use the site on a computer). PKCE ties the link to the browser
// that started it (its code_verifier), which breaks that very common case.
// Prefetch-safety is handled instead by the token_hash + verifyOtp flow: the
// email link lands on our own page and the one-time token is redeemed by JS,
// which email scanners don't run — see ResetPassword.jsx.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'implicit',
    detectSessionInUrl: true,
    autoRefreshToken: true,
    persistSession: true,
  },
})

// In dev: falls back to '/api' which Vite proxies to the backend container.
// In production: set VITE_API_URL to the Railway backend URL (no trailing slash).
const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

function _raiseApiError(res, text) {
  let detail = text
  try {
    const data = JSON.parse(text)
    const d = data.detail || data.message || text
    detail = typeof d === 'string' ? d : JSON.stringify(d)
  } catch { /* non-JSON body — keep raw text */ }
  // Full technical string goes to the console for debugging; the thrown message
  // is what pages render to users.
  console.error(`[${res.status} ${res.url.replace(/^https?:\/\/[^/]+/, '')}] ${detail}`)
  // 4xx detail stays VERBATIM — flows string-match on backend detail text
  // (e.g. "already been registered", forgot-password hints, billing 400s).
  throw new Error(res.status >= 500
    ? 'Something went wrong on our end — please try again.'
    : detail || `Request failed (${res.status}) — please try again.`)
}

async function _handleResponse(res) {
  if (res.ok) return res.json()
  _raiseApiError(res, await res.text())
}

export async function apiGet(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return _handleResponse(res)
}

export async function apiDelete(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return _handleResponse(res)
}

export async function apiPut(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return _handleResponse(res)
}

export async function apiPatch(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return _handleResponse(res)
}

export async function apiPost(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return _handleResponse(res)
}

// Authenticated file download — returns a Blob (e.g. a generated PDF).
export async function apiDownload(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) _raiseApiError(res, await res.text())
  return res.blob()
}

// Multipart file upload (no Content-Type — the browser sets the boundary)
export async function apiUpload(path, file, field = 'file') {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const fd = new FormData()
  fd.append(field, file)
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  })
  return _handleResponse(res)
}
