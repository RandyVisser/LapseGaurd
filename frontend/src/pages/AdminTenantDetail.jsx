import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import { apiGet, apiPost, apiPatch, apiDelete, supabase } from '../supabase'
import useIsMobile from '../hooks/useIsMobile'

// Quote button points at the agency quote page (HO-4 page for renters).
const QUOTE_FORM_URL = 'https://www.universalcondo.com/quote'
const HO4_QUOTE_URL = 'https://www.universalcondo.com/ho4quote.html'

// ─── Helpers ────────────────────────────────────────────────────────────────

function currency(val) {
  if (val == null || val === '') return null
  return `$${Number(val).toLocaleString()}`
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const exp = new Date(dateStr + 'T00:00:00'); exp.setHours(0, 0, 0, 0)
  return Math.round((exp - today) / 86400000)
}

function fmtDate(dateStr) {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(ts) {
  if (!ts) return null
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function toDateInputValue(dateStr) {
  if (!dateStr) return ''
  return String(dateStr).slice(0, 10)
}

function fileNameFromUrl(url) {
  if (!url) return null
  try { return decodeURIComponent(url.split('/').pop().split('?')[0]) } catch { return url.split('/').pop() }
}

const COVERAGE_TYPE_OPTIONS = [
  { value: 'ho6_wind_excluded', label: 'HO-6 excl wind' },
  { value: 'ho6_with_wind',     label: 'HO-6 with wind' },
  { value: 'ho4',               label: 'HO-4' },
  { value: 'wind_only',         label: 'Wind only' },
  { value: 'unknown',           label: 'Unknown' },
]

const STATUS_PRIORITY = { active: 0, expiring: 1, non_compliant: 2, pending_review: 3, lapsed: 4, missing: 5 }

function worstStatus(policies) {
  if (!policies.length) return 'missing'
  return policies.reduce((w, p) =>
    (STATUS_PRIORITY[p.status] ?? 4) > (STATUS_PRIORITY[w] ?? 4) ? p.status : w,
    policies[0].status,
  )
}

// Fuzzy name match: all words of tenantName must appear in policyName (case-insensitive)
function nameMatches(tenantName, policyName) {
  if (!tenantName || !policyName) return false
  const words = tenantName.toLowerCase().trim().split(/\s+/).filter(w => w.length > 1)
  const target = policyName.toLowerCase()
  return words.length > 0 && words.every(w => target.includes(w))
}

// Fuzzy address match: street number + first street word must both appear in policyAddress
function addressMatches(unitStreet, policyAddress) {
  if (!unitStreet || !policyAddress) return false
  const parts = unitStreet.toLowerCase().trim().split(/[\s,]+/).filter(Boolean)
  const target = policyAddress.toLowerCase()
  // Require at least the street number and first street name word to match
  const keyParts = parts.slice(0, 2)
  return keyParts.length > 0 && keyParts.every(p => target.includes(p))
}

function buildComplianceChecks(tenant, currentPolicies) {
  // Renter sub-unit (HO-4) — different checks than an HO-6 owner.
  if (tenant.is_renter) {
    const rItems = []
    const ho4 = currentPolicies.find(p => p.coverage_type === 'ho4') || currentPolicies[0]
    if (!ho4) {
      rItems.push({ type: 'fail', text: 'No HO-4 policy on file' })
      return rItems
    }
    const ext = ho4.extracted_data || {}
    // (1) Named insured matches the lessee (renter) name from the lease
    const renterName = tenant.owner_primary || tenant.name
    const insuredNames = [
      ext.named_insured,
      ...(Array.isArray(ext.additional_insureds) ? ext.additional_insureds : ext.additional_insureds ? [ext.additional_insureds] : []),
    ].filter(Boolean)
    if (renterName && insuredNames.length) {
      const match = insuredNames.some(n => nameMatches(renterName, n))
      rItems.push({
        type: match ? 'pass' : 'fail',
        text: match
          ? `Named insured matches lease (${renterName})`
          : `Named insured does not match lease — policy lists "${insuredNames.join('; ')}", lease shows "${renterName}"`,
      })
    }
    // (2) Liability limit meets the association minimum
    const liability = ext.liability_coverage
    if (tenant.ho4_liability_min && liability != null) {
      const meets = Number(liability) >= tenant.ho4_liability_min
      rItems.push({ type: meets ? 'pass' : 'fail', text: `Liability limit ${currency(liability)} ${meets ? 'meets' : 'below'} ${currency(tenant.ho4_liability_min)} minimum` })
    }
    // (3) Coverage is in force (active now, not expired / not future-dated)
    const today = new Date().toISOString().slice(0, 10)
    const exp = ho4.expiration_date
    const eff = ext.effective_date
    const inForce = (!exp || exp >= today) && (!eff || eff <= today) && ho4.status !== 'lapsed'
    rItems.push({
      type: inForce ? 'pass' : 'fail',
      text: inForce ? 'Coverage is in force' : 'Coverage is not in force (expired or not yet effective)',
    })
    return rItems
  }

  const ho6  = currentPolicies.find(p => ['ho6_with_wind', 'ho6_wind_excluded'].includes(p.coverage_type))
  const wind = currentPolicies.find(p => p.coverage_type === 'wind_only')
  const items = []

  // Wind-only coverage never satisfies the HO-6 requirement on its own
  if (wind && !ho6) {
    items.push({ type: 'fail', text: 'Add an HO-6 policy (excluding wind)' })
  }

  for (const [p, label] of [[ho6, 'HO-6'], [wind, 'Wind only']]) {
    if (!p) continue
    const d = daysUntil(p.expiration_date)
    if (d !== null && d >= 0 && d <= 30)
      items.push({ type: 'warning', text: `${label} policy (${p.insurer || 'unknown'}) expires in ${d} day${d !== 1 ? 's' : ''} — renewal required` })
  }

  // Named insured / additional insured matches unit-owner name
  // Owner may appear as named insured OR any additional insured (e.g. LLC owner with individual as add'l insured)
  if (tenant.ho6_named_insured_match_required && ho6?.extracted_data) {
    const ext = ho6.extracted_data
    // Collect all insured names: named_insured + additional_insureds (array) + additional_insured (legacy string)
    const allInsuredNames = [
      ext.named_insured,
      ...(Array.isArray(ext.additional_insureds) ? ext.additional_insureds : ext.additional_insureds ? [ext.additional_insureds] : []),
      ...(ext.additional_insured && !Array.isArray(ext.additional_insured) ? [ext.additional_insured] : []),
    ].filter(Boolean)
    const ownerName = tenant.owner_primary || tenant.owner_secondary || tenant.name
    const match = allInsuredNames.some(n => nameMatches(ownerName, n))
    if (allInsuredNames.length > 0) {
      items.push({
        type: match ? 'pass' : 'fail',
        text: match
          ? `Named insured matches unit-owner (${ownerName})`
          : `Named insured does not match unit-owner — policy lists "${allInsuredNames.join('; ')}", expected "${ownerName}"`,
      })
    }
  }

  // Property address matches unit address
  if (tenant.ho6_property_address_match_required && ho6?.extracted_data?.property_address) {
    const match = addressMatches(tenant.street_address, ho6.extracted_data.property_address)
    items.push({
      type: match ? 'pass' : 'fail',
      text: match
        ? `Property address matches unit (${ho6.extracted_data.property_address})`
        : `Property address mismatch — policy shows "${ho6.extracted_data.property_address}", unit is "${tenant.street_address || 'no address on file'}"`,
    })
  }

  const ho6CovA = ho6?.extracted_data?.dwelling_coverage
  if (tenant.ho6_coverage_a_min && ho6CovA != null) {
    const meets = Number(ho6CovA) >= tenant.ho6_coverage_a_min
    items.push({ type: meets ? 'pass' : 'fail', text: `HO-6 Coverage A (Dwelling) ${currency(ho6CovA)} ${meets ? 'meets' : 'below'} minimum` })
  }
  const windCovA = wind?.extracted_data?.dwelling_coverage
  if (wind && windCovA != null)
    items.push({ type: 'pass', text: `Wind Coverage A ${currency(windCovA)} meets minimum` })
  const covE = ho6?.extracted_data?.liability_coverage
  if (tenant.ho6_coverage_e_min && covE != null) {
    const meets = Number(covE) >= tenant.ho6_coverage_e_min
    items.push({ type: meets ? 'pass' : 'fail', text: `Coverage E (Liability) ${currency(covE)} ${meets ? 'meets' : 'below'} minimum` })
  }
  if (tenant.ho6_wind_required) {
    const hasWind = ho6?.coverage_type === 'ho6_with_wind' || wind != null
    items.push({
      type: hasWind ? 'pass' : 'fail',
      text: hasWind
        ? 'Wind coverage present'
        : ho6?.coverage_type === 'ho6_wind_excluded'
          ? 'Association requires wind coverage — HO-6 excludes wind (separate wind policy required)'
          : 'Association requires wind coverage — not found on policy',
    })
  }
  if (tenant.ho6_additional_interest_required) {
    const v = ho6?.review_overrides?.association_additional_interest?.value
    if (v === 'pass' || v === 'override') items.push({ type: 'pass', text: 'Association listed on HO-6' })
    else if (v === 'fail')               items.push({ type: 'fail', text: 'Association not listed on HO-6' })
  }

  // Flagged-rented owner unit: needs a lease on file and (if required) a rental
  // endorsement on the HO-6 — same rules the dashboard status reflects.
  if (tenant.is_rental && !tenant.is_renter && ho6) {
    items.push({
      group: 'rented',
      type: tenant.has_lease ? 'pass' : 'fail',
      text: tenant.has_lease ? 'Lease on file' : 'Lease required — no copy of the lease on file',
    })
    if (tenant.rental_endorsement_required) {
      const endorsed = !!ho6?.extracted_data?.has_rental_endorsement
      items.push({
        group: 'rented',
        type: endorsed ? 'pass' : 'fail',
        text: endorsed
          ? 'HO-6 carries a Unit-Rented-to-Others endorsement'
          : 'HO-6 rental endorsement required — not found on policy',
      })
    }
    // Lease effective dates + term (from the AI-parsed lease)
    const ls = tenant.lease_summary || {}
    const start = ls.lease_start, end = ls.lease_end
    if (tenant.has_lease && start && end) {
      const today = new Date().toISOString().slice(0, 10)
      const active = start <= today && today <= end
      items.push({
        group: 'rented',
        type: active ? 'pass' : 'fail',
        text: active
          ? `Lease effective dates are active (${start} – ${end})`
          : `Lease is not currently active (${start} – ${end})`,
      })
      if (active && tenant.lease_min_term_days) {
        const termDays = Math.round((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24))
        const meets = termDays >= tenant.lease_min_term_days
        items.push({
          group: 'rented',
          type: meets ? 'pass' : 'fail',
          text: `Lease term ${termDays} days ${meets ? 'meets' : 'below'} ${tenant.lease_min_term_days}-day minimum`,
        })
      }
    }
    // Renter's HO-4 policy on file (when the association requires it)
    if (tenant.ho4_required) {
      items.push({
        group: 'rented',
        type: tenant.renter_has_ho4 ? 'pass' : 'fail',
        text: tenant.renter_has_ho4
          ? "Renter's HO-4 policy on file"
          : "Renter's HO-4 policy required — none on file",
      })
    }
  }
  return items
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{children}</p>
}

// ─── Currency input ──────────────────────────────────────────────────────────

function CurrencyInput({ label, value, onChange, placeholder, className = '' }) {
  const [focused, setFocused] = useState(false)
  const raw = value === '' || value == null ? '' : String(value)
  const formatted = raw !== '' && !isNaN(Number(raw))
    ? '$' + Number(raw).toLocaleString('en-US', { maximumFractionDigits: 0 })
    : raw
  return (
    <div className={className}>
      <label className="block text-xs font-medium mb-1.5 text-slate-500">{label}</label>
      <input
        type="text"
        value={focused ? raw : formatted}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={e => {
          // Strip $ and commas so the stored value stays a plain number string
          const stripped = e.target.value.replace(/[$,]/g, '')
          onChange(stripped)
        }}
        placeholder={placeholder ? '$' + Number(placeholder).toLocaleString('en-US', { maximumFractionDigits: 0 }) : ''}
        className="w-full rounded-lg px-3 py-2 text-sm border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}

// ─── Input components ────────────────────────────────────────────────────────

function FieldInput({ label, value, onChange, type = 'text', placeholder, maxLength, readOnly, highlighted, missing, danger, className = '' }) {
  const isEmpty = !value && value !== 0
  const showMissing = missing && isEmpty && !highlighted
  return (
    <div className={className}>
      <label className={`block text-xs font-medium mb-1.5 ${danger ? 'text-red-700' : highlighted ? 'text-amber-700' : showMissing ? 'text-red-500' : 'text-slate-500'}`}>
        {label}
        {highlighted && <span className="ml-1.5 text-amber-600 font-semibold">— updated</span>}
        {showMissing && <span className="ml-1.5 text-red-400 font-semibold">— required</span>}
        {danger && <span className="ml-1.5 text-red-600 font-semibold">— expired</span>}
      </label>
      {readOnly
        ? <p className="text-sm text-slate-700 py-2">{value || '—'}</p>
        : <input
            type={type}
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder || (showMissing ? 'Enter value…' : undefined)}
            maxLength={maxLength}
            className={`w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
              danger
                ? 'border border-red-400 bg-red-50 focus:ring-red-400 text-red-800'
                : highlighted
                ? 'border border-amber-400 bg-amber-50 focus:ring-amber-400'
                : showMissing
                ? 'border border-red-300 bg-red-50 focus:ring-red-400'
                : 'border border-slate-200 bg-white focus:ring-blue-500'
            }`}
          />
      }
    </div>
  )
}

function FieldSelect({ label, value, onChange, options, highlighted, danger, className = '' }) {
  return (
    <div className={className}>
      <label className={`block text-xs font-medium mb-1.5 ${danger ? 'text-red-700' : highlighted ? 'text-amber-700' : 'text-slate-500'}`}>
        {label}{highlighted && <span className="ml-1.5 text-amber-600 font-semibold">— updated</span>}
        {danger && <span className="ml-1.5 text-red-600 font-semibold">— required by association</span>}
      </label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className={`w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 appearance-none ${
          danger
            ? 'border border-red-400 bg-red-50 focus:ring-red-400 text-red-800'
            : highlighted
            ? 'border border-amber-400 bg-amber-50 focus:ring-amber-400'
            : 'border border-slate-200 bg-white focus:ring-blue-500'
        }`}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ─── Policy edit card ────────────────────────────────────────────────────────

function PolicyEditCard({ policyId, form, onChange, aiUpdated, onRunAi, runningAiId, onDelete, deleting, isDraft, unitId, onDocumentUploaded, windRequired, validationFlags = [] }) {
  const fileInputRef = useRef()
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')

  function f(key) { return v => onChange(key, v) }
  function hi(key) { return aiUpdated?.includes(key) }

  const isHo6 = ['ho6_with_wind', 'ho6_wind_excluded'].includes(form.coverage_type)
  const isHo4 = form.coverage_type === 'ho4'
  const days = daysUntil(form.expiration_date)
  const isExpiringSoon = days !== null && days >= 0 && days <= 30
  const aiCount = aiUpdated?.length || 0
  const fileName = fileNameFromUrl(form.document_url)

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    // Clear the input value so picking the *same* file again still fires
    // onChange (otherwise a retry after an error appears to do nothing)
    e.target.value = ''
    if (!file) return
    setUploading(true); setUploadErr('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${unitId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('policy-documents').upload(path, file, { upsert: true })
      if (upErr) throw new Error(upErr.message)
      const { data } = supabase.storage.from('policy-documents').getPublicUrl(path)
      onChange('document_url', data.publicUrl)
      onChange('uploaded_at', new Date().toISOString())
      // Autosave so the document_url is persisted immediately
      if (onDocumentUploaded) await onDocumentUploaded(policyId, data.publicUrl, isDraft)
    } catch (e) { setUploadErr(e.message) }
    finally { setUploading(false) }
  }

  // Derive missing critical fields for visual cues
  const missingFields = []
  if (!form.insurer) missingFields.push('carrier')
  if (!form.policy_number) missingFields.push('policy_number')
  if (!form.expiration_date) missingFields.push('expiration_date')
  if (!form.named_insured) missingFields.push('named_insured')
  if (!form.document_url) missingFields.push('document')
  const hasMissing = missingFields.length > 0

  // Left border accent color based on status / completeness
  // NOTE: full class strings required so Tailwind does not purge them
  let accentColor = 'border-2 border-slate-200'
  if (form.status === 'lapsed') accentColor = 'border-2 border-red-500'
  else if (form.status === 'non_compliant') accentColor = 'border-2 border-orange-400'
  else if (form.status === 'active' && !hasMissing) accentColor = 'border-2 border-green-400'
  else if (form.status === 'expiring' || form.status === 'pending_review' || hasMissing) accentColor = 'border-2 border-amber-400'

  const isLapsed = form.status === 'lapsed'

  return (
    <div className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${accentColor}`}>
      {/* Card header */}
      <div className={`flex items-center justify-between gap-3 px-5 py-3 border-b ${isLapsed ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <select
            value={form.coverage_type || 'unknown'}
            onChange={e => onChange('coverage_type', e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {COVERAGE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {/* Expiry chip */}
          {isExpiringSoon && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1 whitespace-nowrap">
              ⚠ Expires soon
            </span>
          )}
          {days !== null && days < 0 && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-700 whitespace-nowrap">Expired</span>
          )}
          {form.status === 'pending_review' && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap">Pending review</span>
          )}
          {hasMissing && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-600 whitespace-nowrap">
              ⚠ {missingFields.length} field{missingFields.length !== 1 ? 's' : ''} missing
            </span>
          )}
        </div>
        <button type="button" onClick={() => onDelete(policyId)} disabled={deleting}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 disabled:opacity-50 flex-shrink-0">
          {deleting
            ? <span className="text-xs">…</span>
            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          }
        </button>
      </div>

      <div className="p-5 space-y-6">

        {/* POLICY DOCUMENT — the admin's first move: upload, let AI fill the rest */}
        <div>
          <SectionLabel>Policy document</SectionLabel>
          {form.document_url ? (
            <div className="border border-slate-200 rounded-xl bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <svg className="w-6 h-6 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="min-w-0">
                  <a href={form.document_url} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline font-medium block truncate">
                    {fileName}
                  </a>
                  {form.uploaded_at && (
                    <p className="text-xs text-slate-400">Uploaded {fmtDate(String(form.uploaded_at).slice(0, 10))}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  disabled={runningAiId === policyId || isDraft}
                  onClick={() => onRunAi(policyId)}
                  className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  <span>✦</span>
                  {runningAiId === policyId ? 'Extracting…' : 'Re-extract'}
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 bg-white hover:bg-slate-50">
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <div
              className="border-2 border-dashed border-amber-300 rounded-xl bg-amber-50 px-5 py-7 flex flex-col items-center gap-1 cursor-pointer hover:bg-amber-100 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading
                ? <p className="text-sm text-amber-700">Uploading…</p>
                : <>
                    <svg className="w-7 h-7 text-amber-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <p className="text-sm text-amber-700 font-semibold">Upload dec page — AI fills the fields below</p>
                    <p className="text-xs text-amber-500">PDF, JPG, PNG</p>
                  </>
              }
            </div>
          )}
          <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleFileChange} />
          {uploadErr && <p className="text-xs text-red-600 mt-1">{uploadErr}</p>}
          {isDraft && form.document_url && <p className="text-xs text-slate-400 mt-1.5">Save the policy first, then extract</p>}
        </div>

        {/* AI review findings for this policy */}
        {validationFlags.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1.5">✦ AI review found issues</p>
            <ul className="space-y-1 text-sm text-red-700">
              {validationFlags.map((flag, i) => (
                <li key={i} className="flex gap-2"><span className="flex-shrink-0">→</span><span>{flag}</span></li>
              ))}
            </ul>
          </div>
        )}

        {/* AI extraction banner */}
        {aiCount > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
            <span>✦</span>
            <span>{aiCount} field{aiCount !== 1 ? 's were' : ' was'} updated by AI extraction — highlighted in amber</span>
          </div>
        )}

        {/* INSURED PARTIES */}
        <div>
          <SectionLabel>Insured parties</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FieldInput label="Named insured" value={form.named_insured} onChange={f('named_insured')} highlighted={hi('named_insured')} missing={true} />
            <FieldInput label="Additional insured" value={form.additional_insured} onChange={f('additional_insured')} placeholder="e.g. association" highlighted={hi('additional_insured')} />
            <div className="flex flex-col gap-1.5">
              <FieldInput label="Additional interests" value={form.additional_interests} onChange={f('additional_interests')} placeholder="Mortgagee, lender, etc." highlighted={hi('additional_interests')} />
              <label className="flex items-center gap-2 text-sm text-slate-600 mt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.association_listed}
                  onChange={e => onChange('association_listed', e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Association listed
              </label>
            </div>
          </div>
        </div>

        {/* POLICY DETAILS */}
        <div>
          <SectionLabel>Policy details</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FieldInput label="Carrier" value={form.insurer} onChange={f('insurer')} highlighted={hi('insurer')} missing={true} />
            <FieldInput label="Policy #" value={form.policy_number} onChange={f('policy_number')} highlighted={hi('policy_number')} missing={true} />
            <FieldInput label="Effective date" value={toDateInputValue(form.effective_date)} onChange={f('effective_date')} type="date" highlighted={hi('effective_date')} />
            <FieldInput label="Expiration date" value={toDateInputValue(form.expiration_date)} onChange={f('expiration_date')} type="date" highlighted={hi('expiration_date')} missing={true} danger={isLapsed} />
          </div>
        </div>

        {/* COVERAGE */}
        <div>
          <SectionLabel>Coverage</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {!isHo4 && (
              <CurrencyInput label="Coverage A (Dwelling) ($)" value={form.dwelling_coverage ?? ''} onChange={v => onChange('dwelling_coverage', v)} />
            )}
            {(isHo6 || isHo4) && (
              <CurrencyInput label="Coverage E (Liability) ($)" value={form.liability_coverage ?? ''} onChange={v => onChange('liability_coverage', v)} />
            )}
            {isHo6 && (
              <FieldSelect
                label="Wind included"
                value={form.coverage_type === 'ho6_with_wind' ? 'yes' : 'no'}
                onChange={v => onChange('coverage_type', v === 'yes' ? 'ho6_with_wind' : 'ho6_wind_excluded')}
                options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
                danger={windRequired && form.coverage_type === 'ho6_wind_excluded'}
              />
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

let _draftCounter = 0

export default function AdminTenantDetail() {
  const { tenantId } = useParams()
  const navigate = useNavigate()

  const [tenant, setTenant] = useState(null)
  const [error, setError] = useState('')

  // Editable tenant/unit form
  const [form, setForm]     = useState({})
  // Unit owners on title (separate from the tenant login record)
  const [ownerForm, setOwnerForm] = useState({ owner_primary: '', owner_secondary: '', email_primary: '', email_secondary: '' })
  // Association requirements (from HOA)
  const [reqForm, setReqForm] = useState({ coverage_a_min: '', coverage_e_min: '', ho4_liability_min: '' })

  // Per-policy form state: { [policyId]: { insurer, policy_number, ... } }
  const [policyForms, setPolicyForms] = useState({})
  // Which fields were AI-updated per policy: { [policyId]: ['insurer', 'expiration_date', ...] }
  const [aiUpdated, setAiUpdated] = useState({})
  // Draft policies (new, not yet saved): [{ _draftId, coverage_type, ... }]
  const [drafts, setDrafts] = useState([])

  const [runningAiId, setRunningAiId] = useState(null)
  const [everCompliant, setEverCompliant] = useState(false)
  const leaseInputRef = useRef()
  const [leaseUploading, setLeaseUploading] = useState(false)
  const [leaseErr, setLeaseErr] = useState('')
  const ho4InputRef = useRef()
  const [ho4Uploading, setHo4Uploading] = useState(false)
  const [ho4Msg, setHo4Msg] = useState('')
  const [ho4Err, setHo4Err] = useState('')
  const [ho4TenantId, setHo4TenantId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [removingOwner, setRemovingOwner] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [notifying, setNotifying] = useState(false)

  function tField(key) { return v => setForm(f => ({ ...f, [key]: v })) }
  function pField(id, key, val) {
    setPolicyForms(f => ({ ...f, [id]: { ...(f[id] || {}), [key]: val } }))
  }
  function draftField(draftId, key, val) {
    setDrafts(ds => ds.map(d => d._draftId === draftId ? { ...d, [key]: val } : d))
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  function initFromTenant(data) {
    setTenant(data)
    setForm({
      name: data.name || '',
      // Placeholder @condo.insure emails are internal — don't show them
      email: (data.email || '').toLowerCase().endsWith('@condo.insure') ? '' : (data.email || ''),
      phone: data.phone || '',
      street_address: [
        // Strip any existing embedded "Unit XXXX" occurrences from the stored address
        // before appending the canonical unit number — prevents duplication on every save
        data.unit_number
          ? (data.street_address || '').replace(new RegExp(`\\s*Unit\\s+${data.unit_number}`, 'gi'), '').trim()
          : (data.street_address || ''),
        data.unit_number ? `Unit ${data.unit_number}` : '',
      ].filter(Boolean).join(' '),
      city: data.city || '',
      state: data.state || '',
      zip: data.zip || '',
    })
    setOwnerForm({
      owner_primary: data.owner_primary || '',
      owner_secondary: data.owner_secondary || '',
      email_primary: (data.email_primary || '').toLowerCase().endsWith('@condo.insure') ? '' : (data.email_primary || ''),
      email_secondary: (data.email_secondary || '').toLowerCase().endsWith('@condo.insure') ? '' : (data.email_secondary || ''),
    })
    setReqForm({
      coverage_a_min: data.ho6_coverage_a_min ?? '',
      coverage_e_min: data.ho6_coverage_e_min ?? '',
      ho4_liability_min: data.ho4_liability_min ?? '',
    })
    const pf = {}
    for (const p of (data.policies || [])) {
      const ext = p.extracted_data || {}
      const assocListed = p.review_overrides?.association_additional_interest?.value
      pf[p.id] = {
        coverage_type: p.coverage_type || 'unknown',
        insurer: p.insurer || '',
        policy_number: p.policy_number || '',
        expiration_date: toDateInputValue(p.expiration_date),
        effective_date: toDateInputValue(ext.effective_date),
        dwelling_coverage: ext.dwelling_coverage ?? '',
        liability_coverage: ext.liability_coverage ?? '',
        named_insured: ext.named_insured || '',
        additional_insured: Array.isArray(ext.additional_insureds)
          ? ext.additional_insureds.join(', ')
          : (ext.additional_insureds || ext.additional_insured || ''),
        additional_interests: Array.isArray(ext.additional_interests)
          ? ext.additional_interests.join(', ')
          : (ext.additional_interests || ''),
        association_listed: assocListed === 'pass' || assocListed === 'override',
        document_url: p.document_url || '',
        uploaded_at: p.uploaded_at || '',
        status: p.status,
      }
    }
    setPolicyForms(pf)
  }

  useEffect(() => {
    apiGet(`/tenant/${tenantId}`).then(initFromTenant).catch(e => setError(e.message))
  }, [tenantId])

  async function handleLeaseFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !tenant) return
    setLeaseUploading(true); setLeaseErr('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${tenant.unit_id}/lease-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('policy-documents').upload(path, file, { upsert: true })
      if (upErr) throw new Error(upErr.message)
      const { data } = supabase.storage.from('policy-documents').getPublicUrl(path)
      await apiPost(`/unit/${tenant.unit_id}/lease`, { document_url: data.publicUrl })
      // Refresh so has_lease, compliance status and the renter sub-unit update
      const fresh = await apiGet(`/tenant/${tenantId}`)
      initFromTenant(fresh)
    } catch (err) { setLeaseErr(err.message) }
    finally { setLeaseUploading(false) }
  }

  async function handleHo4File(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !tenant?.renter_unit_id) return
    setHo4Uploading(true); setHo4Msg(''); setHo4Err('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${tenant.renter_unit_id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('policy-documents').upload(path, file, { upsert: true })
      if (upErr) throw new Error(upErr.message)
      const { data } = supabase.storage.from('policy-documents').getPublicUrl(path)
      // Make sure the renter sub-unit has a tenant record, then attach the policy
      const t = await apiPost(`/unit/${tenant.renter_unit_id}/tenant`, {})
      await apiPost(`/unit/${tenant.renter_unit_id}/policy`, { document_url: data.publicUrl })
      setHo4Msg('HO-4 uploaded for the renter — we\'re reading it now.')
      setHo4TenantId(t?.id || null)
    } catch (err) { setHo4Err(err.message) }
    finally { setHo4Uploading(false) }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const currentPolicies = tenant?.policies?.filter(p => p.is_current) || []
  const historyPolicies = tenant?.policies?.filter(p => !p.is_current) || []
  // Prefer the backend's rental-aware status so the hero matches the dashboard;
  // fall back to the policy-derived status if it isn't present.
  const overallStatus   = tenant?.compliance_status || worstStatus(currentPolicies)
  const complianceChecks = tenant ? buildComplianceChecks(tenant, currentPolicies) : []

  const hasLapsedPolicy = currentPolicies.some(p => p.status === 'lapsed')

  const needsWindPolicy = tenant?.ho6_wind_required &&
    currentPolicies.some(p => p.coverage_type === 'ho6_wind_excluded') &&
    !currentPolicies.some(p => p.coverage_type === 'wind_only')

  const needsHo6Policy = currentPolicies.some(p => p.coverage_type === 'wind_only') &&
    !currentPolicies.some(p => ['ho6_with_wind', 'ho6_wind_excluded'].includes(p.coverage_type))

  const lastUpdated = tenant?.policies?.reduce((latest, p) => {
    const t = p.parsed_at || p.uploaded_at
    return !latest || (t && t > latest) ? t : latest
  }, null)

  const formattedAddress = [
    form.street_address,
    [form.city, form.state].filter(Boolean).join(', '),
    form.zip,
  ].filter(Boolean).join(', ')

  // ── Status card style ──────────────────────────────────────────────────────

  const isExpiringSoon = currentPolicies.some(p => {
    if (!p.expiration_date) return false
    const days = Math.ceil((new Date(p.expiration_date) - new Date()) / (1000 * 60 * 60 * 24))
    return days >= 0 && days <= 30
  })
  const statusStyles = {
    active:         { card: 'bg-green-50 border-green-200',   icon: '✓', label: 'Active · Meets Requirements', text: 'text-green-800', bullet: { pass: 'text-green-600', fail: 'text-red-600', warning: 'text-amber-700' } },
    expiring:       { card: 'bg-green-50 border-green-200',   icon: '✓', label: 'Active · Meets Requirements', text: 'text-green-800', bullet: { pass: 'text-green-600', fail: 'text-red-600', warning: 'text-amber-700' } },
    non_compliant:  { card: 'bg-orange-50 border-orange-200', icon: '✗', label: 'Active · Non-Compliant', text: 'text-orange-800', bullet: { pass: 'text-green-700', fail: 'text-red-600', warning: 'text-amber-700' } },
    pending_review: { card: 'bg-blue-50 border-blue-200',     icon: '●', label: 'Pending Review', text: 'text-blue-800', bullet: { pass: 'text-green-700', fail: 'text-red-600', warning: 'text-amber-700' } },
    lapsed:         { card: 'bg-red-50 border-red-200',       icon: '✗', label: 'Expired', text: 'text-red-800', bullet: { pass: 'text-green-700', fail: 'text-red-700', warning: 'text-amber-700' } },
    missing:        { card: 'bg-slate-50 border-slate-200',   icon: '—', label: 'No Policy Received', text: 'text-slate-600', bullet: { pass: 'text-green-700', fail: 'text-red-700', warning: 'text-amber-700' } },
  }
  const ss = statusStyles[overallStatus] || statusStyles.missing

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleRunAi(policyId) {
    setRunningAiId(policyId); setError('')
    const beforeParsedAt = tenant.policies.find(p => p.id === policyId)?.parsed_at
    const beforeExt = tenant.policies.find(p => p.id === policyId)?.extracted_data || {}
    try {
      await apiPost(`/policy/${policyId}/run-ai`, {})
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const fresh = await apiGet(`/tenant/${tenantId}`)
        const updated = fresh.policies.find(p => p.id === policyId)
        if (updated?.parsed_at !== beforeParsedAt) {
          // Compute which fields changed
          const newExt = updated.extracted_data || {}
          const changed = Object.keys(newExt).filter(k => {
            if (k === 'validation') return false
            return String(newExt[k]) !== String(beforeExt[k] ?? '')
          })
          setAiUpdated(a => ({ ...a, [policyId]: changed }))
          initFromTenant(fresh)
          break
        }
        if (i === 19) initFromTenant(fresh)
      }
    } catch (e) { setError(e.message) }
    finally { setRunningAiId(null) }
  }



  async function handleRemoveOwner() {
    const who = tenant?.name || 'this owner'
    const where = tenant?.unit_number ? `Unit ${tenant.unit_number}` : 'this unit'
    if (!window.confirm(
      `Remove ${who} from ${where}? Their policies and alert history will be deleted. ` +
      `The unit itself stays and can be re-invited. This cannot be undone.`
    )) return
    setRemovingOwner(true)
    try {
      await apiDelete(`/tenant/${tenantId}`)
      navigate('/admin/dashboard')
    } catch (e) {
      setError(e.message)
      setRemovingOwner(false)
    }
  }

  async function handleDeletePolicy(policyId) {
    if (policyId.startsWith('draft-')) {
      setDrafts(ds => ds.filter(d => d._draftId !== policyId)); return
    }
    if (!window.confirm('Delete this policy record? This cannot be undone.')) return
    setDeletingId(policyId)
    try {
      await apiDelete(`/policy/${policyId}`)
      setTenant(t => ({ ...t, policies: t.policies.filter(p => p.id !== policyId) }))
    } catch (e) { setError(e.message) }
    finally { setDeletingId(null) }
  }

  const newDraftRef = useRef(null)

  // When a required policy is missing (e.g. HO-6 after a wind-only upload),
  // scroll down so the Add Policy button is visible
  const scrolledToAddRef = useRef(false)
  useEffect(() => {
    if ((needsHo6Policy || needsWindPolicy) && !scrolledToAddRef.current) {
      scrolledToAddRef.current = true
      setTimeout(() => {
        document.getElementById('add-policy-btn')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 300)
    }
  }, [needsHo6Policy, needsWindPolicy])

  function handleAddPolicy() {
    const id = `draft-${++_draftCounter}`
    setDrafts(ds => [...ds, {
      _draftId: id, coverage_type: 'ho6_wind_excluded', insurer: '', policy_number: '',
      expiration_date: '', effective_date: '', dwelling_coverage: '', liability_coverage: '',
      named_insured: '', additional_insured: '', additional_interests: '',
      association_listed: false, document_url: '', uploaded_at: '',
    }])
    const scrollWhenReady = () => {
      const el = document.getElementById('new-draft-card')
      if (el) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
      } else {
        setTimeout(scrollWhenReady, 100)
      }
    }
    setTimeout(scrollWhenReady, 100)
  }

  async function doSave(overridePolicyForms, overrideDrafts) {
    const pf = overridePolicyForms ?? policyForms
    const dr = overrideDrafts ?? drafts
    setSaving(true); setSaveMsg('')
    try {
      // 1. Save tenant / unit fields
      // Strip the " Unit XXXX" suffix from street_address before saving so the DB
      // stores only the base address — the unit number lives in its own column
      const unitNumber = tenant?.unit_number
      const cleanStreetAddress = unitNumber
        ? form.street_address.replace(new RegExp(`\\s*Unit\\s+${unitNumber}`, 'gi'), '').trim()
        : form.street_address
      try {
        const tenantPayload = { ...form, street_address: cleanStreetAddress }
        // The login email column is NOT NULL. If the field is cleared, store a
        // hidden @condo.insure placeholder (shown as blank) so the email is
        // effectively removed; if it was already a placeholder, leave it as-is.
        if (!tenantPayload.email) {
          if ((tenant?.email || '').toLowerCase().endsWith('@condo.insure')) {
            delete tenantPayload.email
          } else {
            tenantPayload.email = `cleared+${Date.now()}@condo.insure`
          }
        }
        await apiPatch(`/tenant/${tenantId}`, tenantPayload)
      } catch (e) { throw new Error(`[tenant] ${e.message}`) }

      // 1b. Save unit-owner names/emails (on-title owners)
      if (tenant?.unit_id) {
        try {
          await apiPatch(`/unit/${tenant.unit_id}/owner`, ownerForm)
        } catch (e) { throw new Error(`[unit owner] ${e.message}`) }
      }

      // 2. Save HOA requirements if changed
      if (tenant?.hoa_id) {
        const reqPayload = {}
        if (tenant.is_renter) {
          if (reqForm.ho4_liability_min !== '' && Number(reqForm.ho4_liability_min) !== (tenant.ho4_liability_min ?? ''))
            reqPayload.ho4_liability_min = Number(reqForm.ho4_liability_min)
        } else {
          if (reqForm.coverage_a_min !== '' && Number(reqForm.coverage_a_min) !== (tenant.ho6_coverage_a_min ?? ''))
            reqPayload.ho6_coverage_a_min = Number(reqForm.coverage_a_min)
          if (reqForm.coverage_e_min !== '' && Number(reqForm.coverage_e_min) !== (tenant.ho6_coverage_e_min ?? ''))
            reqPayload.ho6_coverage_e_min = Number(reqForm.coverage_e_min)
        }
        if (Object.keys(reqPayload).length) {
          try {
            await apiPatch(`/hoa/${tenant.hoa_id}/requirements`, reqPayload)
          } catch (e) { throw new Error(`[hoa requirements] ${e.message}`) }
        }
      }

      // 3. Save edits to existing policies (skip stale IDs not in current tenant data)
      const knownPolicyIds = new Set((tenant?.policies || []).map(p => p.id))
      for (const [policyId, pfItem] of Object.entries(pf)) {
        if (!knownPolicyIds.has(policyId)) continue
        try {
          await apiPatch(`/policy/${policyId}`, {
            insurer: pfItem.insurer || null,
            policy_number: pfItem.policy_number || null,
            expiration_date: pfItem.expiration_date || null,
            effective_date: pfItem.effective_date || null,
            coverage_type: pfItem.coverage_type || null,
            dwelling_coverage: pfItem.dwelling_coverage !== '' ? Number(pfItem.dwelling_coverage) : null,
            liability_coverage: pfItem.liability_coverage !== '' ? Number(pfItem.liability_coverage) : null,
            named_insured: pfItem.named_insured || null,
            additional_insured: pfItem.additional_insured || null,
            additional_interests: pfItem.additional_interests || null,
            association_listed: pfItem.association_listed,
            document_url: pfItem.document_url || null,
          })
        } catch (e) { throw new Error(`[policy ${policyId}] ${e.message}`) }
      }

      // 4. Create draft policies
      for (const draft of dr) {
        if (!draft.document_url && !draft.policy_number && !draft.insurer) continue
        try {
          await apiPost(`/unit/${tenant.unit_id}/policy`, {
            insurer: draft.insurer || null,
            policy_number: draft.policy_number || null,
            expiration_date: draft.expiration_date || null,
            document_url: draft.document_url || null,
          })
        } catch (e) { throw new Error(`[new policy] ${e.message}`) }
      }
      setDrafts([])

      // Refresh
      const fresh = await apiGet(`/tenant/${tenantId}`)
      initFromTenant(fresh)
      setSaveMsg('Saved successfully.')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (e) {
      setSaveMsg('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    await doSave()
  }

  // Called by PolicyEditCard after a file is uploaded — autosaves then auto-triggers AI extraction
  async function handleDocumentUploaded(policyId, documentUrl, isDraft) {
    let updatedForms = policyForms
    let updatedDrafts = drafts

    if (isDraft) {
      updatedDrafts = drafts.map(d =>
        d._draftId === policyId ? { ...d, document_url: documentUrl } : d
      )
      setDrafts(updatedDrafts)
    } else {
      updatedForms = {
        ...policyForms,
        [policyId]: { ...policyForms[policyId], document_url: documentUrl },
      }
      setPolicyForms(updatedForms)
    }

    await doSave(updatedForms, updatedDrafts)

    // After save, find any policies that now have a document but no parsed_at and auto-run AI
    const fresh = await apiGet(`/tenant/${tenantId}`)
    const toExtract = (fresh.policies || []).filter(p => p.document_url && !p.parsed_at)
    for (const p of toExtract) {
      handleRunAi(p.id)
    }
  }

  async function handleSendReminder() {
    setNotifying(true)
    try {
      await apiPost(`/tenant/${tenantId}/notify`, { message: null })
      setSaveMsg('Reminder sent.')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (e) { setError(e.message) }
    finally { setNotifying(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const headerName = form.name || tenant?.name || ''
  const headerUnit = tenant?.unit_number ? `Unit ${tenant.unit_number}` : ''

  // ── Next-steps panel ────────────────────────────────────────────────────────
  const unparsedPolicies = (tenant?.policies || []).filter(p => p.document_url && !p.parsed_at && p.is_current)
  const aiRunning = !!runningAiId

  const nextSteps = []
  if (!tenant) {
    // loading
  } else if (aiRunning) {
    nextSteps.push({ icon: '⏳', text: 'AI is extracting policy details — this usually takes 10–20 seconds…', wait: true })
  } else if (currentPolicies.length === 0 && drafts.length === 0) {
    nextSteps.push({ icon: '📋', text: 'Click "+ Add policy" to upload the unit owner\'s insurance policy.' })
  } else if (hasLapsedPolicy && !drafts.length) {
    nextSteps.push({ icon: '🔄', text: 'Policy is expired — click "+ Add renewal policy" to upload the new term.' })
  } else if (drafts.length > 0) {
    const hasDoc = drafts.some(d => d.document_url)
    nextSteps.push({ icon: '✅', text: 'Policy card added.', done: true })
    if (!hasDoc) nextSteps.push({ icon: '📄', text: 'Upload the declaration page by clicking on the yellow UPLOAD box in the policy card.' })
    else {
      nextSteps.push({ icon: '✅', text: 'Document uploaded.', done: true })
      nextSteps.push({ icon: '⏳', text: 'AI extraction starting automatically…', wait: true })
    }
    const hasAllFields = drafts.every(d => d.insurer && d.policy_number && d.expiration_date && d.named_insured)
    if (hasDoc && hasAllFields) nextSteps.push({ icon: '💾', text: 'Review the extracted fields then click "Save" to confirm.' })
  } else if (unparsedPolicies.length > 0) {
    nextSteps.push({ icon: '🤖', text: 'Document uploaded — click "Extract with AI" to auto-fill policy details.' })
  } else if (needsWindPolicy) {
    nextSteps.push({ icon: '💨', text: 'Association requires wind coverage — click "+ Add wind policy" to upload a separate wind-only policy.' })
  } else if (complianceChecks.some(c => c.type === 'fail')) {
    complianceChecks.filter(c => c.type === 'fail').forEach(f => nextSteps.push({ icon: '⚠️', text: f.text }))
  } else if (tenant) {
    nextSteps.push({ icon: '🎉', text: "You're all done! This unit is now compliant.", success: true })
  }

  // Next Steps helper: a small tappable pill on mobile (it was eating the
  // screen as a full-width sheet); the full panel on desktop
  const isMobile = useIsMobile()
  const [helperExpanded, setHelperExpanded] = useState(false)

  // When the unit transitions to compliant, scroll to the top so the green status card is visible
  const isCompliantNow = !!nextSteps[0]?.success
  const wasCompliantRef = useRef(isCompliantNow)
  useEffect(() => {
    if (isCompliantNow && !wasCompliantRef.current) {
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 400)
    }
    wasCompliantRef.current = isCompliantNow
  }, [isCompliantNow])

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      {nextSteps.length > 0 && (
        isMobile && !helperExpanded ? (
          <button
            onClick={() => setHelperExpanded(true)}
            className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-white text-sm font-semibold ${nextSteps[0]?.success ? 'bg-green-600' : 'bg-blue-600'}`}
          >
            {nextSteps[0]?.success ? '✓ Compliant' : 'Next Steps'}
            {!nextSteps[0]?.success && (
              <span className="bg-white/25 rounded-full px-1.5 text-xs">{nextSteps.filter(s => !s.done && !s.success).length}</span>
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
                <li key={i} className={`flex items-start gap-3 text-sm ${s.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                  <span className="text-base leading-snug">{s.icon}</span>
                  <span>
                    {!s.done && !s.success && <span className="font-semibold text-blue-700">{s.wait ? 'Wait: ' : 'Next: '}</span>}
                    {s.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-1">

        {/* ── Top nav ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between pb-5">
          <div className="flex items-start gap-4">
            <button type="button" onClick={() => navigate('/admin/dashboard')}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 border border-slate-200 bg-white rounded-lg px-3 py-1.5 hover:bg-slate-50 mt-0.5">
              ← Dashboard
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">
                {headerName}{headerUnit ? ` — ${headerUnit}` : ''}
              </h1>
              {formattedAddress && <p className="text-sm text-slate-500 mt-0.5">{formattedAddress}</p>}
            </div>
          </div>
          {QUOTE_FORM_URL && (
            <a
              href={tenant?.is_renter ? HO4_QUOTE_URL : QUOTE_FORM_URL}
              target="_blank" rel="noopener noreferrer"
              className="bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-lg whitespace-nowrap mt-0.5">
              Get a New {tenant?.is_renter ? 'HO-4' : 'HO-6'} Quote →
            </a>
          )}
        </div>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {!tenant && !error && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 h-28 animate-pulse" />
            <div className="bg-white rounded-xl border border-slate-200 h-52 animate-pulse" />
          </div>
        )}

        {tenant && (
          <form onSubmit={handleSave} className="space-y-6">

            {/* ── Status card ───────────────────────────────────────────────── */}
            <div className={`rounded-xl border p-5 ${ss.card}`}>
              <p className={`font-bold text-base mb-3 flex items-center gap-2 flex-wrap ${ss.text}`}>
                <span>{ss.icon}</span> {ss.label}
                {isExpiringSoon && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">Expiring Soon</span>}
              </p>
              {complianceChecks.length > 0 && (() => {
                const baseChecks = complianceChecks.filter(c => c.group !== 'rented')
                const rentedChecks = complianceChecks.filter(c => c.group === 'rented')
                const renderItem = (c, i) => (
                  <li key={i} className={`flex items-start gap-2 text-sm font-medium ${ss.bullet[c.type]}`}>
                    <span className="mt-0.5 flex-shrink-0">
                      {c.type === 'pass' ? '✓' : c.type === 'fail' ? '✗' : '⚠'}
                    </span>
                    {c.text}
                  </li>
                )
                return (
                  <>
                    {baseChecks.length > 0 && (
                      <ul className="space-y-1.5">{baseChecks.map(renderItem)}</ul>
                    )}
                    {rentedChecks.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-300/60">
                        <p className="text-sm font-semibold text-slate-700 mb-1.5">
                          This unit is flagged as RENTED — these are additional requirements:
                        </p>
                        <ul className="space-y-1.5">{rentedChecks.map(renderItem)}</ul>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            {/* ── Unit & Owner ──────────────────────────────────────────────── */}
            <div>
              <SectionLabel>Association Requirements</SectionLabel>
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">

                {/* Association name — owner details and address are managed on the association page */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FieldInput label="Association name"  value={tenant.hoa_name} readOnly />
                </div>

                {/* Coverage minimums — renters (HO-4) only care about liability */}
                <div className="pt-4 border-t border-slate-100">
                  {tenant.is_renter ? (
                    <CurrencyInput label="Min HO-4 Liability ($)" value={reqForm.ho4_liability_min}
                      onChange={v => setReqForm(r => ({ ...r, ho4_liability_min: v }))} placeholder="100000" />
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <CurrencyInput label="Min Coverage A (Dwelling) ($)" value={reqForm.coverage_a_min}
                        onChange={v => setReqForm(r => ({ ...r, coverage_a_min: v }))} placeholder="200000" />
                      <CurrencyInput label="Min Coverage E (Liability) ($)" value={reqForm.coverage_e_min}
                        onChange={v => setReqForm(r => ({ ...r, coverage_e_min: v }))} placeholder="100000" />
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* ── Policies ──────────────────────────────────────────────────── */}
            <div>
              <SectionLabel>Policies</SectionLabel>
              <div className="space-y-4">

                {/* Current policies */}
                {currentPolicies.map(p => (
                  <PolicyEditCard
                    key={p.id}
                    policyId={p.id}
                    form={policyForms[p.id] || {}}
                    onChange={(key, val) => pField(p.id, key, val)}
                    aiUpdated={aiUpdated[p.id] || []}
                    onRunAi={handleRunAi}
                    runningAiId={runningAiId}
                    onDelete={handleDeletePolicy}
                    deleting={deletingId === p.id}
                    isDraft={false}
                    unitId={tenant.unit_id}
                    onDocumentUploaded={handleDocumentUploaded}
                    windRequired={tenant.ho6_wind_required}
                    validationFlags={p.extracted_data?.validation?.passed === false ? (p.extracted_data.validation.flags || []) : []}
                  />
                ))}

                {/* Draft (new) policies */}
                {drafts.map((d, i) => (
                  <div key={d._draftId} id={i === drafts.length - 1 ? 'new-draft-card' : undefined}>
                  <PolicyEditCard
                    policyId={d._draftId}
                    form={d}
                    onChange={(key, val) => draftField(d._draftId, key, val)}
                    aiUpdated={[]}
                    onRunAi={() => {}}
                    runningAiId={null}
                    onDelete={handleDeletePolicy}
                    deleting={false}
                    isDraft={true}
                    unitId={tenant.unit_id}
                    onDocumentUploaded={handleDocumentUploaded}
                    windRequired={tenant.ho6_wind_required}
                  />
                  </div>
                ))}

                {/* Add policy */}
                <button type="button" id="add-policy-btn" onClick={handleAddPolicy}
                  className={`flex items-center gap-2 text-sm font-semibold rounded-xl px-5 py-3 w-full justify-center transition-colors ${
                    needsWindPolicy || needsHo6Policy
                      ? 'border-2 border-dashed border-red-400 bg-red-50 text-red-700 hover:bg-red-100'
                      : (currentPolicies.length === 0 && drafts.length === 0) || hasLapsedPolicy
                      ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                      : 'border-2 border-dashed border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}>
                  {tenant.is_renter ? '+ HO-4 policy' : needsWindPolicy ? '+ Add wind policy' : needsHo6Policy ? '+ Add HO-6 policy' : hasLapsedPolicy ? '+ Add renewal policy' : '+ HO-6 policy'}
                </button>

                {/* Lease upload — only for a flagged-rented owner unit */}
                {tenant.is_rental && !tenant.is_renter && (
                  <div>
                    <input ref={leaseInputRef} type="file" accept=".pdf,image/*" onChange={handleLeaseFile} className="hidden" />
                    <button type="button" onClick={() => leaseInputRef.current?.click()} disabled={leaseUploading}
                      className={`flex items-center gap-2 text-sm font-semibold rounded-xl px-5 py-3 w-full justify-center transition-colors disabled:opacity-60 ${
                        tenant.has_lease
                          ? 'border-2 border-dashed border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                          : 'border-2 border-dashed border-red-400 bg-red-50 text-red-700 hover:bg-red-100'
                      }`}>
                      {leaseUploading ? 'Uploading…' : tenant.has_lease ? '↻ Replace lease' : '+ Add lease'}
                    </button>
                    {tenant.has_lease && (
                      <p className="text-xs text-slate-400 mt-1 text-center">Lease on file — we read it to fill in the renter's details.</p>
                    )}
                    {leaseErr && <p className="text-xs text-red-600 mt-1 text-center">{leaseErr}</p>}

                    {tenant.has_lease && tenant.lease_summary && (() => {
                      const ls = tenant.lease_summary
                      const tenants = Array.isArray(ls.tenant_names) ? ls.tenant_names.filter(Boolean) : []
                      const emails = Array.isArray(ls.tenant_emails) ? ls.tenant_emails.filter(Boolean) : []
                      const landlords = Array.isArray(ls.landlord_names) ? ls.landlord_names.filter(Boolean) : []
                      const rows = [
                        ['Lessor', landlords.join(', ')],
                        ['Lessee', tenants[0]],
                        ['Lessees', tenants.length > 1 ? tenants.join(', ') : ''],
                        ['Lessee Emails', emails.join(', ')],
                        ['Effective Date', ls.lease_start],
                        ['Expiration Date', ls.lease_end],
                      ].filter(([, v]) => v)
                      return (
                        <div className="mt-3 bg-white rounded-xl border border-slate-200 overflow-hidden">
                          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Lease Summary</p>
                            {tenant.lease_document_url && (
                              <a href={tenant.lease_document_url} target="_blank" rel="noopener noreferrer"
                                className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap">
                                View lease ↗
                              </a>
                            )}
                          </div>
                          <table className="w-full text-sm">
                            <tbody className="divide-y divide-slate-100">
                              {rows.map(([label, value]) => (
                                <tr key={label}>
                                  <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap align-top w-1/3">{label}</td>
                                  <td className="px-5 py-2.5 text-slate-800 font-medium">{value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}

                    {/* Renter's HO-4 policy — attached to the linked sub-unit */}
                    {tenant.renter_unit_id && (
                      <div className="mt-3">
                        <input ref={ho4InputRef} type="file" accept=".pdf,image/*" onChange={handleHo4File} className="hidden" />
                        <button type="button" onClick={() => ho4InputRef.current?.click()} disabled={ho4Uploading}
                          className="flex items-center gap-2 text-sm font-semibold rounded-xl px-5 py-3 w-full justify-center transition-colors border-2 border-dashed border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                          {ho4Uploading ? 'Uploading…' : "+ Add HO-4 policy (renter)"}
                        </button>
                        {ho4Msg && (
                          <p className="text-xs text-green-700 mt-1 text-center">
                            {ho4Msg}{' '}
                            {ho4TenantId && (
                              <button type="button" onClick={() => navigate(`/admin/tenant/${ho4TenantId}`)}
                                className="text-blue-600 hover:underline">View renter →</button>
                            )}
                          </p>
                        )}
                        {ho4Err && <p className="text-xs text-red-600 mt-1 text-center">{ho4Err}</p>}
                      </div>
                    )}
                  </div>
                )}

                {/* History */}
                {historyPolicies.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Policy history</p>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {historyPolicies.map(p => (
                        <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                          <div>
                            <span className="font-medium text-slate-700">
                              {COVERAGE_TYPE_OPTIONS.find(o => o.value === p.coverage_type)?.label || 'Policy'}
                            </span>
                            {(p.insurer || p.policy_number) && (
                              <span className="text-slate-400 ml-2 text-xs">{[p.insurer, p.policy_number].filter(Boolean).join(' · ')}</span>
                            )}
                            {p.expiration_date && (
                              <span className="text-slate-400 ml-2 text-xs">exp {fmtDate(String(p.expiration_date).slice(0, 10))}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{p.superseded_by ? 'Superseded' : 'Expired'}</span>
                            {p.document_url && (
                              <a href={p.document_url} target="_blank" rel="noopener noreferrer"
                                className="text-blue-600 hover:underline text-xs">View</a>
                            )}
                            <button type="button" onClick={() => handleDeletePolicy(p.id)} disabled={deletingId === p.id}
                              className="text-red-500 hover:underline text-xs disabled:opacity-50">
                              {deletingId === p.id ? '…' : 'Delete'}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* ── Footer — sticky so Save is always reachable on long pages ── */}
            <div className="sticky bottom-0 z-40 -mx-4 px-4 py-3 bg-slate-50/95 backdrop-blur border-t border-slate-200 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" onClick={handleSendReminder} disabled={notifying}
                  className="flex items-center gap-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium px-5 py-2.5 rounded-lg disabled:opacity-60">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {notifying ? 'Sending…' : 'Send reminder ↗'}
                </button>
              </div>
              <div className="text-right">
                {saveMsg && (
                  <p className={`text-sm font-medium ${saveMsg.startsWith('Save failed') ? 'text-red-600' : 'text-green-600'}`}>
                    {saveMsg}
                  </p>
                )}
                {!saveMsg && lastUpdated && (
                  <p className="text-xs text-slate-400">Last updated {fmtDateTime(lastUpdated)}</p>
                )}
              </div>
            </div>

            {/* ── Activity log ─────────────────────────────────────────────── */}
            {tenant.activity_log?.length > 0 && (
              <div>
                <SectionLabel>Activity log</SectionLabel>
                <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {tenant.activity_log.map(entry => (
                    <div key={entry.id} className="flex gap-3 px-5 py-3">
                      <div className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-slate-700">{entry.description}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {fmtDateTime(entry.timestamp)}
                          {entry.actor && ` · by ${entry.actor}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </form>
        )}
      </main>
    </div>
  )
}
