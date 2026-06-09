import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import { apiGet, apiPut } from '../supabase'
import { useAuth } from '../context/AuthContext'

export default function AdminSettings() {
  const { hoaId } = useAuth()
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!hoaId || hoaId === '__all__') return
    apiGet('/hoas')
      .then(hoas => {
        const hoa = hoas.find(h => h.id === hoaId) || hoas[0]
        if (hoa) setForm({
          name: hoa.name || '',
          alert_lead_days: hoa.alert_lead_days ?? 30,
          ho6_coverage_a_min: hoa.ho6_coverage_a_min ?? '',
          ho6_coverage_e_min: hoa.ho6_coverage_e_min ?? '',
          ho6_wind_required: hoa.ho6_wind_required ?? false,
          ho6_additional_interest_required: hoa.ho6_additional_interest_required ?? false,
          ho6_policy_in_force_required: hoa.ho6_policy_in_force_required ?? true,
          ho6_named_insured_match_required: hoa.ho6_named_insured_match_required ?? true,
          ho6_property_address_match_required: hoa.ho6_property_address_match_required ?? true,
        })
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [hoaId])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      await apiPut(`/hoa/${hoaId}`, {
        ...form,
        alert_lead_days: Number(form.alert_lead_days) || 30,
        ho6_coverage_a_min: form.ho6_coverage_a_min !== '' ? Number(form.ho6_coverage_a_min) : null,
        ho6_coverage_e_min: form.ho6_coverage_e_min !== '' ? Number(form.ho6_coverage_e_min) : null,
      })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      <main className="max-w-xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-slate-800 mb-6">Association Settings</h1>

        {loading && <div className="bg-white rounded-xl border border-slate-200 h-40 animate-pulse" />}

        {!loading && form && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
              <p className="font-semibold text-slate-700">Association Info</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Association Name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
              <p className="font-semibold text-slate-700">Alert Settings</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Send renewal alerts how many days before expiration?
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min="7" max="180" step="1"
                    value={form.alert_lead_days}
                    onChange={e => setForm(f => ({ ...f, alert_lead_days: e.target.value }))}
                    className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-500">days</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">Default is 30. Tenants receive one email per 7-day window.</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
              <p className="font-semibold text-slate-700">HO-6 Policy Requirements</p>
              <p className="text-xs text-slate-500">
                Changes apply immediately to all future compliance evaluations.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Coverage A (Dwelling) min</label>
                  <input
                    type="number" min="0" step="1000"
                    value={form.ho6_coverage_a_min}
                    onChange={e => setForm(f => ({ ...f, ho6_coverage_a_min: e.target.value }))}
                    placeholder="e.g. 50000"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Coverage E (Liability) min</label>
                  <input
                    type="number" min="0" step="1000"
                    value={form.ho6_coverage_e_min}
                    onChange={e => setForm(f => ({ ...f, ho6_coverage_e_min: e.target.value }))}
                    placeholder="e.g. 300000"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {[
                { key: 'ho6_policy_in_force_required', label: 'Require an in-force policy on file' },
                { key: 'ho6_named_insured_match_required', label: 'Require named insured to match unit-owner' },
                { key: 'ho6_property_address_match_required', label: 'Require property address to match unit' },
                { key: 'ho6_wind_required', label: 'Require wind coverage (HO6 with wind, or HO6 + separate wind-only policy)' },
                { key: 'ho6_additional_interest_required', label: 'Require association to be listed as additional interest' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  {label}
                </label>
              ))}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-green-600">Settings saved.</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}
