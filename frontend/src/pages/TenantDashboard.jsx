import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import StatusBadge from '../components/StatusBadge'
import { apiGet, apiPost, supabase } from '../supabase'

const UNIT_ID = import.meta.env.VITE_TENANT_UNIT_ID || '00000000-0000-0000-0000-000000000010'
const QUOTE_FORM_URL = import.meta.env.VITE_QUOTE_FORM_URL || 'https://form.typeform.com/to/placeholder'

export default function TenantDashboard() {
  const [policy, setPolicy] = useState(null)
  const [docs, setDocs] = useState([])
  const [user, setUser] = useState(null)
  const [form, setForm] = useState({ insurer: '', policy_number: '', expiration_date: '', document_url: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user))
    apiGet(`/unit/${UNIT_ID}/documents`).then(setDocs).catch(() => {})
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setSuccess('')
    try {
      const saved = await apiPost(`/unit/${UNIT_ID}/policy`, {
        ...form,
        expiration_date: form.expiration_date || null,
      })
      setPolicy(saved)
      setSuccess('Policy uploaded successfully.')
      setForm({ insurer: '', policy_number: '', expiration_date: '', document_url: '' })
    } catch (e) {
      setError(e.message)
    }
  }

  const needsQuote = policy && (policy.status === 'lapsed' || policy.status === 'missing')
  const quoteUrl = (() => {
    const params = new URLSearchParams({
      tenant_name: user?.user_metadata?.name || user?.email || '',
      unit: UNIT_ID,
      hoa: import.meta.env.VITE_HOA_ID || '',
    })
    return `${QUOTE_FORM_URL}?${params}`
  })()

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="tenant" />
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <h1 className="text-xl font-bold text-slate-800">My Insurance Policy</h1>

        {policy && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Current status</p>
              <div className="mt-1"><StatusBadge status={policy.status} /></div>
              {policy.expiration_date && (
                <p className="text-xs text-slate-500 mt-2">Expires {policy.expiration_date}</p>
              )}
            </div>
            {needsQuote && (
              <a
                href={quoteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg text-sm"
              >
                Get a Quote
              </a>
            )}
          </div>
        )}

        {!policy && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="font-semibold text-red-700">No policy on file</p>
              <p className="text-sm text-red-600 mt-1">Your HOA requires proof of insurance.</p>
            </div>
            <a
              href={quoteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg text-sm"
            >
              Get a Quote
            </a>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="font-semibold text-slate-700 mb-4">Upload Proof of Insurance</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            {[
              { label: 'Insurer', key: 'insurer', placeholder: 'State Farm' },
              { label: 'Policy Number', key: 'policy_number', placeholder: 'HO-123456' },
              { label: 'Expiration Date', key: 'expiration_date', type: 'date' },
              { label: 'Document URL (Supabase Storage)', key: 'document_url', placeholder: 'https://...' },
            ].map(({ label, key, placeholder, type }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                <input
                  type={type || 'text'}
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}
            <button
              type="submit"
              className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Submit Policy
            </button>
          </form>
        </div>

        {docs.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200">
              <h2 className="font-semibold text-slate-700">HOA Shared Documents</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {docs.map(d => (
                <li key={d.id} className="px-4 py-3 flex items-center justify-between text-sm">
                  <span className="text-slate-700">{d.name}</span>
                  <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">
                    View
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  )
}
