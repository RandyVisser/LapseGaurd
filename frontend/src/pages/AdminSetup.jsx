import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || '/api'

export default function AdminSetup() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [invite, setInvite] = useState(null)
  const [password, setPassword] = useState('')
  const [agreeTos, setAgreeTos] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

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
      const res = await fetch(`${API}/admin-invite/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, agree_tos: agreeTos }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Could not set up your account')
      }
      navigate('/login?welcome=admin')
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
          {invite?.firm_name ? 'Join your team'
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
              ? <><strong>{invite.hoa_name}</strong> will be added to <strong>{invite.existing_firm_name}</strong>'s
                  portfolio — everyone on your team will be able to see and manage it.</>
              : <>Teammates you add to your firm later will also be able to see and manage this association.</>}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Set a Password</label>
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
            {submitting ? 'Setting up…' : 'Create my account'}
          </button>
        </form>
      </div>
    </div>
  )
}
