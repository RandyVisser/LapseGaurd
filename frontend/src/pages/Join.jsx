import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { track } from '../analytics'
import { supabase } from '../supabase'
import usePageTitle from '../usePageTitle'
import useHeadTags from '../useHeadTags'
import { readError, networkErrorMessage } from '../apiError'

const API = import.meta.env.VITE_API_URL || '/api'

// Auth-page presentation constants (BRANDING.md §5).
const DISPLAY = '"Bricolage Grotesque", sans-serif'
const BODY = '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif'
const INPUT = 'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-base sm:text-sm text-[#0B1B33] placeholder-slate-400 focus:outline-none focus:border-[#014AC5] focus:ring-1 focus:ring-[#014AC5]'
const LABEL = 'block text-sm font-medium text-[#0B1B33] mb-1.5'
const INBOUND = import.meta.env.VITE_INBOUND_ADDRESS || 'docs@condo.insure'

export default function Join() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [invite, setInvite] = useState(null)
  const [form, setForm] = useState({ name: '', password: '' })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [errorStatus, setErrorStatus] = useState(null)
  usePageTitle('Accept your invite')
  useHeadTags({ robots: 'noindex' })

  useEffect(() => {
    // readError copes with non-JSON bodies (proxy 502s) that used to surface
    // as "Unexpected token <".
    fetch(`${API}/invite/${token}`)
      .then(async r => {
        if (r.ok) return r.json()
        setErrorStatus(r.status)
        throw new Error(await readError(r, 'This invite could not be loaded.'))
      })
      .then(setInvite)
      .catch(e => setError(networkErrorMessage(e)))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/invite/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        throw new Error(await readError(res, 'We couldn\u2019t create your account. Please try again.'))
      }
      track('invite_accepted')
      // The account was just created (pre-confirmed) for the invite's email
      // with the password the owner typed a second ago — sign them straight in
      // instead of making them retype it on /login. Any hiccup falls back to
      // the old path, where the welcome banner tells them to sign in.
      try {
        const { data, error: signInErr } = await supabase.auth.signInWithPassword({
          email: invite.email, password: form.password,
        })
        if (!signInErr && data?.session) {
          const role = data.user?.app_metadata?.role || 'tenant'
          const isStaff = ['hoa_admin', 'super_user', 'property_manager'].includes(role)
          navigate(isStaff ? '/admin/dashboard' : '/tenant/dashboard')
          return
        }
      } catch { /* fall through to the sign-in page */ }
      navigate('/login?welcome=tenant')
    } catch (err) {
      setError(networkErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-[#54627A] text-sm" style={{ fontFamily: BODY }} role="status">
      Loading your invite…
    </div>
  )

  if (error && !invite) {
    // The backend answers 410 for a used invite — the status is the reliable
    // signal; the prose match is only a fallback for older error shapes.
    const alreadyUsed = errorStatus === 410 || /already (used|accepted)/i.test(error)
    const notFound = !alreadyUsed && errorStatus === 404
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10 text-[#0B1B33]" style={{ fontFamily: BODY }}>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 max-w-sm w-full text-center">
          <Link to="/" aria-label="condo.insure home" className="inline-block mb-6">
            <img src="/assets/logo-full.svg" alt="condo.insure" className="h-12 mx-auto" />
          </Link>
          <h1 className="text-2xl text-[#001842] mb-2" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>
            {alreadyUsed ? 'Invite already accepted' : notFound ? 'This invite link isn\u2019t valid' : 'We couldn\u2019t load your invite'}
          </h1>
          <p className="text-sm text-[#54627A] mb-5">
            {alreadyUsed
              ? 'You\u2019ve already set up your account with this invite. Sign in to upload your policy and see your status.'
              : notFound
              ? 'The link may be incomplete, or a newer invite may have replaced it. Check your most recent invite email, or ask your association\u2019s manager to resend it.'
              : error}
          </p>
          {alreadyUsed || notFound ? (
            <Link to="/login"
              className="block w-full rounded-lg bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2.5 text-sm transition-colors">
              Go to sign in
            </Link>
          ) : (
            <>
              <button type="button" onClick={() => window.location.reload()}
                className="block w-full rounded-lg bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2.5 text-sm transition-colors">
                Try again
              </button>
              <Link to="/login" className="inline-block mt-3 py-1 text-sm text-[#54627A] hover:text-[#001842]">Go to sign in</Link>
            </>
          )}
          {!alreadyUsed && (
            <p className="text-xs text-[#54627A] mt-5 leading-relaxed">
              Just need to send your declaration page? Email it to{' '}
              <a href={`mailto:${INBOUND}`} className="text-[#014AC5] hover:underline font-semibold">{INBOUND}</a>{' '}
              from the address your association has on file &mdash; no account needed.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10 text-[#0B1B33]" style={{ fontFamily: BODY }}>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8 w-full max-w-md">
        <img src="/assets/logo-full.svg" alt="condo.insure" className="h-12 mb-6" />
        <h1 className="text-2xl sm:text-3xl text-[#001842] mb-1.5" style={{ fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-.02em' }}>Create your account</h1>
        <p className="text-sm text-[#54627A] mb-1">
          You&rsquo;ve been invited to join <strong className="text-[#0B1B33]">{invite?.hoa_name}</strong>.
        </p>
        <p className="text-xs text-[#54627A] mb-6">Unit {invite?.unit_number} · {invite?.email}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="join-name" className={LABEL}>Your name</label>
            <input
              id="join-name"
              type="text"
              autoComplete="name"
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Jane Smith"
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="join-password" className={LABEL}>Choose a password</label>
            <div className="relative">
              <input
                id="join-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="At least 8 characters"
                className={`${INPUT} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 w-11 flex items-center justify-center text-slate-400 hover:text-slate-600"
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

          {error && (
            error.includes('already been registered') ? (
              <p className="text-sm text-red-600">
                You already have a condo.insure account —{' '}
                <Link to="/login" className="text-[#014AC5] hover:underline">sign in</Link> to add this unit to it.
              </p>
            ) : (
              <p className="text-sm text-red-600" role="alert">{error}</p>
            )
          )}

          <button type="submit" disabled={submitting}
            className="w-full rounded-lg bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2.5 text-sm transition-colors disabled:opacity-60">
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
