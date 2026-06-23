import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { track } from '../analytics'

const API = import.meta.env.VITE_API_URL || '/api'

export default function Signup() {
  const [form, setForm] = useState({
    association_name: '', address: '', unit_count: '', has_owner_emails: '',
    admin_name: '', email: '',
    ho6_coverage_a_min: '', ho6_coverage_e_min: '', ho6_wind_required: true, ho6_additional_interest_required: false,
    ho6_policy_in_force_required: true, ho6_named_insured_match_required: true, ho6_property_address_match_required: true,
    certify_authorized: false,
    agree_tos: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  useEffect(() => track('signup_started'), [])

  function set(key) {
    return e => setForm(f => ({ ...f, [key]: e.target.value }))
  }

  function renderField({ label, key, placeholder, type, hint }) {
    return (
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
        {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
      </div>
    )
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
          unit_count: form.unit_count ? Number(form.unit_count) : null,
          has_owner_emails: form.has_owner_emails === 'yes' ? true : form.has_owner_emails === 'no' ? false : null,
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-md text-center">
          <div className="text-4xl mb-4">📬</div>
          <h1 className="text-2xl font-bold text-blue-800 mb-2">Thanks — we're setting up your association</h1>
          <p className="text-slate-600 mb-6">
            We're building out {form.association_name || 'your association'} now. You'll get an
            email at <strong>{form.email}</strong> when your dashboard is ready.
          </p>
          <Link to="/" className="text-blue-600 hover:underline text-sm">← Back to home</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-xl">
        <Link to="/" className="text-sm text-blue-600 hover:underline mb-6 block">← Back</Link>
        <h1 className="text-2xl font-bold text-blue-800 mb-1">Set up your association</h1>
        <p className="text-sm text-slate-500 mb-6">Tell us about your association and we'll build it out and email you when it's ready.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { label: 'Association Name', key: 'association_name', placeholder: 'Sunset Villas Condo Association' },
            { label: 'Address', key: 'address', placeholder: '123 Palm Ave, Miami, FL 33101' },
          ].map(renderField)}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1"># of units in this association</label>
            <input
              type="number"
              min="1"
              required
              value={form.unit_count}
              onChange={set('unit_count')}
              placeholder="e.g. 48"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Do you have email addresses for your unit-owners?</label>
            <div className="flex gap-3 mt-1">
              {['Yes', 'No'].map(opt => {
                const val = opt.toLowerCase()
                const active = form.has_owner_emails === val
                return (
                  <label key={val}
                    className={`flex-1 flex items-center justify-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer ${
                      active ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}>
                    <input
                      type="radio"
                      name="has_owner_emails"
                      value={val}
                      checked={active}
                      onChange={() => setForm(f => ({ ...f, has_owner_emails: val }))}
                      required
                      className="sr-only"
                    />
                    {opt}
                  </label>
                )
              })}
            </div>
          </div>

          {[
            { label: 'Your Name', key: 'admin_name', placeholder: 'Jane Smith' },
            { label: 'Email', key: 'email', placeholder: 'jane@example.com', type: 'email' },
          ].map(renderField)}

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
                checked={form.ho6_policy_in_force_required}
                onChange={e => setForm(f => ({ ...f, ho6_policy_in_force_required: e.target.checked }))}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Require an in-force policy on file
            </label>

            <label className="flex items-center gap-2 mt-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.ho6_named_insured_match_required}
                onChange={e => setForm(f => ({ ...f, ho6_named_insured_match_required: e.target.checked }))}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Require named insured to match unit-owner
            </label>

            <label className="flex items-center gap-2 mt-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.ho6_property_address_match_required}
                onChange={e => setForm(f => ({ ...f, ho6_property_address_match_required: e.target.checked }))}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Require property address to match unit
            </label>

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

          <label className="flex items-start gap-2 text-sm text-slate-600 pt-2 border-t border-slate-200">
            <input
              type="checkbox"
              required
              checked={form.certify_authorized}
              onChange={e => setForm(f => ({ ...f, certify_authorized: e.target.checked }))}
              className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
            />
            <span>I certify that I am authorized by the Association to enroll this Association in condo.insure and to provide access to Association insurance compliance records.</span>
          </label>

          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              required
              checked={form.agree_tos}
              onChange={e => setForm(f => ({ ...f, agree_tos: e.target.checked }))}
              className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
            />
            <span>I have read and agree to the <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Terms of Service</Link>.</span>
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60">
            {loading ? 'Submitting…' : 'Get Started'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
