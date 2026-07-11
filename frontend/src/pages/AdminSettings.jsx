import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import { apiGet, apiPut, apiPost, apiDelete } from '../supabase'
import { useAuth } from '../context/AuthContext'
import BillingPanel from '../components/BillingPanel'
import PmBillingPanel from '../components/PmBillingPanel'
import PmTeamPanel from '../components/PmTeamPanel'

// Billing stays hidden until switched on (set VITE_BILLING_ENABLED=true).
const BILLING_ENABLED = import.meta.env.VITE_BILLING_ENABLED === 'true'
// Subrental requirements stay hidden until the rentals feature is switched on.
const RENTALS_ENABLED = import.meta.env.VITE_RENTALS_ENABLED === 'true'

const HOA_FIELD_OPTIONS = {
  name: { label: 'Association Name', key: 'name' },
  dpbr_license_number: { label: 'DPBR Lic #', key: 'dpbr_license_number' },
  fein: { label: 'FEIN #', key: 'fein' },
  corp_name: { label: 'Corp Name (SunBiz)', key: 'corp_name' },
  sunbiz_doc_number: { label: 'SunBiz DOC #', key: 'sunbiz_doc_number' },
}

// Email-preview rows: owner (HO-6) emails, then renter (HO-4) emails.
const PREVIEW_ROWS = [
  { label: 'Owners', items: [
    { key: 'invite', label: 'Invite' },
    { key: 'non_compliant', label: 'Non-Compliant' },
    { key: 'renewal_30', label: 'Renewal 30' },
    { key: 'renewal_7', label: 'Renewal 7' },
    { key: 'renewal_1', label: 'Renewal 1' },
    { key: 'expired', label: 'Expired Policy' },
  ] },
  { label: 'Renters', items: [
    { key: 'renter_invite', label: 'Invite' },
    { key: 'renter_non_compliant', label: 'Non-Compliant' },
    { key: 'renter_renewal_30', label: 'Renewal 30' },
    { key: 'renter_renewal_7', label: 'Renewal 7' },
    { key: 'renter_renewal_1', label: 'Renewal 1' },
    { key: 'renter_expired', label: 'Expired Policy' },
    { key: 'lease_expiration', label: 'Lease Expiration' },
  ] },
]

const ALL_HOAS = '__all__'

