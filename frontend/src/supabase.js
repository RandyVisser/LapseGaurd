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

async function _handleResponse(res, path) {
  if (res.ok) return res.json()
  const text = await res.text()
  const prefix = `[${res.status} ${res.url.replace(/^https?:\/\/[^/]+/, '')}]`
  try {
    const data = JSON.parse(text)
    const detail = data.detail || data.message || text
    const msg = typeof detail === 'string' ? detail : JSON.stringify(detail)
    throw new Error(`${prefix} ${msg}`)
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`${prefix} ${text}`)
    throw e
  }
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
  if (!res.ok) {
    const prefix = `[${res.status} ${res.url.replace(/^https?:\/\/[^/]+/, '')}]`
    let detail = await res.text()
    try { detail = JSON.parse(detail).detail || detail } catch { /* keep text */ }
    throw new Error(`${prefix} ${detail}`)
  }
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
