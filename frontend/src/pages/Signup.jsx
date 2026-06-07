import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || '/api'

export default function Signup() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    association_name: '', address: '', admin_name: '', email: '', password: '',
    ho6_coverage_a_min: '', ho6_coverage_e_min: '', ho6_wind_required: false, ho6_additional_interest_required: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(key) {
    return e => setForm(f => ({ ...f, [key]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/onboard/association`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          ho6_coverage_a_min: form.ho6_coverage_a_min ? Number(form.ho6_coverage_a_min) : null,
          ho6_coverage_e_min: form.ho6_coverage_e_min ? Number(form.ho6_coverage_e_min) : null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Signup failed')
      }
      navigate('/login?welcome=1')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-md">
        <a href="/" className="text-sm text-blue-600 hover:underline mb-6 block">← Back</a>
        <h1 className="text-2xl font-bold text-blue-800 mb-1">Set up your association</h1>
        <p className="text-sm text-slate-500 mb-6">Create your LapseGuard account</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { label: 'Association Name', key: 'association_name', placeholder: 'Sunset Villas Condo Association' },
            { label: 'Address', key: 'address', placeholder: '123 Palm Ave, Miami, FL 33101' },
            { label: 'Your Name', key: 'admin_name', placeholder: 'Jane Smith' },
            { label: 'Email', key: 'email', placeholder: 'jane@example.com', type: 'email' },
            { label: 'Password', key: 'password', placeholder: '••••••••', type: 'password' },
          ].map(({ label, key, placeholder, type }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
              <input
                type={type || 'text'}
                required
                value={form[key]}
                onChange={set(key)}
                placeholder={placeholder}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}

          <div className="pt-2 border-t border-slate-200">
            <p className="text-sm font-semibold text-slate-700 mb-1">HO-6 Policy Requirements</p>
            <p className="text-xs text-slate-500 mb-3">
              Set the minimum coverage your association requires unit-owners to carry.
              Leave blank if you don't want to enforce a minimum.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Coverage A (Dwelling) min</label>
                <input
                  type="number" min="0" step="1000"
                  value={form.ho6_coverage_a_min}
                  onChange={set('ho6_coverage_a_min')}
                  placeholder="50000"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Coverage E (Liability) min</label>
                <input
                  type="number" min="0" step="1000"
                  value={form.ho6_coverage_e_min}
                  onChange={set('ho6_coverage_e_min')}
                  placeholder="300000"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 mt-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.ho6_wind_required}
                onChange={e => setForm(f => ({ ...f, ho6_wind_required: e.target.checked }))}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Require wind coverage (HO6 with wind, or HO6 + separate wind-only policy)
            </label>

            <label className="flex items-center gap-2 mt-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.ho6_additional_interest_required}
                onChange={e => setForm(f => ({ ...f, ho6_additional_interest_required: e.target.checked }))}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Require association to be listed as additional interest on the policy
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60">
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-4">
          Already have an account?{' '}
          <a href="/login" className="text-blue-600 hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}
