import { useEffect, useRef, useState } from 'react'
import Nav from '../components/Nav'
import StatusBadge from '../components/StatusBadge'
import { apiGet, apiPost, supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'

const QUOTE_FORM_URL = import.meta.env.VITE_QUOTE_FORM_URL || ''

export default function TenantDashboard() {
  const { unitId, hoaId, user, profileError, tenantUnits, selectUnit } = useAuth()
  const [tab, setTab] = useState('policy')
  const [policy, setPolicy] = useState(null)
  const [allPolicies, setAllPolicies] = useState([])
  const [policyLoading, setPolicyLoading] = useState(true)
  const [docs, setDocs] = useState([])
  const [form, setForm] = useState({ insurer: '', policy_number: '', expiration_date: '' })
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const pollRef = useRef(null)

  useEffect(() => {
    if (!unitId) return
    setPolicyLoading(true)
    setPolicy(null)
    setError(''); setSuccess('')
    Promise.all([
      apiGet(`/unit/${unitId}/policy`),
      apiGet(`/tenant/me/policies?unit_id=${unitId}`),
    ])
      .then(([current, all]) => {
        setPolicy(current)
        setAllPolicies(all || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setPolicyLoading(false))
    apiGet(`/unit/${unitId}/documents`).then(setDocs).catch(() => {})
  }, [unitId])

  // Clean up polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  function startParsingPoll(policyId) {
    setParsing(true)
    let attempts = 0
    pollRef.current = setInterval(async () => {
      attempts++
      try {
        const current = await apiGet(`/unit/${unitId}/policy`)
        if (current && (current.parsed_at || attempts >= 15)) {
          clearInterval(pollRef.current)
          pollRef.current = null
          setParsing(false)
          setPolicy(current)
          setAllPolicies(prev => [current, ...prev.filter(p => p.id !== current.id)])
        }
      } catch {
        clearInterval(pollRef.current)
        pollRef.current = null
        setParsing(false)
      }
    }, 2000)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setSuccess('')

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
      setAllPolicies(prev => [saved, ...prev.filter(p => p.id !== saved.id)])
      setSuccess(file ? 'Policy uploaded — analyzing your document…' : 'Policy saved.')
      setForm({ insurer: '', policy_number: '', expiration_date: '' })
      setFile(null)
      setFileInputKey(k => k + 1)
      if (file) startParsingPoll(saved.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  function handleFileDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) setFile(dropped)
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      {profileError ? (
        <div className="text-center max-w-sm">
          <p className="text-slate-700 font-medium mb-1">Couldn't load your profile</p>
          <p className="text-sm text-slate-500">{profileError}</p>
          <p className="text-xs text-slate-400 mt-3">Contact your association manager if this persists.</p>
        </div>
      ) : (
        <p className="text-slate-400 text-sm">Loading your profile…</p>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="tenant" />
      <main className="max-w-2xl mx-auto px-4 py-8">

        {/* Unit switcher — only for owners with multiple units */}
        {tenantUnits.length > 1 && (
          <div className="mb-5">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">My units</p>
            <div className="flex gap-2 flex-wrap">
              {tenantUnits.map(u => {
                const active = u.unit_id === unitId
                return (
                  <button
                    key={u.unit_id}
                    onClick={() => selectUnit(u.unit_id)}
                    className={`text-left px-3.5 py-2 rounded-xl border transition-colors ${
                      active
                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300'
                    }`}
                  >
                    <span className="block text-sm font-semibold">Unit {u.unit_number || '—'}</span>
                    {u.hoa_name && (
                      <span className={`block text-xs ${active ? 'text-blue-100' : 'text-slate-400'}`}>{u.hoa_name}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

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
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500">Current status</p>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusBadge status={policy.status} />
                    {parsing && (
                      <span className="text-xs text-blue-600 animate-pulse">Analyzing document…</span>
                    )}
                  </div>
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
                {needsQuote && QUOTE_FORM_URL && (
                  <a href={quoteUrl} target="_blank" rel="noopener noreferrer"
                    className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">
                    Get a Quote
                  </a>
                )}
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-red-700">No policy on file</p>
                  <p className="text-sm text-red-600 mt-1">Your condo association requires proof of insurance.</p>
                </div>
                {QUOTE_FORM_URL && (
                  <a href={quoteUrl} target="_blank" rel="noopener noreferrer"
                    className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">
                    Get a Quote
                  </a>
                )}
              </div>
            )}

            {/* AI parsing result */}
            {policy?.parsed_at && policy?.extracted_data?.validation && (
              policy.extracted_data.validation.passed === false ? (
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
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                  <span className="text-green-600 text-lg">✓</span>
                  <p className="text-sm text-green-800 font-medium">Your policy was reviewed and meets all requirements.</p>
                </div>
              )
            )}

            {parsing && !policy?.parsed_at && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
                <svg className="animate-spin h-4 w-4 text-blue-600 shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <p className="text-sm text-blue-800">Your document is being analyzed. This usually takes under 30 seconds.</p>
              </div>
            )}

            {QUOTE_FORM_URL && !needsQuote && (
              <a
                href={quoteUrl}
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

                {/* Drag-and-drop upload zone */}
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Dec Page (PDF or image)</label>
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    onClick={() => document.getElementById('file-input-hidden').click()}
                    className={`relative border-2 border-dashed rounded-xl px-4 py-6 text-center cursor-pointer transition-colors ${
                      dragOver
                        ? 'border-blue-400 bg-blue-50'
                        : file
                        ? 'border-green-400 bg-green-50'
                        : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                    }`}
                  >
                    {file ? (
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-green-600 text-lg">✓</span>
                        <span className="text-sm text-green-700 font-medium">{file.name}</span>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setFile(null); setFileInputKey(k => k + 1) }}
                          className="text-xs text-slate-400 hover:text-slate-600 ml-1"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm text-slate-500 hidden sm:block">
                          {dragOver ? 'Drop to upload' : 'Drag & drop your dec page here'}
                        </p>
                        <p className="text-xs text-slate-400 mt-1 hidden sm:block">or click to browse · PDF, PNG, JPG</p>
                        <p className="text-sm text-slate-500 sm:hidden">Tap to take a photo or choose a file</p>
                        <p className="text-xs text-slate-400 mt-1 sm:hidden">PDF, PNG, JPG</p>
                      </div>
                    )}
                    <input
                      id="file-input-hidden"
                      key={fileInputKey}
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={e => setFile(e.target.files[0] || null)}
                      className="hidden"
                    />
                  </div>
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

        {tab === 'policy' && allPolicies.length > 1 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-6">
            <div className="px-5 py-3 border-b border-slate-100">
              <h2 className="font-semibold text-slate-700 text-sm">Previous Submissions</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {allPolicies.slice(1).map(p => (
                <li key={p.id} className="px-5 py-3 flex items-center justify-between text-sm">
                  <div>
                    <span className="text-slate-700">{p.insurer || 'Unknown insurer'}</span>
                    {p.policy_number && <span className="text-slate-400 ml-2">#{p.policy_number}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">
                      {p.expiration_date ? `Exp ${p.expiration_date}` : 'No expiration'}
                    </span>
                    <StatusBadge status={p.status} />
                    {p.document_url && (
                      <a href={p.document_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline">View</a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
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
