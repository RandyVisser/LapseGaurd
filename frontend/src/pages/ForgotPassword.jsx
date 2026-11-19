import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import usePageTitle from '../usePageTitle'

const DISPLAY = '"Bricolage Grotesque", sans-serif'
const BODY = '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif'
const INPUT = 'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-base sm:text-sm text-[#0B1B33] placeholder-slate-400 focus:outline-none focus:border-[#014AC5] focus:ring-1 focus:ring-[#014AC5]'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  usePageTitle('Reset your password')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setSent(true)
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 text-[#0B1B33]" style={{ fontFamily: BODY }}>
      <div className="w-full max-w-sm">
        <Link to="/" className="inline-block mb-8">
          <img src="/assets/logo-full.svg" alt="condo.insure" className="h-[59px]" />
        </Link>
        <Link to="/login" className="text-sm text-[#54627A] hover:text-[#001842] mb-6 inline-block">&larr; Back to sign in</Link>
        <h1 className="text-2xl mb-1.5 text-[#001842]" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
          Reset your password
        </h1>
        <p className="text-sm text-[#54627A] mb-6">
          Enter your email and we&rsquo;ll send you a reset link.
        </p>

        {sent ? (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
            If there&rsquo;s an account for <strong>{email}</strong>, a reset link is on its way. It can take a
            few minutes &mdash; check your spam folder if it doesn&rsquo;t arrive.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="fp-email" className="block text-sm font-medium text-[#0B1B33] mb-1.5">Email</label>
              <input
                id="fp-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@association.org"
                className={INPUT}
              />
            </div>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2.5 text-sm transition-colors disabled:opacity-60">
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
