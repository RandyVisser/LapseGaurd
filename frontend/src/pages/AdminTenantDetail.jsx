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

const STATUS_PRIORITY = { active: 0, expiring: 1, pending_review: 2, lapsed: 3, missing: 4 }

function coverageLabel(coverageType) {
  switch (coverageType) {
    case 'ho6_with_wind': return 'HO6 Policy (Wind Included)'
    case 'ho6_wind_excluded': return 'HO6 Policy (Wind Excluded)'
    case 'wind_only': return 'Wind-Only Policy'
    default: return 'Current Policy'
  }
}

const REVIEW_CHECKS = [
  { key: 'named_insured_match', label: 'Named Insured matches Unit' },
  { key: 'property_address_match', label: 'Property Address matches' },
  { key: 'coverage_a_min', label: 'Coverage A min' },
  { key: 'coverage_e_min', label: 'Coverage E (Liability) min' },
  { key: 'wind_coverage', label: 'Wind Coverage' },
  { key: 'association_additional_interest', label: 'Association Listed as Additional Interest' },
]

function ReviewChecklist({ policy, onSetReview, savingKey }) {
  const overrides = policy.review_overrides || {}
  return (
    <div className="mt-5 pt-5 border-t border-slate-100">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Manual Review</p>
      <div className="space-y-2">
        {REVIEW_CHECKS.map(({ key, label }) => {
          const current = overrides[key]?.value
          const saving = savingKey === `${policy.id}:${key}`
          return (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">{label}</span>
              <div className="flex items-center gap-1.5">
                {[
                  { value: 'pass', label: 'Pass', active: 'bg-green-600 text-white', idle: 'bg-green-50 text-green-700 hover:bg-green-100' },
                  { value: 'fail', label: 'Fail', active: 'bg-red-600 text-white', idle: 'bg-red-50 text-red-700 hover:bg-red-100' },
                  { value: 'override', label: 'Override', active: 'bg-amber-600 text-white', idle: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
                ].map(btn => (
                  <button
                    key={btn.value}
                    type="button"
                    disabled={saving}
                    onClick={() => onSetReview(policy.id, key, btn.value)}
                    className={`text-xs font-medium px-2.5 py-1 rounded-md disabled:opacity-50 ${current === btn.value ? btn.active : btn.idle}`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PolicyCard({ policy, onApprove, approving, onSetReview, savingKey, onRunAi, runningAiId }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-700">{coverageLabel(policy.coverage_type)}</h2>
        <StatusBadge status={policy.status} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Insurer" value={policy.insurer} />
        <Field label="Policy Number" value={policy.policy_number} />
        <Field label="Expiration Date" value={policy.expiration_date} />
        <Field label="Uploaded" value={new Date(policy.uploaded_at).toLocaleDateString()} />
      </div>

      {policy.document_url && (
        <div className="mt-4 flex items-center gap-4">
          <a
            href={policy.document_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline font-medium"
          >
            View Dec Page →
          </a>
          <button
            type="button"
            onClick={() => onRunAi(policy.id)}
            disabled={runningAiId === policy.id}
            className="text-sm font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
          >
            {runningAiId === policy.id ? 'Running AI…' : 'Run AI on Document'}
          </button>
        </div>
      )}

      {/* Pending review banner + approve action */}
      {policy.status === 'pending_review' && (
        <div className="mt-4 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <div>
            <p className="text-blue-800 font-semibold text-sm">Pending Review</p>
            <p className="text-blue-600 text-xs mt-0.5">Confirm named insured, address, and expiration date match before approving.</p>
          </div>
          <button
            onClick={() => onApprove(policy.id)}
            disabled={approving}
            className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
          >
            {approving ? 'Approving…' : 'Approve'}
          </button>
        </div>
      )}

      {/* AI extracted data + validation */}
      {policy.extracted_data && (() => {
        const v = policy.extracted_data.validation
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
                <Field label="Named Insured" value={policy.extracted_data.named_insured} />
                <Field label="Property Address" value={policy.extracted_data.property_address} />
                <Field label="Effective Date" value={policy.extracted_data.effective_date} />
                <Field label="Expiration Date" value={policy.extracted_data.expiration_date} />
                <Field label="Dwelling Coverage" value={currency(policy.extracted_data.dwelling_coverage)} />
                <Field label="Liability Coverage" value={currency(policy.extracted_data.liability_coverage)} />
                <Field label="Deductible" value={currency(policy.extracted_data.deductible)} />
              </div>
              {policy.parsed_at && (
                <p className="text-xs text-slate-400 mt-3">
                  Parsed {new Date(policy.parsed_at).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )
      })()}

      {policy.document_url && !policy.extracted_data && (
        <p className="mt-4 text-xs text-slate-400 italic">AI parsing in progress…</p>
      )}

      <ReviewChecklist policy={policy} onSetReview={onSetReview} savingKey={savingKey} />
    </div>
  )
}

export default function AdminTenantDetail() {
  const { tenantId } = useParams()
  const navigate = useNavigate()
  const [tenant, setTenant] = useState(null)
  const [error, setError] = useState('')
  const [notifying, setNotifying] = useState(false)
  const [notifySuccess, setNotifySuccess] = useState(false)
  const [approving, setApproving] = useState(false)
  const [savingKey, setSavingKey] = useState(null)
  const [runningAiId, setRunningAiId] = useState(null)

  async function handleRunAi(policyId) {
    setRunningAiId(policyId)
    setError('')
    try {
      const before = tenant.policies.find(p => p.id === policyId)
      const beforeParsedAt = before?.parsed_at
      await apiPost(`/policy/${policyId}/run-ai`, {})

      // Poll for the background parse to complete (parsed_at changes)
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const fresh = await apiGet(`/tenant/${tenantId}`)
        const updated = fresh.policies.find(p => p.id === policyId)
        if (updated && updated.parsed_at !== beforeParsedAt) {
          setTenant(fresh)
          break
        }
        if (i === 19) setTenant(fresh)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setRunningAiId(null)
    }
  }

  async function handleSetReview(policyId, checkKey, value) {
    const savingId = `${policyId}:${checkKey}`
    setSavingKey(savingId)
    setError('')
    try {
      const res = await apiPost(`/policy/${policyId}/review`, { check_key: checkKey, value })
      setTenant(t => ({
        ...t,
        policies: t.policies.map(p => p.id === policyId ? { ...p, review_overrides: res.review_overrides } : p),
      }))
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingKey(null)
    }
  }

  const [showUpload, setShowUpload] = useState(false)
  const [uploadForm, setUploadForm] = useState({ insurer: '', policy_number: '', expiration_date: '' })
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadFileKey, setUploadFileKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadSuccess, setUploadSuccess] = useState('')

  const [windForm, setWindForm] = useState({ insurer: '', policy_number: '', expiration_date: '' })
  const [windFile, setWindFile] = useState(null)
  const [windFileKey, setWindFileKey] = useState(0)
  const [windUploading, setWindUploading] = useState(false)
  const [windError, setWindError] = useState('')
  const [windSuccess, setWindSuccess] = useState('')

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

  async function handleWindUploadSubmit(e) {
    e.preventDefault()
    setWindError(''); setWindSuccess('')

    if (windForm.expiration_date && new Date(windForm.expiration_date) < new Date()) {
      setWindError('Policy is already expired — please upload a current policy.')
      return
    }

    setWindUploading(true)
    try {
      let document_url = null
      if (windFile) {
        const ext = windFile.name.split('.').pop()
        const path = `${tenant.unit_id}/${Date.now()}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('policy-documents')
          .upload(path, windFile, { upsert: true })
        if (uploadErr) throw new Error(uploadErr.message)
        const { data } = supabase.storage.from('policy-documents').getPublicUrl(path)
        document_url = data.publicUrl
      }
      const saved = await apiPost(`/unit/${tenant.unit_id}/policy`, {
        ...windForm,
        expiration_date: windForm.expiration_date || null,
        document_url,
      })
      setTenant(t => ({ ...t, policies: [saved, ...(t.policies || [])] }))
      setWindSuccess('Wind-only dec page uploaded successfully.')
      setWindForm({ insurer: '', policy_number: '', expiration_date: '' })
      setWindFile(null)
      setWindFileKey(k => k + 1)
    } catch (e) {
      setWindError(e.message)
    } finally {
      setWindUploading(false)
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

  const currentPolicies = tenant?.policies?.filter(p => p.is_current) || []
  const historyPolicies = tenant?.policies?.filter(p => !p.is_current) || []
  const headerStatus = currentPolicies.length
    ? currentPolicies.reduce((worst, p) =>
        STATUS_PRIORITY[p.status] > STATUS_PRIORITY[worst] ? p.status : worst,
        currentPolicies[0].status)
    : 'missing'

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
            <div className="flex flex-col sm:flex-row gap-4 items-stretch">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-start justify-between flex-1">
              <div>
                <h1 className="text-xl font-bold text-slate-800">{tenant.name}</h1>
                {!tenant.email?.toLowerCase().endsWith('@condo.insure') && (
                  <p className="text-sm text-slate-500 mt-1">{tenant.email}</p>
                )}
                {!(tenant.street_address || tenant.city || tenant.state || tenant.zip) && (
                  <p className="text-xs text-slate-400 mt-1">Unit {tenant.unit_number}</p>
                )}
                {(tenant.street_address || tenant.city || tenant.state || tenant.zip) && (
                  <p className="text-xs text-slate-400 mt-1">
                    {[
                      tenant.street_address && `${tenant.street_address}${tenant.unit_number ? ` Unit ${tenant.unit_number}` : ''}`,
                      [tenant.city, tenant.state].filter(Boolean).join(', '),
                      tenant.zip,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                {tenant.policies?.length > 0 && <StatusBadge status={headerStatus} />}
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

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-4 text-sm sm:w-72">
              <p className="font-semibold text-slate-700 mb-2">HO-6 Requirements</p>
              <ul className="text-slate-600 space-y-1">
                  <li className="flex items-center justify-between gap-6">
                    <span>Policy In-Force</span>
                    <span className="font-medium text-slate-800">{tenant.ho6_policy_in_force_required ? 'Required' : 'Not Required'}</span>
                  </li>
                  <li className="flex items-center justify-between gap-6">
                    <span>Named Insured Matches</span>
                    <span className="font-medium text-slate-800">{tenant.ho6_named_insured_match_required ? 'Required' : 'Not Required'}</span>
                  </li>
                  <li className="flex items-center justify-between gap-6">
                    <span>Property Address Matches</span>
                    <span className="font-medium text-slate-800">{tenant.ho6_property_address_match_required ? 'Required' : 'Not Required'}</span>
                  </li>
                <li className="flex items-center justify-between gap-6">
                  <span>Coverage A (Dwelling) min</span>
                  <span className="font-medium text-slate-800">
                    {tenant.ho6_coverage_a_min == null ? 'Not Selected' : `$${Number(tenant.ho6_coverage_a_min).toLocaleString()}`}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-6">
                  <span>Coverage E (Liability) min</span>
                  <span className="font-medium text-slate-800">
                    {tenant.ho6_coverage_e_min == null ? 'Not Selected' : `$${Number(tenant.ho6_coverage_e_min).toLocaleString()}`}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-6">
                  <span>Wind Coverage</span>
                  <span className="font-medium text-slate-800">{tenant.ho6_wind_required ? 'Required' : 'Not Required'}</span>
                </li>
                <li className="flex items-center justify-between gap-6">
                  <span>Additional Interest</span>
                  <span className="font-medium text-slate-800">{tenant.ho6_additional_interest_required ? 'Required' : 'Not Required'}</span>
                </li>
              </ul>
            </div>
            </div>

            {/* Current policy/policies */}
            {currentPolicies.length > 0 ? (
              <>
                {tenant.needs_wind_policy && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
                    <p className="font-semibold text-amber-800 text-sm">Wind-Only Policy Needed</p>
                    <p className="text-sm text-amber-700 mt-1">
                      This unit-owner's HO6 policy excludes wind coverage. A separate, active
                      wind-only policy is required for them to be considered compliant —
                      please ask them to upload one.
                    </p>
                  </div>
                )}
                {tenant.needs_wind_policy ? (
                  <div className="grid sm:grid-cols-2 gap-4 items-start">
                    {currentPolicies.map(p => (
                      <PolicyCard key={p.id} policy={p} onApprove={handleApprove} approving={approving} onSetReview={handleSetReview} savingKey={savingKey} onRunAi={handleRunAi} runningAiId={runningAiId} />
                    ))}
                    <div className="bg-white rounded-xl border border-amber-300 shadow-sm p-5">
                      <h2 className="font-semibold text-slate-700">Wind-Only Policy</h2>
                      <p className="text-xs text-slate-400 mt-1 mb-3">
                        Upload the unit-owner's separate wind-only dec page here.
                      </p>
                      <form onSubmit={handleWindUploadSubmit} className="space-y-3">
                        {[
                          { label: 'Insurer', key: 'insurer', placeholder: 'Citizens' },
                          { label: 'Policy Number', key: 'policy_number', placeholder: 'WO-123456' },
                          { label: 'Expiration Date', key: 'expiration_date', type: 'date' },
                        ].map(({ label, key, placeholder, type }) => (
                          <div key={key}>
                            <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                            <input
                              type={type || 'text'}
                              value={windForm[key]}
                              onChange={e => setWindForm(f => ({ ...f, [key]: e.target.value }))}
                              placeholder={placeholder}
                              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        ))}
                        <div>
                          <label className="block text-sm font-medium text-slate-600 mb-1">Dec Page (PDF or image)</label>
                          <input
                            key={windFileKey}
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg"
                            onChange={e => setWindFile(e.target.files[0] || null)}
                            className="w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                          />
                          {windFile && <p className="text-xs text-slate-500 mt-1">{windFile.name}</p>}
                        </div>
                        {windError && <p className="text-sm text-red-600">{windError}</p>}
                        {windSuccess && <p className="text-sm text-green-600">{windSuccess}</p>}
                        <button type="submit" disabled={windUploading}
                          className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
                          {windUploading ? 'Uploading…' : 'Submit Wind-Only Dec Page'}
                        </button>
                      </form>
                    </div>
                  </div>
                ) : (
                  currentPolicies.map(p => (
                    <PolicyCard key={p.id} policy={p} onApprove={handleApprove} approving={approving} onSetReview={handleSetReview} savingKey={savingKey} onRunAi={handleRunAi} runningAiId={runningAiId} />
                  ))
                )}
              </>
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
            {historyPolicies.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-700">Policy History</h2>
                </div>
                <ul className="divide-y divide-slate-100">
                  {historyPolicies.map(p => (
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
