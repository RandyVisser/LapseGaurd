import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../supabase'

const DISPLAY = '"Bricolage Grotesque", sans-serif'
const BODY = '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif'
const INPUT = 'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-[#0B1B33] placeholder-slate-400 focus:outline-none focus:border-[#014AC5] focus:ring-1 focus:ring-[#014AC5]'

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
    <div className="min-h-screen bg-white flex items-center justify-center text-[#54627A] text-sm" style={{ fontFamily: BODY }}>
      Verifying reset link…
    </div>
  )

  if (status === 'invalid') return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 text-[#0B1B33]" style={{ fontFamily: BODY }}>
      <div className="w-full max-w-sm">
        <Link to="/" className="inline-block mb-8">
          <img src="/assets/logo-full.svg" alt="condo.insure" className="h-11" />
        </Link>
        <h1 className="text-2xl mb-1.5 text-[#001842]" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
          Reset link expired
        </h1>
        <p className="text-sm text-[#54627A] mb-6">
          {error || 'This password reset link is no longer valid.'} Reset links can
          only be used once and expire after a short time — please request a new one.
        </p>
        <button onClick={() => navigate('/forgot-password')}
          className="w-full rounded-lg bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2.5 text-sm transition-colors">
          Request a new link
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 text-[#0B1B33]" style={{ fontFamily: BODY }}>
      <div className="w-full max-w-sm">
        <Link to="/" className="inline-block mb-8">
          <img src="/assets/logo-full.svg" alt="condo.insure" className="h-11" />
        </Link>
        <h1 className="text-2xl mb-1.5 text-[#001842]" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
          Set a new password
        </h1>
        <p className="text-sm text-[#54627A] mb-6">Choose a strong password for your account.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#0B1B33] mb-1.5">New Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={INPUT}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0B1B33] mb-1.5">Confirm Password</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              className={INPUT}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full rounded-lg bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2.5 text-sm transition-colors disabled:opacity-60">
            {loading ? 'Saving…' : 'Set Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
