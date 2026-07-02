import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { track } from '../analytics'

const API = import.meta.env.VITE_API_URL || '/api'

export default function Join() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [invite, setInvite] = useState(null)
  const [form, setForm] = useState({ name: '', password: '' })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API}/invite/${token}`)
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

  if (error && !invite) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-sm w-full text-center">
        <img src="/assets/logo-full.svg" alt="condo.insure" className="h-9 mx-auto mb-6" />
        <h1 className="text-lg font-bold text-slate-800 mb-2">Invalid Invite</h1>
        <p className="text-sm text-slate-500">{error}</p>
      </div>
    </div>
  )

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
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="At least 8 characters"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={submitting}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60">
            {submitting ? 'Creating account…' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
