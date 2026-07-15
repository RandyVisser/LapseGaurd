import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { track } from '../analytics'
import usePageTitle from '../usePageTitle'

const API = import.meta.env.VITE_API_URL || '/api'

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

  useEffect(() => {
    fetch(`${API}/invite/${token}`)
      .then(r => r.ok ? r.json() : r.json().then(d => {
        setErrorStatus(r.status)
        throw new Error(d.detail)
      }))
      .then(setInvite)
      .catch(e => setError(e.message))
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
        const data = await res.json()
        throw new Error(data.detail || 'Failed to create account')
      }
      track('invite_accepted')
      navigate('/login?welcome=tenant')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
      Loading your invite…
    </div>
  )

  if (error && !invite) {
    // The backend answers 410 for a used invite — the status is the reliable
    // signal; the prose match is only a fallback for older error shapes.
    const alreadyUsed = errorStatus === 410 || /already (used|accepted)/i.test(error)
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-sm w-full text-center">
          <img src="/assets/logo-full.svg" alt="condo.insure" className="h-9 mx-auto mb-6" />
          <h1 className="text-lg font-bold text-slate-800 mb-2">Invalid Invite</h1>
          <p className="text-sm text-slate-500 mb-4">
            {alreadyUsed
              ? "You've already accepted this invite — sign in below."
              : 'Ask your association manager to resend your invite.'}
          </p>
          <Link to="/login" className="text-blue-600 hover:underline text-sm">Go to sign in →</Link>
          <p className="text-xs text-slate-400 mt-4">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-md">
        <img src="/assets/logo-full.svg" alt="condo.insure" className="h-10 mb-6" />
        <h1 className="text-2xl font-bold text-blue-800 mb-1">Create your account</h1>
        <p className="text-sm text-slate-500 mb-1">
          You've been invited to join <strong>{invite?.hoa_name}</strong>
        </p>
        <p className="text-xs text-slate-400 mb-6">Unit {invite?.unit_number} · {invite?.email}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Your Name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Jane Smith"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Set a Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="At least 8 characters"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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

          {error && (
            error.includes('already been registered') ? (
              <p className="text-sm text-red-600">
                You already have a condo.insure account —{' '}
                <Link to="/login" className="text-blue-600 hover:underline">sign in</Link> to add this unit to it.
              </p>
            ) : (
              <p className="text-sm text-red-600">{error}</p>
            )
          )}

          <button type="submit" disabled={submitting}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60">
            {submitting ? 'Creating account…' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
