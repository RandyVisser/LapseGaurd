import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import StatusBadge from '../components/StatusBadge'
import { apiGet, apiPost, supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'

const QUOTE_FORM_URL = import.meta.env.VITE_QUOTE_FORM_URL || ''

export default function TenantDashboard() {
  const { unitId, hoaId, user } = useAuth()
  const [tab, setTab] = useState('policy')
  const [policy, setPolicy] = useState(null)
  const [policyLoading, setPolicyLoading] = useState(true)
  const [docs, setDocs] = useState([])
  const [form, setForm] = useState({ insurer: '', policy_number: '', expiration_date: '' })
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!unitId) return
    apiGet(`/unit/${unitId}/policy`)
      .then(setPolicy)
      .catch(e => setError(e.message))
      .finally(() => setPolicyLoading(false))
    apiGet(`/unit/${unitId}/documents`).then(setDocs).catch(() => {})
  }, [unitId])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setSuccess('')

    // Catch expired date before hitting the server
    if (form.expiration_date && new Date(form.expiration_date) < new Date()) {
      setError('Policy is already expired — please upload a current policy.')
      return
    }

    setUploading(true)
    try {
      let document_url = null
      if (file) {
        const ext = file.name.split('.').pop()
        const path = `${unitId}/${Date.now()}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('policy-documents')
          .upload(path, file, { upsert: true })
        if (uploadErr) throw new Error(uploadErr.message)
        const { data } = supabase.storage.from('policy-documents').getPublicUrl(path)
        document_url = data.publicUrl
      }
      const saved = await apiPost(`/unit/${unitId}/policy`, {
        ...form,
        expiration_date: form.expiration_date || null,
        document_url,
      })
      setPolicy(saved)
      setSuccess('Policy uploaded successfully.')
      setForm({ insurer: '', policy_number: '', expiration_date: '' })
      setFile(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const needsQuote = !policy || policy.status === 'lapsed' || policy.status === 'missing'
  const quoteUrl = (() => {
    const params = new URLSearchParams({
      tenant_name: user?.user_metadata?.name || user?.email || '',
      unit: unitId || '',
      hoa: hoaId || '',
    })
    return `${QUOTE_FORM_URL}?${params}`
  })()

  if (!unitId) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
      Loading your profile…
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="tenant" />
      <main className="max-w-2xl mx-auto px-4 py-8">

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1 w-fit">
          {[['policy', 'My Policy'], ['documents', 'Building Documents']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'policy' && (
          <div className="space-y-6">
            {policyLoading ? (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-20 animate-pulse" />
            ) : policy ? (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Current status</p>
                  <div className="mt-1"><StatusBadge status={policy.status} /></div>
                  {policy.expiration_date && (
                    <p className="text-xs text-slate-500 mt-2">Expires {policy.expiration_date}</p>
                  )}
                  {policy.insurer && (
                    <p className="text-xs text-slate-500 mt-1">{policy.insurer} — {policy.policy_number}</p>
                  )}
                  {policy.document_url && (
                    <a href={policy.document_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline mt-1 block">
                      View dec page
                    </a>
                  )}
                </div>
                {needsQuote && (
                  <a href={quoteUrl} target="_blank" rel="noopener noreferrer"
                    className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">
                    Get a Quote
                  </a>
                )}
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-red-700">No policy on file</p>
                  <p className="text-sm text-red-600 mt-1">Your condo association requires proof of insurance.</p>
                </div>
                <a href={quoteUrl} target="_blank" rel="noopener noreferrer"
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">
                  Get a Quote
                </a>
              </div>
            )}


            {/* AI validation warnings */}
            {policy?.extracted_data?.validation?.passed === false && (
              <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4">
                <p className="font-semibold text-yellow-800 text-sm mb-2">Action Required — Issues found with your uploaded policy</p>
                <ul className="space-y-1">
                  {policy.extracted_data.validation.flags.map((f, i) => (
                    <li key={i} className="text-sm text-yellow-700 flex gap-2">
                      <span>•</span><span>{f}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-yellow-600 mt-2">Please upload a corrected policy using the form below.</p>
              </div>
            )}

            {QUOTE_FORM_URL && (
              <a
                href={`${QUOTE_FORM_URL}?tenant_name=${encodeURIComponent(user?.email || '')}&unit=${encodeURIComponent('')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 hover:bg-blue-100 transition-colors"
              >
                <div>
                  <p className="font-semibold text-blue-800 text-sm">Need a new or updated policy?</p>
                  <p className="text-blue-600 text-xs mt-0.5">Get a free quote in minutes</p>
                </div>
                <span className="text-blue-700 font-semibold text-sm">Request a Quote →</span>
              </a>
            )}

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h2 className="font-semibold text-slate-700 mb-4">
                {policy ? 'Update Policy' : 'Upload Proof of Insurance'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-3">
                {[
                  { label: 'Insurer', key: 'insurer', placeholder: 'State Farm' },
                  { label: 'Policy Number', key: 'policy_number', placeholder: 'HO-123456' },
                  { label: 'Expiration Date', key: 'expiration_date', type: 'date' },
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
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Dec Page (PDF or image)</label>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={e => setFile(e.target.files[0] || null)}
                    className="w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                  {file && <p className="text-xs text-slate-500 mt-1">{file.name}</p>}
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                {success && <p className="text-sm text-green-600">{success}</p>}
                <button type="submit" disabled={uploading}
                  className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
                  {uploading ? 'Uploading…' : 'Submit Policy'}
                </button>
              </form>
            </div>
          </div>
        )}

        {tab === 'documents' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {docs.length === 0 ? (
              <p className="px-6 py-10 text-center text-slate-400 italic text-sm">No documents posted yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {docs.map(d => (
                  <li key={d.id} className="px-5 py-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{d.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{new Date(d.created_at).toLocaleDateString()}</p>
                    </div>
                    <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline font-medium">
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

      </main>
    </div>
  )
}
