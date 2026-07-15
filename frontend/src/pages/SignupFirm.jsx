import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { track } from '../analytics'
import usePageTitle from '../usePageTitle'

const API = import.meta.env.VITE_API_URL || '/api'

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
const LABEL = 'block text-sm font-medium text-[#0B1B33] mb-1.5'

export default function SignupFirm() {
  const [form, setForm] = useState({
    firm_name: '', contact_name: '', email: '', password: '', cab_number: '',
    agree_tos: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const startedRef = useRef(false)
  usePageTitle('Create your firm account')

  // Fire the funnel beacon once, on the first touch of the form.
  function markStarted() {
    if (!startedRef.current) {
      startedRef.current = true
      track('signup_started')
    }
  }

  function set(key) {
    return e => setForm(f => ({ ...f, [key]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/onboard/firm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firm_name: form.firm_name,
          contact_name: form.contact_name,
          email: form.email,
          password: form.password,
          cab_number: form.cab_number || null,
          agree_tos: form.agree_tos,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Signup failed')
      }
      setSuccess(true)
      track('signup_completed')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4 text-[#0B1B33]" style={{ fontFamily: BODY }}>
        <div className="w-full max-w-md text-center">
          <img src="/assets/logo-full.svg" alt="condo.insure" className="h-12 mx-auto mb-8" />
          <div className="text-4xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-[#001842] mb-2" style={{ fontFamily: DISPLAY, letterSpacing: '-.02em' }}>
            Your firm account is ready
          </h1>
          <p className="text-[#54627A] mb-6">
            Sign in as <strong className="text-[#0B1B33]">{form.email}</strong> to
            add your first association — you&rsquo;ll import its units and start
            tracking compliance from your portfolio dashboard.
          </p>
          <Link to="/login"
            className="inline-block rounded-lg bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2.5 px-8 text-sm transition-colors">
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-white text-[#0B1B33]" style={{ fontFamily: BODY }}>
      {/* form side */}
      <div className="flex-1 flex flex-col px-6 py-10 sm:px-12">
        <div className="w-full max-w-xl mx-auto">
          <Link to="/" className="text-sm text-[#54627A] hover:text-[#001842] mb-7 inline-block">&larr; Back</Link>
          <img src="/assets/logo-full.svg" alt="condo.insure" className="h-11 mb-6" />
          <h1 className="text-3xl mb-1.5 text-[#001842]" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
            Create your firm account
          </h1>
          <p className="text-sm text-[#54627A] mb-6">
            One login for your whole portfolio — add associations, invite your team,
            and track HO-6 compliance across every property you manage.
          </p>

          <form onSubmit={handleSubmit} onFocusCapture={markStarted} className="space-y-4">
            <div>
              <label className={LABEL}>Firm Name</label>
              <input type="text" required value={form.firm_name} onChange={set('firm_name')}
                placeholder="Gulf Coast Property Management" className={INPUT} />
            </div>

            <div>
              <label className={LABEL}>Your Name</label>
              <input type="text" required value={form.contact_name} onChange={set('contact_name')}
                placeholder="Jane Smith" className={INPUT} />
            </div>

            <div>
              <label className={LABEL}>Email</label>
              <input type="email" required value={form.email} onChange={set('email')}
                placeholder="jane@yourfirm.com" className={INPUT} />
            </div>

            <div>
              <label className={LABEL}>Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={form.password}
                  onChange={set('password')}
                  placeholder="At least 8 characters"
                  className={`${INPUT} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    {showPassword ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65" />
                    ) : (
                      <>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
            </div>

            <div>
              <label className={LABEL}>
                CAB License Number <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input type="text" value={form.cab_number} onChange={set('cab_number')}
                placeholder="CAB1234" className={INPUT} />
              <p className="text-xs text-slate-400 mt-1">Your Florida community association management firm license, if you have one.</p>
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-600 pt-2 border-t border-slate-200">
              <input
                type="checkbox"
                required
                checked={form.agree_tos}
                onChange={e => setForm(f => ({ ...f, agree_tos: e.target.checked }))}
                className="mt-0.5 rounded border-slate-300 text-[#014AC5] focus:ring-[#014AC5] flex-shrink-0"
              />
              <span>I have read and agree to the <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-[#014AC5] hover:underline">Terms of Service</Link>.</span>
            </label>

            {error && (
              error.includes('already been registered') ? (
                <p className="text-sm text-red-600">
                  You already have a condo.insure account —{' '}
                  <Link to="/login" className="text-[#014AC5] hover:underline">sign in</Link> instead.
                </p>
              ) : (
                <p className="text-sm text-red-600">{error}</p>
              )
            )}

            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2.5 text-sm transition-colors disabled:opacity-60">
              {loading ? 'Creating your firm…' : 'Create Firm Account'}
            </button>

            <p className="text-center text-xs text-slate-500">
              No credit card required. Add associations whenever you&rsquo;re ready.
            </p>
          </form>

          <p className="text-center text-sm text-[#54627A] mt-6">
            Setting up a single association instead?{' '}
            <Link to="/signup" className="font-semibold text-[#014AC5] hover:underline">Start here</Link>
          </p>
          <p className="text-center text-sm text-[#54627A] mt-2">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-[#014AC5] hover:underline">Sign in</Link>
          </p>
        </div>
      </div>

      {/* brand side */}
      <aside
        className="hidden lg:flex lg:w-[40%] flex-col justify-center px-14 text-white lg:sticky lg:top-0 lg:h-screen relative overflow-hidden"
        style={{ background: BRAND_GRAD }}
      >
        <div aria-hidden="true" style={SQUARES} />
        <div className="relative max-w-md">
          <span className="text-xs uppercase tracking-[.14em] text-[#6FE3B6]" style={{ fontFamily: MONO }}>
            Built for PM firms
          </span>
          <h2 className="mt-4 text-[34px] leading-[1.1] text-white" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
            Every association&rsquo;s compliance, on one portfolio dashboard.
          </h2>
          <ul className="mt-7 space-y-4 text-[15px] text-[#CBD8EC]">
            <li className="flex gap-3"><span className="text-[#6FE3B6] font-extrabold">✓</span><span>Portfolio view — compliance across every association at a glance</span></li>
            <li className="flex gap-3"><span className="text-[#6FE3B6] font-extrabold">✓</span><span>Drill into any association&rsquo;s dashboard, unit by unit</span></li>
            <li className="flex gap-3"><span className="text-[#6FE3B6] font-extrabold">✓</span><span>One consolidated bill for the whole book — or let each association pay</span></li>
            <li className="flex gap-3"><span className="text-[#6FE3B6] font-extrabold">✓</span><span>Invite your team and assign each manager their own portfolio</span></li>
          </ul>
          <p className="mt-8 pt-5 border-t border-white/15 text-sm text-[#AEC0DC]">
            Volume pricing across your whole portfolio · cancel anytime
          </p>
        </div>
      </aside>
    </div>
  )
}
