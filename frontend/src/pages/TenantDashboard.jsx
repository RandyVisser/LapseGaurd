import { useEffect, useRef, useState } from 'react'
import Nav from '../components/Nav'
import StatusBadge from '../components/StatusBadge'
import { apiGet, apiPost, supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import useIsMobile from '../hooks/useIsMobile'
import { track } from '../analytics'
import usePageTitle from '../usePageTitle'

// Owner-facing quote link (revenue lead). Falls back to the same URL the admin
// page uses so it always shows, even if VITE_QUOTE_FORM_URL isn't set on Railway.
// Quote link points at the agency quote page.
const QUOTE_FORM_URL = 'https://www.universalcondo.com/quote'
// Subrental owner steps — hidden until the rentals feature is switched on.
const RENTALS_ENABLED = import.meta.env.VITE_RENTALS_ENABLED === 'true'
// Email-in intake address — docs@condo.insure is live (Workspace forwards to
// the Resend inbound subdomain). Env var overrides.
const INBOUND = import.meta.env.VITE_INBOUND_ADDRESS || 'docs@condo.insure'

// One unambiguous answer per status — the page leads with this.
const STATUS_HERO = {
  active: {
    icon: '✓', title: "You're covered",
    blurb: 'Your policy is on file and meets your association\'s requirements.',
    card: 'bg-[#E2F4EC] border-[#BFE3D2]', accent: 'bg-[#0E8E68] text-white', text: 'text-[#0E8E68]', sub: 'text-[#0E8E68]',
  },
  expiring: {
    icon: '⏳', title: 'Renewal due soon',
    blurb: 'Your policy is active but expires soon — upload your renewal when you have it.',
    card: 'bg-[#FAEDD2] border-[#F0DDAE]', accent: 'bg-[#946410] text-white', text: 'text-[#946410]', sub: 'text-[#946410]',
  },
  pending_review: {
    icon: '🔍', title: 'Under review',
    blurb: 'We received your document and your association is reviewing it.',
    card: 'bg-[#E7EEFA] border-[#C7DBF5]', accent: 'bg-[#014AC5] text-white', text: 'text-[#014AC5]', sub: 'text-[#014AC5]',
  },
  non_compliant: {
    icon: '!', title: 'Action needed',
    blurb: 'Your policy is on file but doesn\'t meet a requirement — details below.',
    card: 'bg-[#FAEDD2] border-[#F0DDAE]', accent: 'bg-[#946410] text-white', text: 'text-[#946410]', sub: 'text-[#946410]',
  },
  lapsed: {
    icon: '!', title: 'Policy expired',
    blurb: 'Your association requires active insurance — upload your current policy below.',
    card: 'bg-[#F9E1DA] border-[#F0C4B4]', accent: 'bg-[#C0492F] text-white', text: 'text-[#C0492F]', sub: 'text-[#C0492F]',
  },
  missing: {
    icon: '!', title: 'No policy on file',
    blurb: 'Your association requires proof of insurance — upload your declaration page in the YELLOW box below.',
    card: 'bg-[#F9E1DA] border-[#F0C4B4]', accent: 'bg-[#C0492F] text-white', text: 'text-[#C0492F]', sub: 'text-[#C0492F]',
  },
}

function fmtDate(d) {
  if (!d) return null
  return new Date(String(d).slice(0, 10) + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Upload/save failures surface raw Supabase storage errors ("new row violates
// row-level security policy…") — owners get calm copy; the raw error stays in
// the console for debugging.
function friendlyUploadError(e) {
  console.error(e)
  return "We couldn't upload that file. Please try again — or email it to your association manager instead."
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
    } catch (e) { setErr(friendlyUploadError(e)) } finally { setBusy(false) }
  }

  async function sendInvite(e) {
    e.preventDefault()
    if (!renterEmail) { setErr('Enter the renter’s email.'); return }
    setBusy(true); setErr('')
    try {
      await apiPost(`/unit/${unitId}/rental/invite`, { email: renterEmail, name: renterName || null })
      setInvited(true)
    } catch (e) {
      console.error(e)
      setErr("We couldn't send that invite. Please check the email address and try again.")
    } finally { setBusy(false) }
  }

  return (
    <section className="bg-white rounded-2xl border border-[#C7DBF5] shadow-sm p-6 mb-5">
      <h2 className="font-bold text-[#0B1B33] mb-1">Rental — action needed</h2>
      <p className="text-sm text-[#54627A] mb-4">
        Your association flagged this unit as a rental. Upload the lease, then invite your renter so they can add their HO-4 policy.
      </p>

      <div className="mb-5">
        <p className="text-sm font-semibold text-[#0B1B33] mb-2">1. Upload the signed lease</p>
        {leaseDone ? (
          <p className="text-sm text-[#0E8E68]">
            ✓ Lease on file{result?.renter_names?.length ? ` — renter: ${result.renter_names.join(', ')}` : ''}
          </p>
        ) : (
          <form onSubmit={uploadLease} className="flex flex-wrap items-center gap-2">
            <input type="file" accept=".pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm" />
            <button disabled={busy} className="bg-[#014AC5] hover:bg-[#0139a3] text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60">
              {busy ? 'Reading…' : 'Upload lease'}
            </button>
          </form>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold text-[#0B1B33] mb-2">2. Invite your renter</p>
        {invited ? (
          <div>
            <p className="text-sm text-[#0E8E68]">✓ Invite sent to {renterEmail}.</p>
            <p className="text-xs text-[#54627A] mt-1">
              We've emailed them a link — they'll create a login and upload their HO-4 policy.
            </p>
          </div>
        ) : (
          <form onSubmit={sendInvite} className="space-y-2 max-w-sm">
            <input value={renterName} onChange={e => setRenterName(e.target.value)} placeholder="Renter name"
                   className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
            <input type="email" value={renterEmail} onChange={e => setRenterEmail(e.target.value)} placeholder="Renter email"
                   className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
            <button disabled={busy} className="bg-[#014AC5] hover:bg-[#0139a3] text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60">
              {busy ? 'Sending…' : 'Send invite'}
            </button>
          </form>
        )}
      </div>
      {err && <p className="text-sm text-[#C0492F] mt-3">{err}</p>}
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
  const [parseTimedOut, setParseTimedOut] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const pollRef = useRef(null)
  const isMobile = useIsMobile()
  // Collapses to a corner pill on mobile so it doesn't cover the page
  const [helperExpanded, setHelperExpanded] = useState(false)
  usePageTitle('My Policy')

  function loadPolicy() {
    if (!unitId) return
    // Kill any in-flight parse poll from the previously selected unit — its
    // closure captured the old unitId and would overwrite this unit's view.
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; setParsing(false) }
    setPolicyLoading(true)
    setPolicy(null)
    setError(''); setSuccess('')
    setLoadFailed(false)
    setParseTimedOut(false)
    Promise.all([
      apiGet(`/unit/${unitId}/policy`),
      apiGet(`/tenant/me/policies?unit_id=${unitId}`),
    ])
      .then(([current, all]) => {
        setPolicy(current)
        setAllPolicies(all || [])
      })
      .catch(e => { setError(e.message); setLoadFailed(true) })
      .finally(() => setPolicyLoading(false))
  }

  useEffect(loadPolicy, [unitId])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  function startParsingPoll() {
    setParsing(true)
    setParseTimedOut(false)
    let attempts = 0
    pollRef.current = setInterval(async () => {
      attempts++
      try {
        const current = await apiGet(`/unit/${unitId}/policy`)
        if (current && (current.parsed_at || attempts >= 15)) {
          clearInterval(pollRef.current)
          pollRef.current = null
          setParsing(false)
          setParseTimedOut(!current.parsed_at)
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
      setError(friendlyUploadError(e))
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
  // Renters carry an HO-4, not an HO-6 — the upload card copy follows suit.
  const isRenter = RENTALS_ENABLED && activeUnit?.is_renter

  if (!unitId) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      {profileError ? (
        <div className="text-center max-w-sm">
          <p className="text-[#0B1B33] font-medium mb-1">Couldn't load your profile</p>
          <p className="text-sm text-[#54627A]">{profileError}</p>
          <p className="text-xs text-[#8493A8] mt-3">Contact your association manager if this persists.</p>
        </div>
      ) : (
        <p className="text-[#8493A8] text-sm">Loading your profile…</p>
      )}
    </div>
  )

  // ── Next-steps helper box ─────────────────────────────────────────────
  const nextSteps = []
  if (!policyLoading) {
    if (parsing) {
      nextSteps.push({ icon: '⏳', text: 'We\'re reading your document — this usually takes 10–20 seconds…', wait: true })
    } else if (parseTimedOut) {
      nextSteps.push({ icon: '⏳', text: 'Still reviewing your document — this can take a few minutes. You can safely leave this page; the status above will update once it\'s done.', wait: true })
    } else if (!policy || status === 'missing') {
      nextSteps.push({ icon: '📄', text: 'Click the YELLOW box to upload your declaration page (the one-page summary from your insurer).' })
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
            className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-white text-sm font-semibold ${nextSteps[0]?.success ? 'bg-[#0E8E68]' : 'bg-[#014AC5]'}`}
          >
            {nextSteps[0]?.success ? '✓ All set' : 'Next Steps'}
            {!nextSteps[0]?.success && (
              <span className="bg-white/25 rounded-full px-1.5 text-xs">{nextSteps.length}</span>
            )}
          </button>
        ) : (
          <div className={`fixed z-50 bg-white shadow-xl overflow-hidden border ${nextSteps[0]?.success ? 'border-[#BFE3D2]' : 'border-[#C7DBF5]'} ${isMobile ? 'bottom-0 inset-x-0 rounded-t-2xl max-h-[55vh] overflow-y-auto' : 'bottom-6 right-6 w-80 rounded-2xl'}`}>
            <div className={`px-4 py-3 flex items-center justify-between gap-2 ${nextSteps[0]?.success ? 'bg-[#0E8E68]' : 'bg-[#014AC5]'}`}>
              <span className="text-white font-semibold text-sm">{nextSteps[0]?.success ? '✓ Compliant' : 'Next Steps'}</span>
              {isMobile && (
                <button onClick={() => setHelperExpanded(false)} aria-label="Collapse" className="text-white/90 hover:text-white text-xl leading-none">×</button>
              )}
            </div>
            <ul className="p-4 space-y-3">
              {nextSteps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-[#0B1B33]">
                  <span className="text-base leading-snug">{s.icon}</span>
                  <span>
                    {!s.success && <span className="font-semibold text-[#014AC5]">{s.wait ? 'Wait: ' : 'Next: '}</span>}
                    {s.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
      <main className="max-w-2xl mx-auto px-4 pt-8 pb-24">

        {/* Unit context */}
        <header className="mb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-[#0B1B33]">
                {activeUnit?.unit_number ? `Unit ${activeUnit.unit_number}` : 'My Policy'}
              </h1>
              {activeUnit?.street_address && (
                <p className="text-sm text-[#54627A] mt-0.5">
                  {[activeUnit.street_address, activeUnit.city, [activeUnit.state, activeUnit.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                </p>
              )}
              {activeUnit?.hoa_name && (
                <p className="text-sm text-[#54627A] mt-0.5">{activeUnit.hoa_name}</p>
              )}
            </div>
            {(activeUnit?.owner_primary || activeUnit?.owner_secondary) && (
              <div className="text-right">
                {activeUnit.owner_primary && <h1 className="text-xl font-bold text-[#0B1B33]">{activeUnit.owner_primary}</h1>}
                {activeUnit.owner_secondary && <h1 className="text-xl font-bold text-[#0B1B33]">{activeUnit.owner_secondary}</h1>}
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
                      ? 'bg-[#001842] border-[#001842] text-white'
                      : 'bg-white border-[#E8ECF2] text-[#54627A] hover:border-[#7CA9E8]'
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
          <div className="bg-[#E7EEFA] border border-[#C7DBF5] rounded-xl p-4 mb-5 text-sm text-[#014AC5]">
            You're listed as the <strong>renter</strong> of this unit. Upload your{' '}
            <strong>HO-4 (renters) policy</strong> below — your association requires renters to
            carry personal liability coverage.
          </div>
        )}

        {error && !uploading && (
          <p className="text-sm text-[#C0492F] mb-4">
            {error}
            {loadFailed && (
              <button
                onClick={loadPolicy}
                className="ml-2 text-xs font-semibold text-[#014AC5] border border-[#C7DBF5] bg-white hover:bg-[#E7EEFA] px-3 py-1 rounded-lg"
              >
                Retry
              </button>
            )}
          </p>
        )}

        {/* ── Status hero ─────────────────────────────────────────────── */}
        {policyLoading ? (
          <div className="bg-white rounded-2xl border border-[#E8ECF2] h-36 animate-pulse mb-5" />
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
        <section className="bg-white rounded-2xl border border-[#E8ECF2] shadow-sm p-6 mb-5">
          <h2 className="font-semibold text-[#0B1B33]">
            {policy ? 'Upload a new or renewed policy'
              : isRenter ? 'Upload your HO-4 (renters) policy'
              : 'Upload your proof of insurance'}
          </h2>
          <p className="text-sm text-[#54627A] mt-1 mb-4">
            {isRenter
              ? "Attach your HO-4 policy's declaration page — we'll read the details automatically."
              : "Attach your declaration page (the one-page summary from your insurer) — we'll read the details automatically."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => document.getElementById('file-input-hidden').click()}
              className={`relative border-2 border-dashed rounded-xl px-4 py-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-[#7CA9E8] bg-[#E7EEFA]'
                  : file
                  ? 'border-[#8FCFB2] bg-[#E2F4EC]'
                  : 'border-[#EAC98A] bg-[#FAEDD2] hover:border-[#DDAF5E] hover:bg-[#F7E4B8]'
              }`}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[#0E8E68] text-lg">✓</span>
                  <span className="text-sm text-[#0E8E68] font-medium">{file.name}</span>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setFile(null); setFileInputKey(k => k + 1) }}
                    className="text-xs text-[#8493A8] hover:text-[#54627A] ml-1"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-2xl mb-1.5">📄</p>
                  <p className="text-sm text-[#54627A] font-medium hidden sm:block">
                    {dragOver ? 'Drop to upload' : isRenter ? 'Drag & drop your HO-4 policy' : 'Drag & drop your declaration page'}
                  </p>
                  <p className="text-xs text-[#8493A8] mt-1 hidden sm:block">or click to browse · PDF, PNG, JPG</p>
                  <p className="text-sm text-[#54627A] font-medium sm:hidden">
                    {isRenter ? 'Tap to upload your HO-4 policy' : 'Tap to upload your declaration page'}
                  </p>
                  <p className="text-xs text-[#8493A8] mt-1 sm:hidden">A PDF works best · a clear, full-page photo is OK too</p>
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

            {INBOUND && (
              <p className="text-xs text-[#8493A8]">
                Prefer email? Forward your declaration page to{' '}
                <a href={`mailto:${INBOUND}`} className="text-[#014AC5] hover:underline">{INBOUND}</a>
                {' '}and we&rsquo;ll file it for you.
              </p>
            )}

            {success && <p className="text-sm text-[#0E8E68]">{success}</p>}

            <button
              type="submit"
              disabled={uploading}
              className="w-full sm:w-auto bg-[#001842] hover:bg-[#0A2A63] text-white text-sm font-semibold px-6 py-2.5 rounded-lg disabled:opacity-60"
            >
              {uploading ? 'Uploading…' : 'Submit'}
            </button>
          </form>
        </section>

        {/* Quote card — shown for covered owners and those with no policy yet */}
        {QUOTE_FORM_URL && (
          <a href={quoteUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between bg-white border border-[#E8ECF2] rounded-2xl px-5 py-4 mb-5 hover:border-[#7CA9E8] transition-colors">
            <div>
              <p className="text-sm font-semibold text-[#0B1B33]">Get a new HO-6 (condo unit-owner insurance) Quote</p>
              <p className="text-xs text-[#8493A8] mt-0.5">Get a free HO-6 insurance quote sent via email</p>
            </div>
            <span className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold text-sm px-4 py-2 rounded-lg flex-shrink-0">Request a HO-6 quote →</span>
          </a>
        )}

        {/* ── History, collapsed ──────────────────────────────────────── */}
        {history.length > 0 && (
          <section className="bg-white rounded-2xl border border-[#E8ECF2] shadow-sm overflow-hidden">
            <button
              onClick={() => setShowHistory(s => !s)}
              className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-50"
            >
              <span className="text-sm font-semibold text-[#0B1B33]">
                Previous submissions <span className="text-[#8493A8] font-normal">({history.length})</span>
              </span>
              <svg className={`w-4 h-4 text-[#8493A8] transition-transform ${showHistory ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showHistory && (
              <ul className="divide-y divide-[#E8ECF2] border-t border-[#E8ECF2]">
                {history.map(p => (
                  <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <span className="text-[#0B1B33]">{p.insurer || 'Unknown insurer'}</span>
                      {p.policy_number && <span className="text-[#8493A8] ml-2">#{p.policy_number}</span>}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-[#8493A8]">
                        {p.expiration_date ? `Exp ${fmtDate(p.expiration_date)}` : 'No expiration'}
                      </span>
                      <StatusBadge status={p.status} />
                      {p.document_url && (
                        <a href={p.document_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-[#014AC5] hover:underline">View</a>
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
