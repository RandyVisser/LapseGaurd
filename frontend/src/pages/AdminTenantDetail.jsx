import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import StatusBadge from '../components/StatusBadge'
import { apiGet, apiPost, supabase } from '../supabase'

function Field({ label, value }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-slate-700 mt-0.5">{value}</p>
    </div>
  )
}

function currency(val) {
  if (val == null) return null
  return `$${Number(val).toLocaleString()}`
}

export default function AdminTenantDetail() {
  const { tenantId } = useParams()
  const navigate = useNavigate()
  const [tenant, setTenant] = useState(null)
  const [error, setError] = useState('')
  const [notifying, setNotifying] = useState(false)
  const [notifySuccess, setNotifySuccess] = useState(false)
  const [approving, setApproving] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadForm, setUploadForm] = useState({ insurer: '', policy_number: '', expiration_date: '' })
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadFileKey, setUploadFileKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadSuccess, setUploadSuccess] = useState('')

  async function handleUploadSubmit(e) {
    e.preventDefault()
    setUploadError(''); setUploadSuccess('')

    if (uploadForm.expiration_date && new Date(uploadForm.expiration_date) < new Date()) {
      setUploadError('Policy is already expired — please upload a current policy.')
      return
    }

    setUploading(true)
    try {
      let document_url = null
      if (uploadFile) {
        const ext = uploadFile.name.split('.').pop()
        const path = `${tenant.unit_id}/${Date.now()}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('policy-documents')
          .upload(path, uploadFile, { upsert: true })
        if (uploadErr) throw new Error(uploadErr.message)
        const { data } = supabase.storage.from('policy-documents').getPublicUrl(path)
        document_url = data.publicUrl
      }
      const saved = await apiPost(`/unit/${tenant.unit_id}/policy`, {
        ...uploadForm,
        expiration_date: uploadForm.expiration_date || null,
        document_url,
      })
      setTenant(t => ({ ...t, policies: [saved, ...(t.policies || [])] }))
      setUploadSuccess('Dec page uploaded successfully.')
      setUploadForm({ insurer: '', policy_number: '', expiration_date: '' })
      setUploadFile(null)
      setUploadFileKey(k => k + 1)
    } catch (e) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleApprove(policyId) {
    setApproving(true)
    setError('')
    try {
      const updated = await apiPost(`/policy/${policyId}/approve`, {})
      setTenant(t => ({
        ...t,
        policies: t.policies.map(p => p.id === updated.id ? { ...p, status: updated.status } : p),
      }))
    } catch (e) {
      setError(e.message)
    } finally {
      setApproving(false)
    }
  }

  async function handleNotify() {
    setNotifying(true)
    setNotifySuccess(false)
    try {
      await apiPost(`/tenant/${tenantId}/notify`, {})
      setNotifySuccess(true)
      setTimeout(() => setNotifySuccess(false), 4000)
    } catch (e) {
      setError(e.message)
    } finally {
      setNotifying(false)
    }
  }

  useEffect(() => {
    apiGet(`/tenant/${tenantId}`)
      .then(setTenant)
      .catch(e => setError(e.message))
  }, [tenantId])

  const latest = tenant?.policies?.[0] || null

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      <main className="max-w-3xl mx-auto px-4 py-8">

        <button
          onClick={() => navigate('/admin/dashboard')}
          className="text-sm text-blue-600 hover:underline mb-6 flex items-center gap-1"
        >
          ← Back to dashboard
        </button>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {tenant && (
          <div className="space-y-6">

            {/* Header */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-800">{tenant.name}</h1>
                <p className="text-sm text-slate-500 mt-1">{tenant.email}</p>
                <p className="text-xs text-slate-400 mt-1">Unit {tenant.unit_number}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {latest && <StatusBadge status={latest.status} />}
                {notifySuccess ? (
                  <span className="text-xs text-green-600 font-medium">Email sent ✓</span>
                ) : (
                  <button
                    onClick={handleNotify}
                    disabled={notifying}
                    className="text-xs bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg disabled:opacity-60"
                  >
                    {notifying ? 'Sending…' : 'Notify Unit-Owner'}
                  </button>
                )}
              </div>
            </div>

            {/* Current policy */}
            {latest ? (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h2 className="font-semibold text-slate-700 mb-4">Current Policy</h2>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Insurer" value={latest.insurer} />
                  <Field label="Policy Number" value={latest.policy_number} />
                  <Field label="Expiration Date" value={latest.expiration_date} />
                  <Field label="Uploaded" value={new Date(latest.uploaded_at).toLocaleDateString()} />
                </div>

                {latest.document_url && (
                  <a
                    href={latest.document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-4 text-sm text-blue-600 hover:underline font-medium"
                  >
                    View Dec Page →
                  </a>
                )}

                {/* Pending review banner + approve action */}
                {latest.status === 'pending_review' && (
                  <div className="mt-4 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                    <div>
                      <p className="text-blue-800 font-semibold text-sm">Pending Review</p>
                      <p className="text-blue-600 text-xs mt-0.5">Confirm named insured, address, and expiration date match before approving.</p>
                    </div>
                    <button
                      onClick={() => handleApprove(latest.id)}
                      disabled={approving}
                      className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
                    >
                      {approving ? 'Approving…' : 'Approve'}
                    </button>
                  </div>
                )}

                {/* AI extracted data + validation */}
                {latest.extracted_data && (() => {
                  const v = latest.extracted_data.validation
                  return (
                    <div className="mt-5 pt-5 border-t border-slate-100 space-y-4">

                      {/* Validation banner */}
                      {v && (
                        v.passed ? (
                          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
                            <span className="text-green-600 font-semibold text-sm">✓ Verified</span>
                            <span className="text-green-700 text-sm">Policy matches submitted details and is current.</span>
                          </div>
                        ) : (
                          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                            <p className="text-red-700 font-semibold text-sm mb-1">Issues Found</p>
                            <ul className="space-y-1">
                              {v.flags.map((f, i) => (
                                <li key={i} className="text-sm text-red-600 flex gap-2">
                                  <span>•</span><span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      )}

                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                          AI Extracted Details
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          <Field label="Named Insured" value={latest.extracted_data.named_insured} />
                          <Field label="Property Address" value={latest.extracted_data.property_address} />
                          <Field label="Effective Date" value={latest.extracted_data.effective_date} />
                          <Field label="Expiration Date" value={latest.extracted_data.expiration_date} />
                          <Field label="Dwelling Coverage" value={currency(latest.extracted_data.dwelling_coverage)} />
                          <Field label="Liability Coverage" value={currency(latest.extracted_data.liability_coverage)} />
                          <Field label="Deductible" value={currency(latest.extracted_data.deductible)} />
                        </div>
                        {latest.parsed_at && (
                          <p className="text-xs text-slate-400 mt-3">
                            Parsed {new Date(latest.parsed_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {latest.document_url && !latest.extracted_data && (
                  <p className="mt-4 text-xs text-slate-400 italic">AI parsing in progress…</p>
                )}
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                <p className="font-semibold text-red-700">No policy on file</p>
                <p className="text-sm text-red-600 mt-1">This unit-owner has not uploaded proof of insurance.</p>
              </div>
            )}

            {/* Admin upload — for dec pages mailed/faxed in by unit-owners without email */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <button
                type="button"
                onClick={() => setShowUpload(s => !s)}
                className="font-semibold text-slate-700 flex items-center gap-2"
              >
                {showUpload ? '▾' : '▸'} Add Dec Page on Behalf of Unit-Owner
              </button>
              <p className="text-xs text-slate-400 mt-1">
                Use this if the unit-owner mailed or faxed in their dec page instead of uploading it themselves.
              </p>
              {showUpload && (
                <form onSubmit={handleUploadSubmit} className="space-y-3 mt-4">
                  {[
                    { label: 'Insurer', key: 'insurer', placeholder: 'State Farm' },
                    { label: 'Policy Number', key: 'policy_number', placeholder: 'HO-123456' },
                    { label: 'Expiration Date', key: 'expiration_date', type: 'date' },
                  ].map(({ label, key, placeholder, type }) => (
                    <div key={key}>
                      <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                      <input
                        type={type || 'text'}
                        value={uploadForm[key]}
                        onChange={e => setUploadForm(f => ({ ...f, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Dec Page (PDF or image)</label>
                    <input
                      key={uploadFileKey}
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={e => setUploadFile(e.target.files[0] || null)}
                      className="w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    {uploadFile && <p className="text-xs text-slate-500 mt-1">{uploadFile.name}</p>}
                  </div>
                  {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
                  {uploadSuccess && <p className="text-sm text-green-600">{uploadSuccess}</p>}
                  <button type="submit" disabled={uploading}
                    className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
                    {uploading ? 'Uploading…' : 'Submit Dec Page'}
                  </button>
                </form>
              )}
            </div>

            {/* Policy history */}
            {tenant.policies.length > 1 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-700">Policy History</h2>
                </div>
                <ul className="divide-y divide-slate-100">
                  {tenant.policies.slice(1).map(p => (
                    <li key={p.id} className="px-5 py-3 flex items-center justify-between text-sm">
                      <div>
                        <span className="text-slate-700">{p.insurer || 'Unknown insurer'}</span>
                        <span className="text-slate-400 ml-2">#{p.policy_number}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">
                          Uploaded {new Date(p.uploaded_at).toLocaleDateString()}
                        </span>
                        <StatusBadge status={p.status} />
                        {p.document_url && (
                          <a href={p.document_url} target="_blank" rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-xs">View</a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </div>
        )}

        {!tenant && !error && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 h-24 animate-pulse" />
            <div className="bg-white rounded-xl border border-slate-200 h-40 animate-pulse" />
          </div>
        )}

      </main>
    </div>
  )
}
