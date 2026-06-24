import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('verifying') // verifying | ready | invalid
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    // Supabase fires PASSWORD_RECOVERY once the recovery session is established.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && active) setStatus('ready')
    })

    async function verify() {
      const url = new URL(window.location.href)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

      // token_hash flow — the email link comes straight here (not through
      // Supabase's verify GET), and the one-time token is only consumed by this
      // client-side verifyOtp call. Email-scanner prefetches load the HTML but
      // don't run JS, so the token stays valid for the real user.
      const tokenHash = url.searchParams.get('token_hash') || hash.get('token_hash')
      if (tokenHash) {
        const type = url.searchParams.get('type') || hash.get('type') || 'recovery'
        const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        if (!active) return
        if (vErr) { setError(vErr.message); setStatus('invalid'); return }
        setStatus('ready')
        return
      }

      // An expired/already-consumed link comes back as an error param.
      const errCode = url.searchParams.get('error_code') || hash.get('error_code')
      const errDesc = url.searchParams.get('error_description') || hash.get('error_description')
      if (errCode) {
        if (!active) return
        setError(decodeURIComponent(errDesc || '').replace(/\+/g, ' ') ||
          'This reset link is no longer valid.')
        setStatus('invalid')
        return
      }

      // PKCE: exchange the ?code= for a recovery session.
      const code = url.searchParams.get('code')
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code)
        if (!active) return
        if (exErr) { setError(exErr.message); setStatus('invalid'); return }
        setStatus('ready')
        return
      }

      // Implicit fallback / page reload: a session may already be present.
      const { data: { session } } = await supabase.auth.getSession()
      if (!active) return
      if (session) setStatus('ready')
    }
    verify()

    return () => { active = false; subscription.unsubscribe() }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) { setError(err.message); return }
    await supabase.auth.signOut()
    navigate('/login?welcome=reset')
  }

  if (status === 'verifying') return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
      Verifying reset link…
    </div>
  )

  if (status === 'invalid') return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-slate-800 mb-1">Reset link expired</h1>
        <p className="text-sm text-slate-500 mb-6">
          {error || 'This password reset link is no longer valid.'} Reset links can
          only be used once and expire after a short time — please request a new one.
        </p>
        <button onClick={() => navigate('/forgot-password')}
          className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm">
          Request a new link
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-slate-800 mb-1">Set a new password</h1>
        <p className="text-sm text-slate-500 mb-6">Choose a strong password for your account.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60">
            {loading ? 'Saving…' : 'Set Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
