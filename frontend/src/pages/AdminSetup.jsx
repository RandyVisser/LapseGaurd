import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import usePageTitle from '../usePageTitle'

const API = import.meta.env.VITE_API_URL || '/api'

export default function AdminSetup() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [invite, setInvite] = useState(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [agreeTos, setAgreeTos] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  usePageTitle('Accept your invite')

  useEffect(() => {
    fetch(`${API}/admin-invite/${token}`)
      .then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d.detail) }))
      .then(setInvite)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      // An existing account never sends a password — it only accepts + agrees to
      // the ToS (its password is never touched).
      const res = await fetch(`${API}/admin-invite/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invite?.existing_account
          ? { agree_tos: agreeTos }
          : { password, agree_tos: agreeTos }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Could not set up your account')
      }
      const data = await res.json().catch(() => ({}))
      // If the email already had an account, we did NOT change its password —
      // send them to sign in with their existing one rather than implying reset.
      navigate(data.existing_account ? '/login?welcome=existing' : '/login?welcome=admin')
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

  if (error && !invite) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-sm w-full text-center">
        <img src="/assets/logo-full.svg" alt="condo.insure" className="h-9 mx-auto mb-6" />
        <h1 className="text-lg font-bold text-slate-800 mb-2">Invalid setup link</h1>
        <p className="text-sm text-slate-500 mb-4">{error}</p>
        <Link to="/login" className="text-blue-600 hover:underline text-sm">Go to sign in →</Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-md">
        <img src="/assets/logo-full.svg" alt="condo.insure" className="h-10 mb-6" />
        <h1 className="text-2xl font-bold text-blue-800 mb-1">
          {invite?.existing_account ? 'Accept your invitation'
            : invite?.firm_name ? 'Join your team'
            : invite?.role === 'property_manager' ? 'Set up your property manager account'
            : 'Set up your admin account'}
        </h1>
        <p className="text-sm text-slate-500 mb-1">
          {invite?.firm_name
            ? <>You're joining <strong>{invite.firm_name}</strong> — you'll see every association your firm manages</>
            : invite?.role === 'property_manager'
            ? <>You're the property manager for <strong>{invite?.hoa_name}</strong></>
            : <>You're the admin for <strong>{invite?.hoa_name}</strong></>}
        </p>
        <p className={invite?.role === 'property_manager' && !invite?.firm_name
          ? 'text-xs text-slate-400 mb-3' : 'text-xs text-slate-400 mb-6'}>
          {invite?.email}
        </p>
        {invite?.role === 'property_manager' && !invite?.firm_name && (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-6">
            {invite?.existing_firm_name
              ? (invite?.existing_firm_open !== false
                  ? <><strong>{invite.hoa_name}</strong> will be added to <strong>{invite.existing_firm_name}</strong>'s
                      portfolio — everyone on your team will be able to see and manage it.</>
                  : <><strong>{invite.hoa_name}</strong> will be added to <strong>{invite.existing_firm_name}</strong>'s
                      portfolio — you and the teammates assigned to it will be able to see and manage it.</>)
              : <>Teammates you add to your firm later will also be able to see and manage this association.</>}
          </p>
        )}

        {invite?.existing_account && (
          <p className="text-xs text-slate-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-6">
            You already have a condo.insure account — no new password needed. Accept below and this
            association is added to your account; keep signing in with your existing password.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!invite?.existing_account && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Set a Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
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
          )}

          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              required
              checked={agreeTos}
              onChange={e => setAgreeTos(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
            />
            <span>I have read and agree to the <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Terms of Service</Link>.</span>
          </label>

          {error && (
            <p className="text-sm text-red-600">
              {error}{' '}
              {error.toLowerCase().includes('forgot password') && (
                <Link to="/forgot-password" className="text-blue-600 hover:underline">Reset it here</Link>
              )}
            </p>
          )}

          <button type="submit" disabled={submitting}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60">
            {submitting ? 'Submitting…' : invite?.existing_account ? 'Accept invitation' : 'Create my account'}
          </button>
        </form>
      </div>
    </div>
  )
}