export default function AdminSettings() {
  const { hoaId, role, availableHoas, setSelectedHoaId } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  // Association picker (super users / PMs) — mirrors the Dashboard & Documents pages
  const [hoaFieldType, setHoaFieldType] = useState('name')
  const [hoaFieldValue, setHoaFieldValue] = useState('')

  // PM-firm directory (super users): groups the switcher by firm and powers
  // the firms card on the all-associations view.
  const [firms, setFirms] = useState([])
  useEffect(() => {
    if (role === 'super_user') apiGet('/firms').then(setFirms).catch(() => {})
  }, [role])
  const firmHoaIds = new Set(firms.flatMap(f => f.hoas.map(h => h.id)))
  const independentHoas = [...availableHoas]
    .filter(h => !firmHoaIds.has(h.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  const hoaFieldValues = (() => {
    const key = HOA_FIELD_OPTIONS[hoaFieldType]?.key
    const seen = new Set()
    const vals = []
    for (const h of availableHoas) {
      const v = h[key]
      if (v && !seen.has(v)) { seen.add(v); vals.push(v) }
    }
    return vals
  })()

  function handleHoaFieldValueChange(value) {
    setHoaFieldValue(value)
    if (value === ALL_HOAS) { setSelectedHoaId(ALL_HOAS); return }
    const key = HOA_FIELD_OPTIONS[hoaFieldType]?.key
    const match = availableHoas.find(h => h[key] === value)
    if (match) setSelectedHoaId(match.id)
  }

  // Add-a-unit state
  const [unitForm, setUnitForm] = useState({ unit_number: '', street_address: '', city: '', state: '', zip: '', owner_primary: '', email_primary: '' })
  const [addingUnit, setAddingUnit] = useState(false)
  const [unitMsg, setUnitMsg] = useState('')
  const [showAddUnit, setShowAddUnit] = useState(false)
  const [emailPreviews, setEmailPreviews] = useState(null)
  const [previewKind, setPreviewKind] = useState(null)
  const [contacts, setContacts] = useState(null)
  const [infoPopup, setInfoPopup] = useState(null)  // { term, info } for the requirement help popups

  async function openEmailPreviews() {
    setPreviewKind('invite')
    if (!emailPreviews) {
      try { setEmailPreviews(await apiGet(`/hoa/${hoaId}/email-previews`)) }
      catch (err) { setError(err.message); setPreviewKind(null) }
    }
  }

  const [showDelete, setShowDelete] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function handleDeleteHoa() {
    setDeleting(true); setError('')
    try {
      await apiDelete(`/hoa/${hoaId}`)
      window.location.href = '/admin/dashboard'
    } catch (err) { setError(err.message); setDeleting(false) }
  }

  async function handleAddUnit(e) {
    e.preventDefault()
    if (!unitForm.unit_number.trim()) { setError('Unit number is required'); return }
    setAddingUnit(true); setError(''); setUnitMsg('')
    try {
      await apiPost(`/hoa/${hoaId}/units`, unitForm)
      setUnitMsg(`Unit ${unitForm.unit_number} added.`)
      setUnitForm({ unit_number: '', street_address: '', city: '', state: '', zip: '', owner_primary: '', email_primary: '' })
      setShowAddUnit(false)
      setTimeout(() => setUnitMsg(''), 4000)
    } catch (err) { setError(err.message) }
    finally { setAddingUnit(false) }
  }

  useEffect(() => {
    if (!hoaId || hoaId === ALL_HOAS) { setForm(null); setLoading(false); return }
    setLoading(true)
    apiGet('/hoas')
      .then(hoas => {
        const hoa = hoas.find(h => h.id === hoaId) || hoas[0]
        if (hoa) setForm({
          name: hoa.name || '',
          corp_name: hoa.corp_name || '',
          sunbiz_doc_number: hoa.sunbiz_doc_number || '',
          dpbr_license_number: hoa.dpbr_license_number || '',
          fein: hoa.fein || '',
          alerts_enabled: hoa.alerts_enabled ?? true,
          alert_days: hoa.alert_days?.length ? hoa.alert_days : [30, 7, 1],
          lapsed_reminders_enabled: hoa.lapsed_reminders_enabled ?? true,
          lapsed_reminder_days: hoa.lapsed_reminder_days ?? 7,
          noncompliant_reminders_enabled: hoa.noncompliant_reminders_enabled ?? true,
          noncompliant_reminder_days: hoa.noncompliant_reminder_days ?? 7,
          alert_lead_days: hoa.alert_lead_days ?? 30,
          ho6_coverage_a_min: hoa.ho6_coverage_a_min ?? '',
          ho6_coverage_e_min: hoa.ho6_coverage_e_min ?? '',
          ho6_wind_required: hoa.ho6_wind_required ?? false,
          ho6_additional_interest_required: hoa.ho6_additional_interest_required ?? false,
          ho6_policy_in_force_required: hoa.ho6_policy_in_force_required ?? true,
          ho6_named_insured_match_required: hoa.ho6_named_insured_match_required ?? true,
          ho6_property_address_match_required: hoa.ho6_property_address_match_required ?? true,
          ho4_liability_min: hoa.ho4_liability_min ?? '',
          rental_endorsement_required: hoa.rental_endorsement_required ?? true,
          lease_required: hoa.lease_required ?? false,
          lease_min_term_days: hoa.lease_min_term_days ?? '',
          ho4_required: hoa.ho4_required ?? false,
          invite_reminders_enabled: hoa.invite_reminders_enabled ?? true,
          invite_reminder_days: hoa.invite_reminder_days ?? 7,
          email_sender_role: hoa.email_sender_role ?? 'property_manager',
          email_sender_unit_id: hoa.email_sender_unit_id ?? '',
        })
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    apiGet(`/hoa/${hoaId}/contacts`).then(setContacts).catch(() => {})
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
        ho4_liability_min: form.ho4_liability_min !== '' ? Number(form.ho4_liability_min) : null,
        lease_min_term_days: form.lease_min_term_days !== '' ? Number(form.lease_min_term_days) : null,
        invite_reminder_days: Number(form.invite_reminder_days) || 7,
        email_sender_unit_id: form.email_sender_unit_id || null,
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
      <main className="max-w-[50rem] mx-auto px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-[#0B1B33]">Association Settings</h1>
            {!loading && form && (
              <button type="button" onClick={() => { setShowAddUnit(true); setUnitMsg('') }}
                className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 px-4 rounded-lg text-sm">
                + Add Unit
              </button>
            )}
          </div>
          {(role === 'super_user' || role === 'property_manager') && availableHoas.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              {/* Primary: pick any association by name (works for every HOA,
                  including signup-created ones with no PropRadar fields) */}
              <select
                value={hoaId || ''}
                onChange={e => { setHoaFieldValue(''); setSelectedHoaId(e.target.value) }}
                className="flex-1 min-w-0 border border-[#DCE3EC] rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
              >
                <option value={ALL_HOAS}>All Associations</option>
                {role === 'super_user' && firms.length > 0 ? (
                  <>
                    {firms.filter(f => f.hoas.length > 0).map(f => (
                      <optgroup key={f.id} label={`Firm: ${f.name}`}>
                        {f.hoas.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                      </optgroup>
                    ))}
                    <optgroup label="Independent">
                      {independentHoas.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </optgroup>
                  </>
                ) : (
                  [...availableHoas].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                    .map(h => <option key={h.id} value={h.id}>{h.name}</option>)
                )}
              </select>
              <span className="text-xs text-[#8493A8] flex-shrink-0">or search by</span>
              <select
                value={hoaFieldType}
                onChange={e => { setHoaFieldType(e.target.value); setHoaFieldValue('') }}
                className="flex-shrink-0 border border-[#DCE3EC] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
              >
                {Object.entries(HOA_FIELD_OPTIONS).map(([key, opt]) => (
                  <option key={key} value={key}>{opt.label}</option>
                ))}
              </select>
              <select
                value={hoaFieldValue}
                onChange={e => handleHoaFieldValueChange(e.target.value)}
                className="flex-1 min-w-0 border border-[#DCE3EC] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
              >
                <option value="">Select {HOA_FIELD_OPTIONS[hoaFieldType]?.label}…</option>
                <option value={ALL_HOAS}>All</option>
                {hoaFieldValues.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {unitMsg && <p className="text-sm text-[#0E8E68] mb-4">{unitMsg}</p>}

        {loading && <div className="bg-white rounded-xl border border-[#E8ECF2] h-40 animate-pulse" />}

        {!loading && hoaId === ALL_HOAS && role === 'property_manager' && <PmTeamPanel />}

        {BILLING_ENABLED && !loading && hoaId === ALL_HOAS && role === 'property_manager' && <PmBillingPanel />}

        {!loading && hoaId === ALL_HOAS && role === 'super_user' && firms.length > 0 && (
          <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6 mb-6">
            <p className="font-semibold text-[#0B1B33]">PM Firms</p>
            <p className="text-xs text-[#54627A] mt-1 mb-3">
              Property-management firms and the associations they manage. Click an association to open its settings.
            </p>
            <div className="border border-[#E8ECF2] rounded-lg divide-y divide-[#E8ECF2]">
              {firms.map(f => (
                <div key={f.id} className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-[#0B1B33]">{f.name}</p>
                    <p className="text-xs text-[#8493A8] truncate">{f.members.join(', ')}</p>
                  </div>
                  {f.hoas.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {f.hoas.map(h => (
                        <button key={h.id} type="button" onClick={() => setSelectedHoaId(h.id)}
                          className="text-xs bg-[#EEF3FB] text-[#014AC5] hover:bg-[#DCE7F8] rounded px-2 py-0.5">
                          {h.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#8493A8] mt-1">No associations yet</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && hoaId === ALL_HOAS && (
          <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-8 text-center text-[#54627A]">
            Select a single association above to view and edit its settings.
          </div>
        )}

        {showAddUnit && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
              <h2 className="font-semibold text-[#0B1B33] mb-1">Add a Unit</h2>
              <p className="text-xs text-[#54627A] mb-4">Adds a new unit to this association. You can invite the owner afterward from the dashboard.</p>
              <form onSubmit={handleAddUnit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[#0B1B33] mb-1">Unit number <span className="text-[#C0492F]">*</span></label>
                    <input value={unitForm.unit_number} onChange={e => setUnitForm(f => ({ ...f, unit_number: e.target.value }))}
                      placeholder="e.g. 101"
                      className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#0B1B33] mb-1">Street address</label>
                    <input value={unitForm.street_address} onChange={e => setUnitForm(f => ({ ...f, street_address: e.target.value }))}
                      placeholder="123 Ocean Dr"
                      className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#0B1B33] mb-1">City</label>
                    <input value={unitForm.city} onChange={e => setUnitForm(f => ({ ...f, city: e.target.value }))}
                      className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-[#0B1B33] mb-1">State</label>
                      <input value={unitForm.state} maxLength={2} onChange={e => setUnitForm(f => ({ ...f, state: e.target.value }))}
                        placeholder="FL"
                        className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#0B1B33] mb-1">Zip</label>
                      <input value={unitForm.zip} onChange={e => setUnitForm(f => ({ ...f, zip: e.target.value }))}
                        className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#0B1B33] mb-1">Owner name</label>
                    <input value={unitForm.owner_primary} onChange={e => setUnitForm(f => ({ ...f, owner_primary: e.target.value }))}
                      className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#0B1B33] mb-1">Owner email</label>
                    <input type="email" value={unitForm.email_primary} onChange={e => setUnitForm(f => ({ ...f, email_primary: e.target.value }))}
                      className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={addingUnit}
                    className="flex-1 bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60">
                    {addingUnit ? 'Adding…' : 'Add Unit'}
                  </button>
                  <button type="button" onClick={() => setShowAddUnit(false)}
                    className="flex-1 border border-[#DCE3EC] text-[#54627A] font-semibold py-2 rounded-lg text-sm hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {BILLING_ENABLED && !loading && form && <BillingPanel hoaId={hoaId} />}

        {!loading && form && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6 space-y-4">
              <p className="font-semibold text-[#0B1B33]">Association Info</p>
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-3">
                  <label className="block text-sm font-medium text-[#0B1B33] mb-1">Association Name</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0B1B33] mb-1">FEIN #</label>
                  <input
                    type="text"
                    value={form.fein}
                    onChange={e => setForm(f => ({ ...f, fein: e.target.value }))}
                    placeholder="e.g. 12-3456789"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#0B1B33] mb-1">DPBR Lic #</label>
                  <input
                    type="text"
                    value={form.dpbr_license_number}
                    onChange={e => setForm(f => ({ ...f, dpbr_license_number: e.target.value }))}
                    placeholder="e.g. CAM1234567"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[#0B1B33] mb-1">SunBiz Corp Name</label>
                  <input
                    type="text"
                    value={form.corp_name}
                    onChange={e => setForm(f => ({ ...f, corp_name: e.target.value }))}
                    placeholder="e.g. Seaside Towers Condominium Association, Inc."
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0B1B33] mb-1">SunBiz DOC #</label>
                  <input
                    type="text"
                    value={form.sunbiz_doc_number}
                    onChange={e => setForm(f => ({ ...f, sunbiz_doc_number: e.target.value }))}
                    placeholder="e.g. N12000012345"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6">
              <p className="font-semibold text-[#0B1B33]">Email Previews</p>
              <p className="text-xs text-[#54627A] mt-1 mb-3">See exactly what unit owners receive.</p>
              <div className="flex flex-col gap-3">
                {PREVIEW_ROWS.map(row => (
                  <div key={row.label}>
                    <p className="text-[11px] font-semibold text-[#8493A8] uppercase tracking-widest mb-1">{row.label}</p>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {row.items.map(b => (
                        <button key={b.key} type="button"
                          onClick={async () => { await openEmailPreviews(); setPreviewKind(b.key) }}
                          className="border border-[#DCE3EC] text-[#0B1B33] hover:bg-slate-50 font-medium py-2 px-4 rounded-lg text-sm whitespace-nowrap flex-shrink-0">
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Who owner emails are sent from */}
              <div className="pt-4 mt-4 border-t border-[#E8ECF2]">
                <p className="text-sm font-medium text-[#0B1B33] mb-2">Send owner emails from</p>
                {(() => {
                  const pms = contacts?.property_managers || []
                  const board = contacts?.board_members || []
                  // The currently selected contact (from either list) for the email warning
                  const selectedUnitId = form.email_sender_role === 'property_manager'
                    ? (form.email_sender_unit_id || (pms.length === 1 ? pms[0].unit_id : ''))
                    : form.email_sender_unit_id
                  const selected = [...pms, ...board].find(c => c.unit_id === selectedUnitId)
                  const noEmail = selected && !selected.email
                  return (
                  <>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm text-[#0B1B33]">
                      <input type="radio" name="email_sender_role" value="property_manager"
                        checked={form.email_sender_role === 'property_manager'}
                        onChange={() => setForm(f => ({ ...f, email_sender_role: 'property_manager', email_sender_unit_id: '' }))}
                        className="border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]" />
                      Property Manager
                    </label>
                    {form.email_sender_role === 'property_manager' && pms.length > 1 && (
                      <select
                        value={form.email_sender_unit_id || ''}
                        onChange={e => setForm(f => ({ ...f, email_sender_unit_id: e.target.value }))}
                        className="ml-6 w-full sm:w-96 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5] bg-white">
                        <option value="">Select a property manager…</option>
                        {pms.map(pm => (
                          <option key={pm.unit_id} value={pm.unit_id}>
                            {pm.name || 'Unnamed'}{pm.email ? ` (${pm.email})` : ' (no email)'}
                          </option>
                        ))}
                      </select>
                    )}
                    {form.email_sender_role === 'property_manager' && pms.length === 1 && (
                      <p className="text-xs text-[#8493A8] ml-6">{pms[0].name || 'Property Manager'}{pms[0].email ? ` · ${pms[0].email}` : ''}</p>
                    )}
                    {form.email_sender_role === 'property_manager' && pms.length === 0 && (
                      <p className="text-xs text-[#946410] ml-6">No property manager on this association yet — add one from the dashboard.</p>
                    )}

                    <label className="flex items-center gap-2 text-sm text-[#0B1B33]">
                      <input type="radio" name="email_sender_role" value="board_member"
                        checked={form.email_sender_role === 'board_member'}
                        onChange={() => setForm(f => ({ ...f, email_sender_role: 'board_member', email_sender_unit_id: '' }))}
                        className="border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]" />
                      Specific Board Member
                    </label>
                    {form.email_sender_role === 'board_member' && (
                      board.length > 0 ? (
                        <select
                          value={form.email_sender_unit_id || ''}
                          onChange={e => setForm(f => ({ ...f, email_sender_unit_id: e.target.value }))}
                          className="ml-6 w-full sm:w-96 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5] bg-white">
                          <option value="">Select a board member…</option>
                          {board.map(bm => (
                            <option key={bm.unit_id} value={bm.unit_id}>
                              {bm.title ? `${bm.title} — ` : ''}{bm.name || 'Unnamed'}{bm.email ? ` (${bm.email})` : ' (no email)'}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-[#946410] ml-6">No board members on this association yet — set a board title on a unit first.</p>
                      )
                    )}
                  </div>
                  {noEmail && (
                    <p className="text-xs text-[#C0492F] mt-2 font-medium">
                      ⚠ {selected.name || 'This contact'} has no email address on file. Add one (Edit Owner Info on their unit) — it's used as the reply-to on owner emails.
                    </p>
                  )}
                  <p className="text-xs text-[#8493A8] mt-2">Owner emails will show this person as the reply-to contact.</p>
                  </>
                  )
                })()}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6 space-y-4">
              <p className="font-semibold text-[#0B1B33]">Email Alert Settings</p>

              {/* INVITE */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-[#0B1B33]">
                  <input
                    type="checkbox"
                    checked={form.invite_reminders_enabled}
                    onChange={e => setForm(f => ({ ...f, invite_reminders_enabled: e.target.checked }))}
                    className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]"
                  />
                  INVITE: Auto-resend invites to owners who haven't accepted yet
                </label>
                {form.invite_reminders_enabled && (
                  <div className="flex items-center gap-3 mt-2 ml-6">
                    <span className="text-sm text-[#54627A]">Re-send every</span>
                    <input
                      type="number" min="1" max="90" step="1"
                      value={form.invite_reminder_days}
                      onChange={e => setForm(f => ({ ...f, invite_reminder_days: e.target.value }))}
                      className="w-20 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                    />
                    <span className="text-sm text-[#54627A]">days until they respond</span>
                  </div>
                )}
                <p className="text-xs text-[#8493A8] mt-1 ml-6">Default is 7. Any unit with an email and a pending (unaccepted) invite is re-invited on this cadence.</p>
              </div>

              {/* NON-COMPLIANT */}
              <div className="pt-4 border-t border-slate-100">
                <label className="flex items-center gap-2 text-sm font-medium text-[#0B1B33]">
                  <input
                    type="checkbox"
                    checked={form.noncompliant_reminders_enabled}
                    onChange={e => setForm(f => ({ ...f, noncompliant_reminders_enabled: e.target.checked }))}
                    className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]"
                  />
                  NON-COMPLIANT: If a unit owner is Active · Non-Compliant, keep reminding them
                </label>
                {form.noncompliant_reminders_enabled && (
                  <div className="flex items-center gap-3 mt-2 ml-6">
                    <span className="text-sm text-[#54627A]">Re-send every</span>
                    <input
                      type="number" min="1" max="90" step="1"
                      value={form.noncompliant_reminder_days}
                      onChange={e => setForm(f => ({ ...f, noncompliant_reminder_days: e.target.value }))}
                      className="w-20 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                    />
                    <span className="text-sm text-[#54627A]">days until compliant</span>
                  </div>
                )}
                <p className="text-xs text-[#8493A8] mt-1 ml-6">Default is 7. Reminders stop once the policy meets all requirements.</p>
              </div>

              {/* RENEWAL */}
              <div className="pt-4 border-t border-slate-100">
                <label className="flex items-center gap-2 text-sm font-medium text-[#0B1B33]">
                  <input
                    type="checkbox"
                    checked={form.alerts_enabled}
                    onChange={e => setForm(f => ({ ...f, alerts_enabled: e.target.checked }))}
                    className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]"
                  />
                  RENEWAL: Send renewal alerts to unit owners
                </label>
                {form.alerts_enabled && (
                  <>
                    <div className="flex flex-col gap-2 mt-2 ml-6 pl-3 border-l-2 border-slate-100">
                      {[30, 7, 1].map(d => (
                        <label key={d} className="flex items-center gap-2 text-sm text-[#0B1B33]">
                          <input
                            type="checkbox"
                            checked={(form.alert_days || []).includes(d)}
                            onChange={e => setForm(f => {
                              const set = new Set(f.alert_days || [])
                              if (e.target.checked) set.add(d); else set.delete(d)
                              return { ...f, alert_days: [...set].sort((a, b) => b - a) }
                            })}
                            className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]"
                          />
                          {d} {d === 1 ? 'day' : 'days'} prior
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-[#8493A8] mt-2 ml-6">By default, unit owners receive emails 30 days, 7 days, and 1 day prior to their renewal.</p>
                  </>
                )}
              </div>

              {/* EXPIRED */}
              <div className="pt-4 border-t border-slate-100">
                <label className="flex items-center gap-2 text-sm font-medium text-[#0B1B33]">
                  <input
                    type="checkbox"
                    checked={form.lapsed_reminders_enabled}
                    onChange={e => setForm(f => ({ ...f, lapsed_reminders_enabled: e.target.checked }))}
                    className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]"
                  />
                  EXPIRED: If a policy has expired or lapsed, keep reminding the owner
                </label>
                {form.lapsed_reminders_enabled && (
                  <div className="flex items-center gap-3 mt-2 ml-6">
                    <span className="text-sm text-[#54627A]">Re-send every</span>
                    <input
                      type="number" min="1" max="90" step="1"
                      value={form.lapsed_reminder_days}
                      onChange={e => setForm(f => ({ ...f, lapsed_reminder_days: e.target.value }))}
                      className="w-20 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                    />
                    <span className="text-sm text-[#54627A]">days until they respond</span>
                  </div>
                )}
                <p className="text-xs text-[#8493A8] mt-1 ml-6">Default is 7. Reminders stop once the owner uploads a current policy.</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6 space-y-4">
              <p className="font-semibold text-[#0B1B33]">HO-6 Policy Requirements</p>
              <p className="text-xs text-[#54627A]">
                Changes apply immediately to all future compliance evaluations.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#0B1B33] mb-1">Coverage A (Dwelling) min</label>
                  <input
                    type="number" min="0" step="1000"
                    value={form.ho6_coverage_a_min}
                    onChange={e => setForm(f => ({ ...f, ho6_coverage_a_min: e.target.value }))}
                    placeholder="e.g. 50000"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0B1B33] mb-1">Coverage E (Liability) min</label>
                  <input
                    type="number" min="0" step="1000"
                    value={form.ho6_coverage_e_min}
                    onChange={e => setForm(f => ({ ...f, ho6_coverage_e_min: e.target.value }))}
                    placeholder="e.g. 300000"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
              </div>

              {[
                { key: 'ho6_policy_in_force_required', label: 'Require an in-force policy on file' },
                { key: 'ho6_named_insured_match_required', label: 'Require named insured to match unit-owner' },
                { key: 'ho6_property_address_match_required', label: 'Require property address to match unit' },
                { key: 'ho6_wind_required', label: 'Require wind coverage (HO6 with wind, or HO6 + separate wind-only policy)' },
                {
                  key: 'ho6_additional_interest_required',
                  label: 'Require association to be listed as Additional Interest',
                  term: 'Additional Interest',
                  info: 'Being listed as an Additional Interest on an HO-6 condo unit policy does not grant ownership rights or coverage rights under the policy. It is primarily a notification status. The insurance carriers will mail copies of the Dec Pages, Invoices, and Changes to the Association any time they mail the Insured.',
                },
              ].map(({ key, label, term, info }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-[#0B1B33]">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                    className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]"
                  />
                  {term && info ? (
                    <span>
                      {label.split(term)[0]}
                      <button
                        type="button"
                        onClick={e => { e.preventDefault(); e.stopPropagation(); setInfoPopup({ term, info }) }}
                        className="text-[#014AC5] underline decoration-dotted underline-offset-2 hover:text-[#0139a3]"
                      >
                        {term}
                      </button>
                      {label.split(term)[1]}
                    </span>
                  ) : label}
                </label>
              ))}

              {RENTALS_ENABLED && (
                <div className="mt-2 pt-4 border-t border-[#E8ECF2] space-y-3">
                  <p className="text-sm font-semibold text-[#0B1B33]">If a Unit is flagged as RENTED, require the following:</p>

                  <div>
                    <label className="flex items-center gap-2 text-sm text-[#0B1B33]">
                      <input
                        type="checkbox"
                        checked={form.lease_required}
                        onChange={e => setForm(f => ({ ...f, lease_required: e.target.checked }))}
                        className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]"
                      />
                      Require a copy of the Lease with minimum lease term
                    </label>
                    {form.lease_required && (
                      <div className="flex items-center gap-2 mt-2 ml-6">
                        <input
                          type="number" min="0" step="1"
                          value={form.lease_min_term_days}
                          onChange={e => setForm(f => ({ ...f, lease_min_term_days: e.target.value }))}
                          placeholder="e.g. 365"
                          className="w-28 border border-[#DCE3EC] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                        />
                        <span className="text-sm text-[#54627A]">days minimum</span>
                      </div>
                    )}
                  </div>

                  <label className="flex items-center gap-2 text-sm text-[#0B1B33]">
                    <input
                      type="checkbox"
                      checked={form.rental_endorsement_required}
                      onChange={e => setForm(f => ({ ...f, rental_endorsement_required: e.target.checked }))}
                      className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]"
                    />
                    <span>
                      Require HO-6 to carry an endorsement for{' '}
                      <button
                        type="button"
                        onClick={e => { e.preventDefault(); e.stopPropagation(); setInfoPopup({
                          term: 'Unit Rented to Others',
                          info: 'This endorsement provides liability protection to the owner while the unit is rented. Just as importantly, it serves as an acknowledgement that the insurance carrier knows the unit is being rented.',
                        }) }}
                        className="text-[#014AC5] underline decoration-dotted underline-offset-2 hover:text-[#0139a3]"
                      >
                        Unit Rented to Others
                      </button>
                    </span>
                  </label>

                  <label className="flex items-center gap-2 text-sm text-[#0B1B33]">
                    <input
                      type="checkbox"
                      checked={form.ho4_required}
                      onChange={e => setForm(f => ({ ...f, ho4_required: e.target.checked }))}
                      className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]"
                    />
                    Require Tenant to carry an HO-4 policy
                  </label>

                  <div>
                    <label className="block text-sm font-medium text-[#0B1B33] mb-1">Renter HO-4 Liability (Coverage E) min</label>
                    <input
                      type="number" min="0" step="1000"
                      value={form.ho4_liability_min}
                      onChange={e => setForm(f => ({ ...f, ho4_liability_min: e.target.value }))}
                      placeholder="e.g. 100000"
                      className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                    />
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-sm text-[#C0492F]">{error}</p>}
            {success && <p className="text-sm text-[#0E8E68]">Settings saved.</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </form>
        )}

        {infoPopup && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setInfoPopup(null)}>
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-semibold text-[#0B1B33]">{infoPopup.term}</h3>
                <button onClick={() => setInfoPopup(null)} className="text-[#8493A8] hover:text-[#54627A] text-xl leading-none flex-shrink-0">×</button>
              </div>
              <p className="text-sm text-[#54627A]">{infoPopup.info}</p>
            </div>
          </div>
        )}

        {previewKind && emailPreviews && emailPreviews[previewKind] && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setPreviewKind(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-[#E8ECF2] flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-[#8493A8]">Subject</p>
                  <p className="text-sm font-semibold text-[#0B1B33] truncate">{emailPreviews[previewKind].subject}</p>
                </div>
                <button onClick={() => setPreviewKind(null)} className="text-[#8493A8] hover:text-[#54627A] text-xl leading-none flex-shrink-0">×</button>
              </div>
              <div className="flex flex-col gap-1.5 px-3 pt-3">
                {PREVIEW_ROWS.map(row => (
                  <div key={row.label} className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] font-semibold text-[#8493A8] uppercase tracking-widest mr-1 w-14">{row.label}</span>
                    {row.items.map(b => (
                      <button key={b.key} type="button" onClick={() => setPreviewKind(b.key)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg ${previewKind === b.key ? 'bg-[#001842] text-white' : 'bg-slate-100 text-[#54627A] hover:bg-slate-200'}`}>
                        {b.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <iframe title="Email preview" srcDoc={emailPreviews[previewKind].html}
                className="flex-1 w-full border-0 mt-3" style={{ minHeight: '420px' }} />
            </div>
          </div>
        )}

        {/* Deleting an association is staff-only — a churned customer's data is
            retained (not destroyed) so they can be reactivated if they return. */}
        {!loading && form && role === 'super_user' && (
          <div className="bg-white rounded-xl border border-[#F0C4B4] shadow-sm p-6 mt-6">
            <p className="font-semibold text-[#C0492F]">Danger Zone</p>
            <p className="text-xs text-[#54627A] mt-1 mb-3">
              Permanently delete this association and all of its units, owners, policies, invites, and documents. This cannot be undone.
            </p>
            <button type="button" onClick={() => { setShowDelete(true); setDeleteConfirm('') }}
              className="border border-[#F0C4B4] text-[#C0492F] hover:bg-[#F9E1DA] font-semibold py-2 px-4 rounded-lg text-sm">
              Delete Association…
            </button>
          </div>
        )}

        {showDelete && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
              <h2 className="font-semibold text-[#C0492F] mb-1">Delete {form?.name}?</h2>
              <p className="text-sm text-[#54627A] mb-4">
                This permanently removes the association and every unit, owner, policy, invite, and document under it. This cannot be undone.
              </p>
              <label className="block text-xs font-medium text-[#54627A] mb-1">Type the association name to confirm</label>
              <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                placeholder={form?.name}
                className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#C0492F]" />
              <div className="flex gap-2">
                <button type="button" disabled={deleting || deleteConfirm.trim() !== (form?.name || '').trim()}
                  onClick={handleDeleteHoa}
                  className="flex-1 bg-[#C0492F] hover:bg-[#a83d26] text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  {deleting ? 'Deleting…' : 'Delete Association'}
                </button>
                <button type="button" onClick={() => setShowDelete(false)}
                  className="flex-1 border border-[#DCE3EC] text-[#54627A] font-semibold py-2 rounded-lg text-sm hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
