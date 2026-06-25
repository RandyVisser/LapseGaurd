import { useEffect, useRef, useState } from 'react'
import Nav from '../components/Nav'
import StatusBadge from '../components/StatusBadge'
import { apiGet, apiPost, supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import useIsMobile from '../hooks/useIsMobile'
import { track } from '../analytics'

// Owner-facing quote link (revenue lead). Falls back to the same URL the admin
// page uses so it always shows, even if VITE_QUOTE_FORM_URL isn't set on Railway.
// Quote link points at the agency quote page.
const QUOTE_FORM_URL = 'https://www.universalcondo.com/quote'
// Subrental owner steps — hidden until the rentals feature is switched on.
const RENTALS_ENABLED = import.meta.env.VITE_RENTALS_ENABLED === 'true'

// One unambiguous answer per status — the page leads with this.
const STATUS_HERO = {
  active: {
    icon: '✓', title: "You're covered",
    blurb: 'Your policy is on file and meets your association\'s requirements.',
    card: 'bg-green-50 border-green-200', accent: 'bg-green-600 text-white', text: 'text-green-900', sub: 'text-green-700',
  },
  expiring: {
    icon: '⏳', title: 'Renewal due soon',
    blurb: 'Your policy is active but expires soon — upload your renewal when you have it.',
    card: 'bg-amber-50 border-amber-200', accent: 'bg-amber-500 text-white', text: 'text-amber-900', sub: 'text-amber-700',
  },
  pending_review: {
    icon: '🔍', title: 'Under review',
    blurb: 'We received your document and your association is reviewing it.',
    card: 'bg-blue-50 border-blue-200', accent: 'bg-blue-600 text-white', text: 'text-blue-900', sub: 'text-blue-700',
  },
  non_compliant: {
    icon: '!', title: 'Action needed',
    blurb: 'Your policy is on file but doesn\'t meet a requirement — details below.',
    card: 'bg-orange-50 border-orange-200', accent: 'bg-orange-500 text-white', text: 'text-orange-900', sub: 'text-orange-700',
  },
  lapsed: {
    icon: '!', title: 'Policy expired',
    blurb: 'Your association requires active insurance — upload your current policy below.',
    card: 'bg-red-50 border-red-200', accent: 'bg-red-600 text-white', text: 'text-red-900', sub: 'text-red-700',
  },
  missing: {
    icon: '!', title: 'No policy on file',
    blurb: 'Your association requires proof of insurance — upload your declaration page in the YELLOW box below.',
    card: 'bg-red-50 border-red-200', accent: 'bg-red-600 text-white', text: 'text-red-900', sub: 'text-red-700',
  },
}

function fmtDate(d) {
  if (!d) return null
  return new Date(String(d).slice(0, 10) + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Shown to the OWNER of a unit the association has flagged as a rental: upload
// the lease (AI pulls the renter name) then invite the renter to add their HO-4.
function RentalOwnerSection({ unitId, hasLease }) {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [leaseDone, setLeaseDone] = useState(!!hasLease)
  const [renterName, setRenterName] = useState('')
  const [renterEmail, setRenterEmail] = useState('')
  const [invited, setInvited] = useState(false)
  const [err, setErr] = useState('')

  async function uploadLease(e) {
    e.preventDefault()
    if (!file) { setErr('Attach the signed lease to upload.'); return }
    setBusy(true); setErr('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${unitId}/lease-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('policy-documents').upload(path, file, { upsert: false })
      if (upErr) throw new Error(upErr.message)
      const { data } = supabase.storage.from('policy-documents').getPublicUrl(path)
      const res = await apiPost(`/unit/${unitId}/lease`, { document_url: data.publicUrl })
      setResult(res); setLeaseDone(true)
      if (res.renter_names?.[0]) setRenterName(res.renter_names[0])
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function sendInvite(e) {
    e.preventDefault()
    if (!renterEmail) { setErr('Enter the renter’s email.'); return }
    setBusy(true); setErr('')
    try {
      await apiPost(`/unit/${unitId}/rental/invite`, { email: renterEmail, name: renterName || null })
      setInvited(true)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <section className="bg-white rounded-2xl border border-indigo-200 shadow-sm p-6 mb-5">
      <h2 className="font-bold text-slate-800 mb-1">Rental — action needed</h2>
      <p className="text-sm text-slate-500 mb-4">
        Your association flagged this unit as a rental. Upload the lease, then invite your renter so they can add their HO-4 policy.
      </p>

      <div className="mb-5">
        <p className="text-sm font-semibold text-slate-700 mb-2">1. Upload the signed lease</p>
        {leaseDone ? (
          <p className="text-sm text-green-700">
            ✓ Lease on file{result?.renter_names?.length ? ` — renter: ${result.renter_names.join(', ')}` : ''}
          </p>
        ) : (
          <form onSubmit={uploadLease} className="flex flex-wrap items-center gap-2">
            <input type="file" accept=".pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm" />
            <button disabled={busy} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60">
              {busy ? 'Reading…' : 'Upload lease'}
            </button>
          </form>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-700 mb-2">2. Invite your renter</p>
        {invited ? (
          <p className="text-sm text-green-700">✓ Invite sent to {renterEmail}.</p>
        ) : (
          <form onSubmit={sendInvite} className="space-y-2 max-w-sm">
            <input value={renterName} onChange={e => setRenterName(e.target.value)} placeholder="Renter name"
                   className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input type="email" value={renterEmail} onChange={e => setRenterEmail(e.target.value)} placeholder="Renter email"
                   className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button disabled={busy} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60">
              {busy ? 'Sending…' : 'Send invite'}
            </button>
          </form>
        )}
      </div>
      {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
    </section>
  )
}

export default function TenantDashboard() {
  const { unitId, hoaId, user, profileError, tenantUnits, selectUnit } = useAuth()
  const [policy, setPolicy] = useState(null)
  const [allPolicies, setAllPolicies] = useState([])
  const [policyLoading, setPolicyLoading] = useState(true)
  const [form, setForm] = useState({ insurer: '', policy_number: '', expiration_date: '' })
  const [showHistory, setShowHistory] = useState(false)
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const pollRef = useRef(null)
  const isMobile = useIsMobile()
  // Collapses to a corner pill on mobile so it doesn't cover the page
  const [helperExpanded, setHelperExpanded] = useState(false)

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
  }, [unitId])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  function startParsingPoll() {
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

    if (!file) {
      setError('Attach your declaration page to submit.')
      return
    }
    if (form.expiration_date && new Date(form.expiration_date) < new Date()) {
      setError('That policy is already expired — please upload a current one.')
      return
    }

    setUploading(true)
    try {
      let document_url = null
      if (file) {
        const ext = file.name.split('.').pop()
        const path = `${unitId}/${Date.now()}.${ext}`
        // Path is timestamp-unique, so no upsert needed. upsert:true sends
        // x-upsert, which makes Storage require UPDATE permission on top of
        // INSERT — and only an INSERT RLS policy exists, so it 403s ("new row
        // violates row-level security policy") and blocks every owner upload.
        const { error: uploadErr } = await supabase.storage
          .from('policy-documents')
          .upload(path, file, { upsert: false })
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
      setSuccess(file ? 'Got it — reading your document now…' : 'Policy details saved.')
      setForm({ insurer: '', policy_number: '', expiration_date: '' })
      setFile(null)
      setFileInputKey(k => k + 1)
      if (file) { track('owner_upload'); startParsingPoll() }
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

  const status = policy?.status || 'missing'
  const hero = STATUS_HERO[status] || STATUS_HERO.missing
  const flags = policy?.parsed_at && policy?.extracted_data?.validation?.passed === false
    ? (policy.extracted_data.validation.flags || [])
    : []
  const needsQuote = !policy || status === 'lapsed' || status === 'missing' || status === 'non_compliant'
  const quoteUrl = `${QUOTE_FORM_URL}?${new URLSearchParams({
    tenant_name: user?.user_metadata?.name || user?.email || '',
    unit: unitId || '',
    hoa: hoaId || '',
  })}`
  const history = allPolicies.filter(p => p.id !== policy?.id)
  const activeUnit = tenantUnits.find(u => u.unit_id === unitId)

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

  // ── Next-steps helper box ─────────────────────────────────────────────
  const nextSteps = []
  if (!policyLoading) {
    if (parsing) {
      nextSteps.push({ icon: '⏳', text: 'We\'re reading your document — this usually takes 10–20 seconds…', wait: true })
    } else if (!policy || status === 'missing') {
      nextSteps.push({ icon: '📄', text: 'Click the YELLOW box to upload your DEC PAGE.' })
    } else if (status === 'lapsed') {
      nextSteps.push({ icon: '🔄', text: 'Your policy is expired — upload your renewal declaration page below.' })
    } else if (flags.length > 0) {
      flags.forEach(f => nextSteps.push({ icon: '⚠️', text: f }))
    } else if (status === 'non_compliant') {
      nextSteps.push({ icon: '⚠️', text: 'Your policy doesn\'t meet an association requirement — see the details above.' })
    } else {
      nextSteps.push({ icon: '🎉', text: 'You\'re all set! Your policy is on file and meets your association\'s requirements.', success: true })
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="tenant" />
      {nextSteps.length > 0 && (
        isMobile && !helperExpanded ? (
          <button
            onClick={() => setHelperExpanded(true)}
            className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-white text-sm font-semibold ${nextSteps[0]?.success ? 'bg-green-600' : 'bg-blue-600'}`}
          >
            {nextSteps[0]?.success ? '✓ All set' : 'Next Steps'}
            {!nextSteps[0]?.success && (
              <span className="bg-white/25 rounded-full px-1.5 text-xs">{nextSteps.length}</span>
            )}
          </button>
        ) : (
          <div className={`fixed z-50 bg-white shadow-xl overflow-hidden border ${nextSteps[0]?.success ? 'border-green-200' : 'border-blue-200'} ${isMobile ? 'bottom-0 inset-x-0 rounded-t-2xl max-h-[55vh] overflow-y-auto' : 'bottom-6 right-6 w-80 rounded-2xl'}`}>
            <div className={`px-4 py-3 flex items-center justify-between gap-2 ${nextSteps[0]?.success ? 'bg-green-600' : 'bg-blue-600'}`}>
              <span className="text-white font-semibold text-sm">{nextSteps[0]?.success ? '✓ Compliant' : 'Next Steps'}</span>
              {isMobile && (
                <button onClick={() => setHelperExpanded(false)} aria-label="Collapse" className="text-white/90 hover:text-white text-xl leading-none">×</button>
              )}
            </div>
            <ul className="p-4 space-y-3">
              {nextSteps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                  <span className="text-base leading-snug">{s.icon}</span>
                  <span>
                    {!s.success && <span className="font-semibold text-blue-700">{s.wait ? 'Wait: ' : 'Next: '}</span>}
                    {s.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
      <main className="max-w-2xl mx-auto px-4 py-8">

        {/* Unit context */}
        <header className="mb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-800">
                {activeUnit?.unit_number ? `Unit ${activeUnit.unit_number}` : 'My Policy'}
              </h1>
              {activeUnit?.street_address && (
                <p className="text-sm text-slate-500 mt-0.5">
                  {[activeUnit.street_address, activeUnit.city, [activeUnit.state, activeUnit.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                </p>
              )}
              {activeUnit?.hoa_name && (
                <p className="text-sm text-slate-500 mt-0.5">{activeUnit.hoa_name}</p>
              )}
            </div>
            {(activeUnit?.owner_primary || activeUnit?.owner_secondary) && (
              <div className="text-right">
                {activeUnit.owner_primary && <h1 className="text-xl font-bold text-slate-800">{activeUnit.owner_primary}</h1>}
                {activeUnit.owner_secondary && <h1 className="text-xl font-bold text-slate-800">{activeUnit.owner_secondary}</h1>}
              </div>
            )}
          </div>
          {tenantUnits.length > 1 && (
            <div className="flex gap-2 flex-wrap mt-3">
              {tenantUnits.map(u => (
                <button
                  key={u.unit_id}
                  onClick={() => selectUnit(u.unit_id)}
                  className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                    u.unit_id === unitId
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'
                  }`}
                >
                  Unit {u.unit_number || '—'}
                  {u.hoa_name && tenantUnits.some(o => o.hoa_id !== u.hoa_id) && (
                    <span className="opacity-70"> · {u.hoa_name}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </header>

        {RENTALS_ENABLED && activeUnit?.is_rental && !activeUnit?.is_renter && (
          <RentalOwnerSection unitId={unitId} hasLease={activeUnit?.has_lease} />
        )}

        {RENTALS_ENABLED && activeUnit?.is_renter && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-5 text-sm text-indigo-900">
            You're listed as the <strong>renter</strong> of this unit. Upload your{' '}
            <strong>HO-4 (renters) policy</strong> below — your association requires renters to
            carry personal liability coverage.
          </div>
        )}

        {error && !uploading && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {/* ── Status hero ─────────────────────────────────────────────── */}
        {policyLoading ? (
          <div className="bg-white rounded-2xl border border-slate-200 h-36 animate-pulse mb-5" />
        ) : (
          <section className={`rounded-2xl border p-6 mb-5 ${hero.card}`}>
            <div className="flex items-start gap-4">
              <span className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0 ${hero.accent}`}>
                {hero.icon}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className={`text-lg font-bold leading-snug ${hero.text}`}>
                  {parsing ? 'Reading your document…' : hero.title}
                </h2>
                <p className={`text-sm mt-1 ${hero.sub}`}>
                  {parsing
                    ? 'This usually takes under 30 seconds — the page will update on its own.'
                    : hero.blurb}
                </p>

                {/* Policy facts */}
                {policy && (policy.insurer || policy.expiration_date) && !parsing && (
                  <dl className={`mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm ${hero.text}`}>
                    {policy.insurer && (
                      <div>
                        <dt className={`text-xs uppercase tracking-wide ${hero.sub}`}>Insurer</dt>
                        <dd className="font-semibold mt-0.5">{policy.insurer}</dd>
                      </div>
                    )}
                    {policy.expiration_date && (
                      <div>
                        <dt className={`text-xs uppercase tracking-wide ${hero.sub}`}>Expires</dt>
                        <dd className="font-semibold mt-0.5">{fmtDate(policy.expiration_date)}</dd>
                      </div>
                    )}
                    {policy.policy_number && (
                      <div>
                        <dt className={`text-xs uppercase tracking-wide ${hero.sub}`}>Policy #</dt>
                        <dd className="font-semibold mt-0.5">{policy.policy_number}</dd>
                      </div>
                    )}
                    {policy.document_url && (
                      <div className="self-end">
                        <a href={policy.document_url} target="_blank" rel="noopener noreferrer"
                          className={`text-sm font-medium underline underline-offset-2 ${hero.sub}`}>
                          View document ↗
                        </a>
                      </div>
                    )}
                  </dl>
                )}

                {/* What needs fixing */}
                {flags.length > 0 && !parsing && (
                  <div className="mt-4 pt-4 border-t border-black/10">
                    <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${hero.sub}`}>What needs fixing</p>
                    <ul className={`space-y-1.5 text-sm ${hero.text}`}>
                      {flags.map((f, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="flex-shrink-0">→</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              </div>
            </div>
          </section>
        )}

        {/* ── Upload card ─────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-5">
          <h2 className="font-semibold text-slate-800">
            {policy ? 'Upload a new or renewed policy' : 'Upload your proof of insurance'}
          </h2>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            Attach your declaration page — we'll read the details automatically.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => document.getElementById('file-input-hidden').click()}
              className={`relative border-2 border-dashed rounded-xl px-4 py-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-blue-400 bg-blue-50'
                  : file
                  ? 'border-green-400 bg-green-50'
                  : 'border-amber-300 bg-amber-50 hover:border-amber-400 hover:bg-amber-100'
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
                  <p className="text-2xl mb-1.5">📄</p>
                  <p className="text-sm text-slate-600 font-medium hidden sm:block">
                    {dragOver ? 'Drop to upload' : 'Drag & drop your dec page'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 hidden sm:block">or click to browse · PDF, PNG, JPG</p>
                  <p className="text-sm text-slate-600 font-medium sm:hidden">Tap to upload your dec page</p>
                  <p className="text-xs text-slate-400 mt-1 sm:hidden">A PDF works best · a clear, full-page photo is OK too</p>
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

            {success && <p className="text-sm text-green-600">{success}</p>}

            <button
              type="submit"
              disabled={uploading}
              className="w-full sm:w-auto bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-6 py-2.5 rounded-lg disabled:opacity-60"
            >
              {uploading ? 'Uploading…' : 'Submit'}
            </button>
          </form>
        </section>

        {/* Quote card — shown for covered owners and those with no policy yet */}
        {QUOTE_FORM_URL && (
          <a href={quoteUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl px-5 py-4 mb-5 hover:border-blue-300 transition-colors">
            <div>
              <p className="text-sm font-semibold text-slate-700">Get a new HO-6 Quote</p>
              <p className="text-xs text-slate-400 mt-0.5">Get a free HO-6 insurance quote sent via email</p>
            </div>
            <span className="bg-slate-800 hover:bg-slate-900 text-white font-semibold text-sm px-4 py-2 rounded-lg flex-shrink-0">Request a HO-6 quote →</span>
          </a>
        )}

        {/* ── History, collapsed ──────────────────────────────────────── */}
        {history.length > 0 && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowHistory(s => !s)}
              className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-50"
            >
              <span className="text-sm font-semibold text-slate-700">
                Previous submissions <span className="text-slate-400 font-normal">({history.length})</span>
              </span>
              <svg className={`w-4 h-4 text-slate-400 transition-transform ${showHistory ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showHistory && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {history.map(p => (
                  <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <span className="text-slate-700">{p.insurer || 'Unknown insurer'}</span>
                      {p.policy_number && <span className="text-slate-400 ml-2">#{p.policy_number}</span>}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
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
            )}
          </section>
        )}

      </main>
    </div>
  )
}
