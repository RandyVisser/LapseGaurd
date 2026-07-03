import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../supabase'

const DISPLAY = '"Bricolage Grotesque", sans-serif'
const BODY = '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif'
const MONO = '"JetBrains Mono", monospace'
const BRAND_GRAD = 'linear-gradient(150deg,#001842 0%,#06245C 62%,#014AC5 150%)'
// faint 32px grid "squares" over the brand panel, faded with a radial mask
const SQUARES = {
  position: 'absolute', inset: 0, pointerEvents: 'none',
  backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px)',
  backgroundSize: '32px 32px',
  WebkitMaskImage: 'radial-gradient(90% 90% at 80% 25%,#000,transparent 72%)',
  maskImage: 'radial-gradient(90% 90% at 80% 25%,#000,transparent 72%)',
}
const INPUT = 'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-[#0B1B33] placeholder-slate-400 focus:outline-none focus:border-[#014AC5] focus:ring-1 focus:ring-[#014AC5]'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const welcome = params.get('welcome')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) { setError(err.message); return }

    const role = data.user?.user_metadata?.role || data.user?.app_metadata?.role || 'tenant'
    const isAdmin = ['hoa_admin', 'super_user', 'property_manager'].includes(role)
    navigate(isAdmin ? '/admin/dashboard' : '/tenant/dashboard')
  }

  return (
    <div className="min-h-screen flex bg-white text-[#0B1B33]" style={{ fontFamily: BODY }}>
      {/* form side */}
      <div className="flex-1 flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm mx-auto">
          <Link to="/" className="text-sm text-[#54627A] hover:text-[#001842] mb-7 inline-block">&larr; Back</Link>
          <img src="/assets/logo-full.svg" alt="condo.insure" className="h-12 mb-9" />
          <h1 className="text-3xl mb-1.5 text-[#001842]" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
            Welcome back
          </h1>
          <p className="text-sm text-[#54627A] mb-6">Sign in to your association dashboard.</p>

          {welcome === '1' && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-sm text-green-700">
              Account created! Sign in to access your dashboard.
            </div>
          )}
          {welcome === 'tenant' && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-sm text-green-700">
              Account created! Sign in to upload your policy.
            </div>
          )}
          {welcome === 'reset' && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-sm text-green-700">
              Password updated! Sign in with your new password.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#0B1B33] mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@association.org"
                className={INPUT}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0B1B33] mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={INPUT}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2.5 text-sm transition-colors disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="text-center">
              <Link to="/forgot-password" className="text-sm text-[#54627A] hover:text-[#001842]">
                Forgot password?
              </Link>
            </div>
          </form>

          <p className="text-center text-sm text-[#54627A] mt-6">
            New association?{' '}
            <Link to="/signup" className="font-semibold text-[#014AC5] hover:underline">Get started free</Link>
          </p>
        </div>
      </div>

      {/* brand side */}
      <aside
        className="hidden lg:flex flex-1 flex-col justify-center px-14 text-white relative overflow-hidden"
        style={{ background: BRAND_GRAD }}
      >
        <div aria-hidden="true" style={SQUARES} />
        <div className="relative max-w-md">
          <span className="text-xs uppercase tracking-[.14em] text-[#6FE3B6]" style={{ fontFamily: MONO }}>
            condo.insure
          </span>
          <h2 className="mt-4 text-[34px] leading-[1.1] text-white" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
            Track every owner&rsquo;s insurance in one dashboard.
          </h2>
          <ul className="mt-7 space-y-4 text-[15px] text-[#CBD8EC]">
            <li className="flex gap-3"><span className="text-[#6FE3B6] font-extrabold">✓</span><span>See every unit&rsquo;s insurance status at a glance</span></li>
            <li className="flex gap-3"><span className="text-[#6FE3B6] font-extrabold">✓</span><span>AI reads each declaration page for you</span></li>
            <li className="flex gap-3"><span className="text-[#6FE3B6] font-extrabold">✓</span><span>Owners email their policy in — no login needed</span></li>
            <li className="flex gap-3"><span className="text-[#6FE3B6] font-extrabold">✓</span><span>Automated renewal reminders on autopilot</span></li>
          </ul>
          <p className="mt-8 pt-5 border-t border-white/15 text-sm text-[#AEC0DC]">
            Insurance compliance for condo &amp; HOA boards. Built for Florida.
          </p>
        </div>
      </aside>
    </div>
  )
}
