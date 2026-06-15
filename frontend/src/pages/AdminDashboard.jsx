import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import Nav from '../components/Nav'
import StatusBadge from '../components/StatusBadge'
import { apiGet, apiPost, apiPatch, supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import useIsMobile from '../hooks/useIsMobile'
import ImportWizard from '../components/ImportWizard'

const API = import.meta.env.VITE_API_URL || '/api'

function SortTh({ label, col, sortCol, sortDir, onSort }) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      className="text-left px-4 py-3 font-semibold text-slate-600 cursor-pointer select-none hover:bg-slate-100 whitespace-nowrap"
    >
      <span className="flex items-center gap-1">
        {label}
        <span className="text-slate-400 text-xs">
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  )
}

function StatCard({ label, value, sublabel, color, active, onClick, compact }) {
  if (compact) {
    return (
      <button
        onClick={onClick}
        className={`bg-white rounded-lg border shadow-sm px-3 py-2.5 sm:px-5 sm:py-3.5 flex flex-col text-left transition-all sm:min-w-[154px] ${color} ${active ? 'border-blue-500 ring-1 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}
      >
        <span className="text-2xl sm:text-3xl font-bold leading-tight">{value ?? '—'}</span>
        <span className="text-xs sm:text-sm text-slate-500 leading-tight sm:whitespace-nowrap">{label}</span>
      </button>
    )
  }
  return (
    <button
      onClick={onClick}
      className={`bg-white rounded-xl border-2 shadow-sm p-5 flex flex-col gap-1 text-left w-full transition-all ${color} ${active ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <span className="text-3xl font-bold">{value ?? '—'}</span>
      <span className="text-sm text-slate-500">{label}</span>
      {sublabel && <span className="text-xs text-slate-400">{sublabel}</span>}
    </button>
  )
}

function displayEmail(email) {
  return email && !email.toLowerCase().endsWith('@condo.insure') ? email : null
}

function TrendChart({ data }) {
  if (!data || data.length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Compliance Trend (6 months)</p>
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            formatter={(val, name) => [val, name === 'compliant' ? 'Compliant' : name === 'expiring' ? 'Expiring' : 'Lapsed']}
          />
          <Line type="monotone" dataKey="compliant" stroke="#16a34a" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="expiring" stroke="#ca8a04" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="lapsed" stroke="#dc2626" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function TitlePill({ title }) {
  if (!title) return <span className="text-slate-400">—</span>
  const isPm = (title || '').trim().toLowerCase() === 'property manager'
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${isPm ? 'bg-purple-100 text-purple-800 border-purple-300' : 'bg-green-100 text-green-800 border-green-300'}`}>
      {title}
    </span>
  )
}

// Where an owner is in the onboarding funnel: invited → signed up → (bounced)
function OwnerStatusBadge({ status, bounced }) {
  if (bounced) return (
    <span title="Invite email bounced — check the address" className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-red-100 text-red-700 border-red-300 whitespace-nowrap">✉ Bounced</span>
  )
  const map = {
    verified:    ['bg-green-100 text-green-800 border-green-300', '✓ Active', 'Owner has created an account'],
    invited:     ['bg-amber-100 text-amber-800 border-amber-300', 'Invited', 'Invited — waiting on them to sign up'],
    not_invited: ['bg-slate-100 text-slate-500 border-slate-200', 'Not invited', 'No invite sent yet'],
  }
  const [cls, label, title] = map[status] || map.not_invited
  return <span title={title} className={`text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${cls}`}>{label}</span>
}

// All available table columns. `group` drives the picker layout; columns
// without a group are the always-sensible core set shown by default.
const COLUMNS = [
  { key: 'status',                 label: 'Status',                render: u => <StatusBadge status={u.status} expirationDate={u.expiration_date} /> },
  { key: 'account_status',         label: 'Owner',                 render: u => <OwnerStatusBadge status={u.account_status} bounced={u.email_bounced} /> },
  { key: 'assoc_title',            label: 'Board',                 render: u => <TitlePill title={u.assoc_title} /> },
  { key: 'unit_number',            label: 'Unit',                  className: 'font-medium', render: u => u.unit_number },
  { key: 'owner_primary',          label: 'Primary Name',          render: u => u.owner_primary || u.tenant_name || <span className="italic text-slate-400">No unit-owner</span> },
  { key: 'email_primary',          label: 'Email (Primary)',       render: u => displayEmail(u.email_primary) || '—' },
  { key: 'street_address',         label: 'Street Address',        render: u => u.street_address || <span className="italic text-slate-400">—</span> },
  { key: 'owner_secondary',        label: 'Secondary Name',        group: 'Owner details', render: u => u.owner_secondary || '—' },
  { key: 'email_secondary',        label: 'Email (Secondary)',     group: 'Owner details', render: u => displayEmail(u.email_secondary) || '—' },
  { key: 'purchase_date',          label: 'Purchase Date',         group: 'Owner details', render: u => u.purchase_date || '—' },
  { key: 'city',                   label: 'City',                  group: 'Address', render: u => u.city || '—' },
  { key: 'state',                  label: 'St',                    group: 'Address', render: u => u.state || '—' },
  { key: 'zip',                    label: 'Zip',                   group: 'Address', render: u => u.zip || '—' },
  { key: 'radar_id',               label: 'RadarID',               group: 'Property data', render: u => u.radar_id || '—' },
  { key: 'assessor_parcel_number', label: 'APN',                   group: 'Property data', render: u => u.assessor_parcel_number || '—' },
  { key: 'type',                   label: 'Type',                  group: 'Property data', render: u => u.type || '—' },
  { key: 'subdivision',            label: 'Subdivision (PropRadar)', group: 'Property data', render: u => u.subdivision || '—' },
  { key: 'corp_name',              label: 'Corp Name (SunBiz)',    group: 'Corporate', render: u => u.corp_name || '—' },
  { key: 'sunbiz_doc_number',      label: 'Sunbiz DOC #',          group: 'Corporate', render: u => u.sunbiz_doc_number || '—' },
  { key: 'fein',                   label: 'Assoc FEIN',            group: 'Corporate', render: u => u.fein || '—' },
]

const DEFAULT_COLUMNS = COLUMNS.filter(c => !c.group).map(c => c.key)
const COLUMNS_STORAGE_KEY = 'lapseguard.dashboard.columns.v1'
const SHOW_ALL_STORAGE_KEY = 'lapseguard.dashboard.showAll.v1'

function loadVisibleColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY))
    if (Array.isArray(saved) && saved.length) {
      const valid = saved.filter(k => COLUMNS.some(c => c.key === k))
      if (valid.length) return valid
    }
  } catch { /* corrupted storage — fall through to defaults */ }
  return DEFAULT_COLUMNS
}

const GETTING_STARTED_DISMISSED_KEY = 'lapseguard.gettingStarted.dismissed.v1'

// First-run checklist for a brand-new association. Steps check themselves off
// against live data; the panel disappears once everything is done (or dismissed).
function GettingStartedPanel({ summary, requirementsSet, onImportClick, onInviteAll, isMobile }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(GETTING_STARTED_DISMISSED_KEY) === 'true' } catch { return false }
  })

  if (!summary) return null

  const policiesReceived = summary.total_units - summary.missing
  const steps = [
    {
      title: 'Add your units',
      detail: 'Import your unit list from a CSV or Excel file, or add units one at a time.',
      done: summary.total_units > 0,
      action: { label: 'Import units', onClick: onImportClick },
    },
    {
      title: 'Add board members & property manager',
      detail: 'Find their unit → ⋯ Actions → Edit Owner Info, then set their Board Title and email. To add a property manager, click the Property Managers card below.',
      done: (summary.board_members ?? 0) > 0 || (summary.property_managers ?? 0) > 0,
    },
    {
      title: 'Set your insurance requirements',
      detail: 'Coverage minimums, wind, and matching rules — the AI checks every uploaded policy against these.',
      done: requirementsSet,
      action: { label: 'Open Settings', href: '/admin/settings' },
    },
    {
      title: 'Upload shared documents',
      detail: 'Share docs with all owners — Wind Mitigation, Evidence of Insurance, Elevation Certificates, Flood Dec Pages, etc.',
      done: (summary.documents_count ?? 0) > 0,
      action: { label: 'Upload documents', href: '/admin/documents' },
    },
    {
      title: 'Invite unit owners',
      detail: 'Email every owner a secure signup link at once, or use the ⋯ menu on a single row.',
      done: summary.invites_sent > 0,
      action: { label: 'Invite all owners', onClick: onInviteAll },
    },
    {
      title: 'Watch policies roll in',
      detail: 'Owners upload dec pages, the AI verifies them, and statuses update here automatically.',
      done: policiesReceived > 0,
    },
  ]
  const doneCount = steps.filter(s => s.done).length
  if (doneCount === steps.length) return null

  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem(GETTING_STARTED_DISMISSED_KEY, 'true') } catch { /* ignore */ }
  }

  // Dismissed but not finished — leave a way back in (esp. on mobile, where
  // this is the import entry point)
  if (dismissed) {
    return (
      <button
        onClick={() => { setDismissed(false); try { localStorage.removeItem(GETTING_STARTED_DISMISSED_KEY) } catch { /* ignore */ } }}
        className="mb-4 w-full sm:w-auto text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 hover:bg-blue-100 flex items-center justify-center gap-2"
      >
        ✦ Finish setting up your association
        <span className="text-blue-400">({steps.length - doneCount} left) ▸</span>
      </button>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-blue-200 shadow-sm mb-4 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-blue-50 border-b border-blue-100">
        <p className="text-sm font-semibold text-blue-900">
          Getting started <span className="font-normal text-blue-600">— {doneCount} of {steps.length} done</span>
        </p>
        <button onClick={dismiss} className="text-xs text-blue-500 hover:text-blue-700">Dismiss</button>
      </div>
      <ol className="flex overflow-x-auto divide-x divide-slate-100">
        {steps.map((step, i) => (
          <li key={step.title} className={`px-5 py-4 flex-shrink-0 w-64 ${step.done ? 'bg-slate-50/50' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                step.done ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                {step.done ? '✓' : i + 1}
              </span>
              <p className={`text-sm font-semibold ${step.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                {step.title}
              </p>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{step.detail}</p>
            {!step.done && step.action && (
              step.action.href
                ? <a href={step.action.href} className="inline-block mt-2 text-xs font-semibold text-blue-600 hover:underline">{step.action.label} →</a>
                : <button onClick={step.action.onClick} className="mt-2 text-xs font-semibold text-blue-600 hover:underline">{step.action.label} →</button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function RowActionsMenu({ items }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)

  // The menu is position:fixed, so it can't follow the button when the table
  // scrolls — close it on any scroll/resize instead (native menu behavior)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function toggle(e) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      // fixed positioning so the menu isn't clipped by the table's scroll container
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 176) })
    }
    setOpen(o => !o)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full w-7 h-7 flex items-center justify-center text-lg leading-none"
        title="Actions"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={e => { e.stopPropagation(); setOpen(false) }} />
          <div className="fixed z-40 min-w-[180px] flex flex-col bg-white border border-slate-200 rounded-lg shadow-lg py-1" style={{ top: pos.top, left: pos.left }}>
            {items.map(item => (
              <button
                key={item.label}
                onClick={e => { e.stopPropagation(); setOpen(false); item.onClick() }}
                disabled={item.disabled}
                className={`block w-full text-left whitespace-nowrap px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 ${item.danger ? 'text-red-600' : 'text-slate-700'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// Quiet uniform style for the toolbar buttons — the old mix of solid
// slate/blue/indigo buttons read as three unrelated alerts
const TOOLBAR_BTN = 'text-sm border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium px-3 py-1.5 rounded-lg disabled:opacity-50'

function RequirementsPopover({ hoa }) {
  const [open, setOpen] = useState(false)
  if (!hoa) return null
  const fmt = v => v == null ? 'Not set' : `$${Number(v).toLocaleString()}`
  const req = v => v ? 'Required' : '—'
  const rows = [
    ['Policy in-force', req(hoa.ho6_policy_in_force_required)],
    ['Named insured matches', req(hoa.ho6_named_insured_match_required)],
    ['Property address matches', req(hoa.ho6_property_address_match_required)],
    ['Coverage A (Dwelling) min', fmt(hoa.ho6_coverage_a_min)],
    ['Coverage E (Liability) min', fmt(hoa.ho6_coverage_e_min)],
    ['Wind coverage', req(hoa.ho6_wind_required)],
    ['Association listed as Additional Interest', req(hoa.ho6_additional_interest_required)],
  ]
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className={TOOLBAR_BTN}>
        HO-6 Requirements ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-4 w-80">
            <ul className="space-y-1.5 text-sm text-slate-600">
              {rows.map(([label, value]) => (
                <li key={label} className="flex items-center justify-between gap-4">
                  <span>{label}</span>
                  <span className="font-medium text-slate-800 flex-shrink-0">{value}</span>
                </li>
              ))}
            </ul>
            <a href="/admin/settings" className="block text-xs text-blue-600 hover:underline mt-3 pt-3 border-t border-slate-100">
              Edit in Settings →
            </a>
          </div>
        </>
      )}
    </div>
  )
}

function ColumnsPicker({ visible, setVisible }) {
  const [open, setOpen] = useState(false)
  const groups = [...new Set(COLUMNS.map(c => c.group || 'Core'))]

  function toggle(key) {
    setVisible(v => v.includes(key) ? v.filter(k => k !== key) : [...v, key])
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-sm border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium px-3 py-1.5 rounded-lg"
      >
        Columns ({visible.length}/{COLUMNS.length}) ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-4 w-64 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setVisible(COLUMNS.map(c => c.key))} className="text-xs text-blue-600 hover:underline">Show all</button>
              <button onClick={() => setVisible(DEFAULT_COLUMNS)} className="text-xs text-slate-500 hover:underline">Reset to defaults</button>
            </div>
            {groups.map(group => (
              <div key={group} className="mb-3 last:mb-0">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{group}</p>
                {COLUMNS.filter(c => (c.group || 'Core') === group).map(c => (
                  <label key={c.key} className="flex items-center gap-2 py-1 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visible.includes(c.key)}
                      onChange={() => toggle(c.key)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function AdminDashboard() {
  const { hoaId, role, availableHoas, selectedHoaId, setSelectedHoaId } = useAuth()
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [units, setUnits] = useState([])
  const [trendData, setTrendData] = useState([])
  const [error, setError] = useState('')
  const [notifying, setNotifying] = useState(null)
  const [notifySuccess, setNotifySuccess] = useState(null)
  const [inviteUnit, setInviteUnit] = useState(null)
  const HOA_FIELD_OPTIONS = {
    name: { label: 'Association Name', key: 'name' },
    corp_name: { label: 'Corp Name (SunBiz)', key: 'corp_name' },
    sunbiz_doc_number: { label: 'SunBiz DOC #', key: 'sunbiz_doc_number' },
  }
  const [hoaFieldType, setHoaFieldType] = useState('name')
  const [hoaFieldValue, setHoaFieldValue] = useState('')

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

  const ALL_HOAS = '__all__'

  function handleHoaFieldValueChange(value) {
    setHoaFieldValue(value)
    if (value === ALL_HOAS) {
      setSelectedHoaId(ALL_HOAS)
      return
    }
    const key = HOA_FIELD_OPTIONS[hoaFieldType]?.key
    const match = availableHoas.find(h => h[key] === value)
    if (match) setSelectedHoaId(match.id)
  }
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteType, setInviteType] = useState('primary')
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(null)
  const [activeFilter, setActiveFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [importOpen, setImportOpen] = useState(false)
  const [invitingAll, setInvitingAll] = useState(false)
  const [inviteAllMsg, setInviteAllMsg] = useState('')
  const [exporting, setExporting] = useState(false)
  const [emailPreview, setEmailPreview] = useState(null)

  async function openInvitePreview(unitId) {
    try {
      const p = await apiGet(`/unit/${unitId}/invite-preview`)
      setEmailPreview(p)
    } catch (err) { setError(err.message) }
  }

  const [addPmFor, setAddPmFor] = useState(null)
  const [pmForm, setPmForm] = useState({ name: '', email: '' })
  const [addingPm, setAddingPm] = useState(false)
  const [soldUnit, setSoldUnit] = useState(null)
  const [soldForm, setSoldForm] = useState({ owner_primary: '', email_primary: '', owner_secondary: '', email_secondary: '' })
  const [savingSold, setSavingSold] = useState(false)
  const [editUnit, setEditUnit] = useState(null)
  const [editIsPm, setEditIsPm] = useState(false)
  const [editForm, setEditForm] = useState({ owner_primary: '', owner_secondary: '', email_primary: '', email_secondary: '' })
  const [savingOwner, setSavingOwner] = useState(false)
  const [deleteUnitId, setDeleteUnitId] = useState(null)
  const [deletingUnit, setDeletingUnit] = useState(false)

  // Bulk select state
  const [selectedTenantIds, setSelectedTenantIds] = useState(new Set())
  const [bulkNotifying, setBulkNotifying] = useState(false)
  const [bulkSuccess, setBulkSuccess] = useState('')

  // Board report state
  const [sendingReport, setSendingReport] = useState(false)
  const [reportSent, setReportSent] = useState(false)

  const isMobile = useIsMobile()
  const [expandedUnitId, setExpandedUnitId] = useState(null)
  const [trendOpen, setTrendOpen] = useState(false)
  const [visibleCols, setVisibleCols] = useState(loadVisibleColumns)
  const [showAllInfo, setShowAllInfo] = useState(() => {
    try { return localStorage.getItem(SHOW_ALL_STORAGE_KEY) === 'true' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleCols)) } catch { /* storage full/blocked */ }
  }, [visibleCols])
  useEffect(() => {
    try { localStorage.setItem(SHOW_ALL_STORAGE_KEY, String(showAllInfo)) } catch { /* storage full/blocked */ }
  }, [showAllInfo])
  const activeColumns = showAllInfo ? COLUMNS : COLUMNS.filter(c => visibleCols.includes(c.key))

  async function openUnit(u) {
    if (u.tenant_id) { navigate(`/admin/tenant/${u.tenant_id}`); return }
    if (u.status === 'missing') {
      try {
        const res = await apiPost(`/unit/${u.unit_id}/tenant`, {})
        navigate(`/admin/tenant/${res.id}`)
      } catch (err) { setError(err.message) }
    }
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }


  async function handleExport() {
    if (!hoaId || hoaId === '__all__') return
    setExporting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch(`${API}/hoa/${hoaId}/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `compliance-export.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }

  async function handleDeleteUnit(unitId) {
    if (!window.confirm('Delete this unit and all its data? This cannot be undone.')) return
    setDeletingUnit(true)
    setDeleteUnitId(unitId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch(`${API}/unit/${unitId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Delete failed') }
      setUnits(prev => prev.filter(u => u.unit_id !== unitId))
    } catch (err) {
      setError(err.message)
    } finally {
      setDeletingUnit(false)
      setDeleteUnitId(null)
    }
  }

  function openEditOwner(u, isPm = false) {
    setEditUnit(u)
    setEditIsPm(isPm)
    setEditForm({
      owner_primary: u.owner_primary || '',
      owner_secondary: u.owner_secondary || '',
      email_primary: (u.email_primary || '').toLowerCase().endsWith('@condo.insure') ? '' : (u.email_primary || ''),
      email_secondary: (u.email_secondary || '').toLowerCase().endsWith('@condo.insure') ? '' : (u.email_secondary || ''),
      assoc_title: u.assoc_title || '',
    })
  }

  async function handleSaveOwner(e) {
    e.preventDefault()
    setSavingOwner(true)
    try {
      await apiPatch(`/unit/${editUnit.unit_id}/owner`, editForm)
      setUnits(prev => prev.map(u => u.unit_id === editUnit.unit_id ? { ...u, ...editForm } : u))
      // Board title changes affect the Board Members count
      if (hoaId && hoaId !== ALL_HOAS) {
        apiGet(`/hoa/${hoaId}/compliance`).then(setSummary).catch(() => {})
      }
      setEditUnit(null)
    } catch (err) { setError(err.message) }
    finally { setSavingOwner(false) }
  }

  async function handleNewOwner(e) {
    e.preventDefault()
    setSavingSold(true)
    try {
      await apiPost(`/unit/${soldUnit.unit_id}/new-owner`, soldForm)
      // Old owner's login, policy and invites are gone — unit resets to "no policy"
      setUnits(prev => prev.map(u => u.unit_id === soldUnit.unit_id
        ? { ...u, ...soldForm, tenant_id: null, tenant_name: null, tenant_email: null,
            status: 'missing', invite_sent: false, expiration_date: null }
        : u))
      if (hoaId && hoaId !== ALL_HOAS) {
        apiGet(`/hoa/${hoaId}/compliance`).then(setSummary).catch(() => {})
      }
      setSoldUnit(null)
    } catch (err) { setError(err.message) }
    finally { setSavingSold(false) }
  }

  async function handleAddPm(e) {
    e.preventDefault()
    setAddingPm(true)
    try {
      // From the (empty) PM card there's no source PM unit — copy subdivision
      // from any unit in this HOA so the new PM lands in the same subdivision
      const sourceUnitId = addPmFor === 'new' ? (units[0]?.unit_id || null) : addPmFor
      await apiPost(`/hoa/${hoaId}/property-manager`, {
        name: pmForm.name,
        email: pmForm.email,
        source_unit_id: sourceUnitId,
      })
      const [s, u] = await Promise.all([apiGet(`/hoa/${hoaId}/compliance`), apiGet(`/hoa/${hoaId}/units`)])
      setSummary(s); setUnits(u)
      setActiveFilter('pm')
      setAddPmFor(null)
      setPmForm({ name: '', email: '' })
    } catch (err) { setError(err.message) }
    finally { setAddingPm(false) }
  }

  async function handleInvite(e) {
    e.preventDefault()
    setInviting(true)
    try {
      await apiPost(`/unit/${inviteUnit}/invite`, { email: inviteEmail })
      setInviteSuccess(inviteUnit + '-' + inviteType)
      setInviteUnit(null)
      setInviteEmail('')
      setTimeout(() => setInviteSuccess(null), 4000)
    } catch (err) { setError(err.message) }
    finally { setInviting(false) }
  }

  async function handleNotify(e, tenantId) {
    e.stopPropagation()
    setNotifying(tenantId)
    setNotifySuccess(null)
    try {
      await apiPost(`/tenant/${tenantId}/notify`, {})
      setNotifySuccess(tenantId)
      setTimeout(() => setNotifySuccess(null), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setNotifying(null)
    }
  }

  function toggleTenantSelect(tenantId) {
    setSelectedTenantIds(prev => {
      const next = new Set(prev)
      if (next.has(tenantId)) next.delete(tenantId)
      else next.add(tenantId)
      return next
    })
  }

  function selectAllVisible(visibleUnits) {
    const ids = visibleUnits.filter(u => u.tenant_id).map(u => String(u.tenant_id))
    setSelectedTenantIds(prev => {
      const allSelected = ids.every(id => prev.has(id))
      if (allSelected) return new Set()
      return new Set([...prev, ...ids])
    })
  }

  async function handleBulkNotify(tenantIds) {
    if (!hoaId || hoaId === '__all__' || tenantIds.length === 0) return
    setBulkNotifying(true)
    setBulkSuccess('')
    try {
      const result = await apiPost(`/hoa/${hoaId}/notify-bulk`, { tenant_ids: tenantIds })
      setBulkSuccess(`Notified ${result.queued} owner${result.queued !== 1 ? 's' : ''}.`)
      setSelectedTenantIds(new Set())
      setTimeout(() => setBulkSuccess(''), 4000)
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkNotifying(false)
    }
  }

  async function handleInviteAll() {
    if (!hoaId || hoaId === '__all__') return
    if (!window.confirm("Send an invite to every owner with an email on file who hasn't signed up yet?")) return
    setInvitingAll(true); setInviteAllMsg('')
    try {
      const r = await apiPost(`/hoa/${hoaId}/invite-all`, {})
      const parts = [`${r.sent} invite${r.sent !== 1 ? 's' : ''} sent`]
      if (r.already_active) parts.push(`${r.already_active} already active`)
      if (r.bounced) parts.push(`${r.bounced} skipped (bad address)`)
      if (r.failed) parts.push(`${r.failed} failed`)
      setInviteAllMsg(parts.join(' · '))
      const [s, u] = await Promise.all([apiGet(`/hoa/${hoaId}/compliance`), apiGet(`/hoa/${hoaId}/units`)])
      setSummary(s); setUnits(u)
      setTimeout(() => setInviteAllMsg(''), 8000)
    } catch (e) { setError(e.message) }
    finally { setInvitingAll(false) }
  }

  async function handleSendBoardReport() {
    if (!hoaId || hoaId === '__all__') return
    setSendingReport(true)
    setReportSent(false)
    try {
      await apiPost(`/hoa/${hoaId}/report/send`, {})
      setReportSent(true)
      setTimeout(() => setReportSent(false), 4000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSendingReport(false)
    }
  }

  useEffect(() => {
    if (!hoaId) return
    setSelectedTenantIds(new Set())

    if (hoaId === ALL_HOAS) {
      Promise.all(
        availableHoas.map(h =>
          Promise.all([apiGet(`/hoa/${h.id}/compliance`), apiGet(`/hoa/${h.id}/units`)])
        )
      )
        .then(results => {
          const allUnits = results.flatMap(([, u]) => u)
          const summaries = results.map(([s]) => s)
          const merged = summaries.reduce((acc, s) => {
            for (const key of ['total_units', 'board_members', 'property_managers', 'compliant', 'expiring', 'lapsed', 'non_compliant', 'pending_review', 'missing', 'invite_sent', 'not_invited', 'invites_sent', 'documents_count']) {
              acc[key] = (acc[key] || 0) + (s[key] || 0)
            }
            return acc
          }, {})
          setSummary(merged)
          setUnits(allUnits)
          setTrendData([])
        })
        .catch(e => setError(e.message))
      return
    }

    Promise.all([
      apiGet(`/hoa/${hoaId}/compliance`),
      apiGet(`/hoa/${hoaId}/units`),
      apiGet(`/hoa/${hoaId}/compliance/trend`),
    ])
      .then(([s, u, trend]) => { setSummary(s); setUnits(u); setTrendData(trend || []) })
      .catch(e => setError(e.message))
  }, [hoaId, availableHoas])

  // Filter + sort shared by the desktop table and the mobile card list
  const filteredUnits = (() => {
    const filtered = units.filter(u => {
      if (activeFilter === 'all') {
        if ((u.assoc_title || '').trim().toLowerCase() === 'property manager') return false
      } else {
        if (activeFilter === 'board') { if (!u.assoc_title || u.assoc_title.trim().toLowerCase() === 'property manager') return false }
        else if (activeFilter === 'pm') { if ((u.assoc_title || '').trim().toLowerCase() !== 'property manager') return false }
        else if (activeFilter === 'active') { if (u.status !== 'active' && u.status !== 'expiring') return false }
        else if (activeFilter === 'lapsed') { if (u.status !== 'lapsed') return false }
        else if (activeFilter === 'non_compliant') { if (u.status !== 'non_compliant') return false }
        else if (activeFilter === 'pending_review') { if (u.status !== 'pending_review') return false }
        else if (activeFilter === 'missing') { if (u.status !== 'missing') return false }
        else if (activeFilter === 'invite_sent') { if (u.status !== 'missing' || !u.invite_sent) return false }
        else if (activeFilter === 'not_invited') { if (u.status !== 'missing' || u.invite_sent) return false }
        else { if (u.status !== activeFilter) return false }
      }
      if (search) {
        const q = search.toLowerCase()
        return (
          (u.unit_number || '').toLowerCase().includes(q) ||
          (u.owner_primary || '').toLowerCase().includes(q) ||
          (u.owner_secondary || '').toLowerCase().includes(q) ||
          (u.tenant_name || '').toLowerCase().includes(q)
        )
      }
      return true
    })
    // numeric:true so unit "3" sorts before "12" (natural order), not lexically
    const cmp = (a, b, col) =>
      (a[col] ?? '').toString().localeCompare((b[col] ?? '').toString(), undefined, { numeric: true, sensitivity: 'base' })
    if (sortCol) {
      filtered.sort((a, b) => sortDir === 'asc' ? cmp(a, b, sortCol) : cmp(b, a, sortCol))
    } else {
      // default: natural order by unit number
      filtered.sort((a, b) => cmp(a, b, 'unit_number'))
    }
    return filtered
  })()

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" title="Compliance Dashboard" />
      <main className="max-w-full mx-auto px-4 pt-3 pb-8">
        {(() => { const selectedHoa = availableHoas.find(h => h.id === hoaId); return (
        <div className="sm:flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              {hoaId === ALL_HOAS ? 'All Associations' : (selectedHoa?.name || 'Compliance Dashboard')}
            </h2>
            {selectedHoa?.corp_name && hoaId !== ALL_HOAS && (
              <p className="text-xs text-slate-400 mt-0.5">SunBiz: {selectedHoa.corp_name}</p>
            )}
            {selectedHoa?.sunbiz_doc_number && hoaId !== ALL_HOAS && (
              <p className="text-xs text-slate-400 mt-0.5">SunBiz Doc #: {selectedHoa.sunbiz_doc_number}</p>
            )}
            {(role === 'super_user' || role === 'property_manager') && availableHoas.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {/* Primary: pick any association by name (works for every HOA,
                    including signup-created ones with no PropRadar fields) */}
                <select
                  value={hoaId || ''}
                  onChange={e => { setHoaFieldValue(''); setSelectedHoaId(e.target.value) }}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={ALL_HOAS}>All Associations</option>
                  {[...availableHoas].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                    .map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
                <span className="text-xs text-slate-300">or search by</span>
                <select
                  value={hoaFieldType}
                  onChange={e => {
                    setHoaFieldType(e.target.value)
                    setHoaFieldValue('')
                  }}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.entries(HOA_FIELD_OPTIONS).map(([key, opt]) => (
                    <option key={key} value={key}>{opt.label}</option>
                  ))}
                </select>
                <select
                  value={hoaFieldValue}
                  onChange={e => handleHoaFieldValueChange(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          {!isMobile && (
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <div className="flex gap-2 flex-wrap justify-end">
                <RequirementsPopover hoa={hoaId !== ALL_HOAS ? selectedHoa : null} />
                <button
                  onClick={handleExport}
                  disabled={exporting || !hoaId || hoaId === '__all__'}
                  className={TOOLBAR_BTN}
                >
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </button>
                <button
                  onClick={() => setImportOpen(true)}
                  disabled={!hoaId || hoaId === '__all__'}
                  className={TOOLBAR_BTN}
                >
                  Import units
                </button>
                <button
                  onClick={handleInviteAll}
                  disabled={invitingAll || !hoaId || hoaId === '__all__'}
                  className={TOOLBAR_BTN}
                >
                  {invitingAll ? 'Inviting…' : 'Invite all owners'}
                </button>
                <button
                  onClick={handleSendBoardReport}
                  disabled={sendingReport || !hoaId || hoaId === '__all__'}
                  className={TOOLBAR_BTN}
                >
                  {sendingReport ? 'Sending…' : reportSent ? 'Report Sent ✓' : 'Email Report'}
                </button>
              </div>
              {inviteAllMsg && <p className="text-xs text-green-600">{inviteAllMsg}</p>}
              {bulkSuccess && <p className="text-xs text-green-600">{bulkSuccess}</p>}
            </div>
          )}
        </div>
        ) })()}

        {hoaId !== ALL_HOAS && (
          <GettingStartedPanel
            summary={summary}
            requirementsSet={(() => {
              const h = availableHoas.find(x => x.id === hoaId)
              return h ? (h.ho6_coverage_a_min != null || h.ho6_coverage_e_min != null) : false
            })()}
            onImportClick={() => setImportOpen(true)}
            onInviteAll={handleInviteAll}
            isMobile={isMobile}
          />
        )}

        {summary && (
              <div className="flex flex-col gap-2 mb-4">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <StatCard compact label="Total Units" value={summary.total_units} color="text-slate-800" active={activeFilter === 'all'} onClick={() => setActiveFilter('all')} />
                  <StatCard compact label="Board Members" value={summary.board_members} color="text-green-700" active={activeFilter === 'board'} onClick={() => setActiveFilter('board')} />
                  <StatCard compact label="Property Managers" value={summary.property_managers ?? 0} color="text-purple-700" active={activeFilter === 'pm'} onClick={() => {
                    if ((summary.property_managers ?? 0) === 0 && hoaId !== ALL_HOAS) { setAddPmFor('new'); setPmForm({ name: '', email: '' }) }
                    else setActiveFilter('pm')
                  }} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <StatCard compact label="Active · Meets Requirements" value={summary.compliant + (summary.expiring ?? 0)} color="text-green-700" active={activeFilter === 'active'} onClick={() => setActiveFilter('active')} />
                  <StatCard compact label="Active · Non-Compliant" value={summary.non_compliant ?? 0} color="text-orange-600" active={activeFilter === 'non_compliant'} onClick={() => setActiveFilter('non_compliant')} />
                  <StatCard compact label="Expired" value={summary.lapsed} color="text-red-700" active={activeFilter === 'lapsed'} onClick={() => setActiveFilter('lapsed')} />
                  <StatCard compact label="Pending Review" value={summary.pending_review ?? 0} color="text-blue-600" active={activeFilter === 'pending_review'} onClick={() => setActiveFilter('pending_review')} />
                  <StatCard compact label="Invite Sent" value={summary.invite_sent ?? 0} color="text-indigo-600" active={activeFilter === 'invite_sent'} onClick={() => setActiveFilter('invite_sent')} />
                  <StatCard compact label="Not Invited Yet" value={summary.not_invited ?? 0} color="text-rose-600" active={activeFilter === 'not_invited'} onClick={() => setActiveFilter('not_invited')} />
                  <StatCard compact label="No Policy Received" value={summary.missing} color="text-slate-500" active={activeFilter === 'missing'} onClick={() => setActiveFilter('missing')} />
                </div>
              </div>
            )}

        {!isMobile && trendData.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setTrendOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide hover:text-slate-600 mb-1"
            >
              Compliance trend
              <svg className={`w-3.5 h-3.5 transition-transform ${trendOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {trendOpen && <TrendChart data={trendData} />}
          </div>
        )}

        {error && <p className="text-red-600 mb-4">{error}</p>}

        {/* Bulk action bar */}
        {selectedTenantIds.size > 0 && (
          <div className="flex items-center gap-3 mb-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
            <span className="text-sm text-blue-800 font-medium">{selectedTenantIds.size} owner{selectedTenantIds.size !== 1 ? 's' : ''} selected</span>
            <button
              onClick={() => handleBulkNotify([...selectedTenantIds])}
              disabled={bulkNotifying}
              className="text-sm bg-blue-700 hover:bg-blue-800 text-white font-medium px-3 py-1 rounded-lg disabled:opacity-60"
            >
              {bulkNotifying ? 'Notifying…' : 'Notify Selected'}
            </button>
            <button
              onClick={() => setSelectedTenantIds(new Set())}
              className="text-sm text-blue-600 hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        {/* Import wizard */}
        {importOpen && hoaId && hoaId !== '__all__' && (
          <ImportWizard
            hoaId={hoaId}
            onClose={() => setImportOpen(false)}
            onDone={() => {
              Promise.all([apiGet(`/hoa/${hoaId}/compliance`), apiGet(`/hoa/${hoaId}/units`)])
                .then(([s, u]) => { setSummary(s); setUnits(u) })
                .catch(() => {})
            }}
          />
        )}

        {/* Invite modal */}
        {inviteUnit && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
              <h2 className="font-semibold text-slate-800 mb-4">Invite {inviteType === 'secondary' ? 'Secondary' : 'Primary'} Owner</h2>
              <form onSubmit={handleInvite} className="space-y-3">
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="unit-owner@email.com"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={inviting}
                    className="flex-1 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-60">
                    {inviting ? 'Sending…' : 'Send Invite'}
                  </button>
                  <button type="button" onClick={() => { setInviteUnit(null); setInviteEmail('') }}
                    className="flex-1 border border-slate-300 text-slate-600 text-sm font-semibold py-2 rounded-lg hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {editUnit && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
              <h2 className="font-semibold text-slate-800 mb-1">{editIsPm ? 'Edit Property Manager' : 'Edit Owner Info'}</h2>
              <p className="text-xs text-slate-400 mb-4">{editIsPm ? 'Update the property manager name or email.' : `Unit ${editUnit.unit_number} — fix a typo or update after a sale.`}</p>
              <form onSubmit={handleSaveOwner} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{editIsPm ? 'Name' : 'Primary name'}</label>
                    <input value={editForm.owner_primary} onChange={e => setEditForm(f => ({ ...f, owner_primary: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{editIsPm ? 'Email' : 'Primary email'}</label>
                    <input type="email" value={editForm.email_primary} onChange={e => setEditForm(f => ({ ...f, email_primary: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  {!editIsPm && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Secondary name</label>
                    <input value={editForm.owner_secondary} onChange={e => setEditForm(f => ({ ...f, owner_secondary: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  )}
                  {!editIsPm && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Secondary email</label>
                    <input type="email" value={editForm.email_secondary} onChange={e => setEditForm(f => ({ ...f, email_secondary: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  )}
                  {!editIsPm && (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Board title <span className="font-normal text-slate-400">(blank = not on the board)</span></label>
                    <input list="board-titles" value={editForm.assoc_title} onChange={e => setEditForm(f => ({ ...f, assoc_title: e.target.value }))}
                      placeholder="e.g. President, Treasurer"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <datalist id="board-titles">
                      <option value="President" />
                      <option value="Vice President" />
                      <option value="Secretary" />
                      <option value="Treasurer" />
                      <option value="Board Member" />
                    </datalist>
                  </div>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={savingOwner}
                    className="flex-1 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-60">
                    {savingOwner ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditUnit(null)}
                    className="flex-1 border border-slate-300 text-slate-600 text-sm font-semibold py-2 rounded-lg hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {emailPreview && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setEmailPreview(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">Subject</p>
                  <p className="text-sm font-semibold text-slate-800 truncate">{emailPreview.subject}</p>
                </div>
                <button onClick={() => setEmailPreview(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none flex-shrink-0">×</button>
              </div>
              <iframe title="Invite preview" srcDoc={emailPreview.html} className="flex-1 w-full border-0" style={{ minHeight: '420px' }} />
            </div>
          </div>
        )}

        {soldUnit && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
              <h2 className="font-semibold text-slate-800 mb-1">Unit Sold — New Owner</h2>
              <p className="text-xs text-slate-500 mb-1">Unit {soldUnit.unit_number}</p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 mb-4">
                This removes the current owner's login, their policy on file, and any pending invites.
                The new owner will need to be invited to upload their own policy.
              </div>
              <form onSubmit={handleNewOwner} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Primary name</label>
                    <input value={soldForm.owner_primary} onChange={e => setSoldForm(f => ({ ...f, owner_primary: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Primary email</label>
                    <input type="email" value={soldForm.email_primary} onChange={e => setSoldForm(f => ({ ...f, email_primary: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Secondary name</label>
                    <input value={soldForm.owner_secondary} onChange={e => setSoldForm(f => ({ ...f, owner_secondary: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Secondary email</label>
                    <input type="email" value={soldForm.email_secondary} onChange={e => setSoldForm(f => ({ ...f, email_secondary: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={savingSold}
                    className="flex-1 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-60">
                    {savingSold ? 'Saving…' : 'Save New Owner'}
                  </button>
                  <button type="button" onClick={() => setSoldUnit(null)}
                    className="flex-1 border border-slate-300 text-slate-600 text-sm font-semibold py-2 rounded-lg hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {addPmFor && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
              <h2 className="font-semibold text-slate-800 mb-1">Add New Property Manager</h2>
              <p className="text-xs text-slate-400 mb-4">Creates a new PM position in this subdivision.</p>
              <form onSubmit={handleAddPm} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
                  <input value={pmForm.name} onChange={e => setPmForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Manager name or company"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
                  <input type="email" value={pmForm.email} onChange={e => setPmForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="manager@email.com"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={addingPm}
                    className="flex-1 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-60">
                    {addingPm ? 'Adding…' : 'Add PM'}
                  </button>
                  <button type="button" onClick={() => setAddPmFor(null)}
                    className="flex-1 border border-slate-300 text-slate-600 text-sm font-semibold py-2 rounded-lg hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* List toolbar — search + view controls, right above what they act on */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center flex-1 max-w-xs">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or unit…"
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="ml-2 text-sm text-slate-400 hover:text-slate-600">✕</button>
            )}
          </div>
          {isMobile && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleInviteAll}
                disabled={invitingAll || !hoaId || hoaId === '__all__'}
                className="text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 disabled:opacity-50"
              >
                {invitingAll ? '…' : 'Invite all'}
              </button>
              <button
                onClick={() => setImportOpen(true)}
                disabled={!hoaId || hoaId === '__all__'}
                className="text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 disabled:opacity-50"
              >
                Import
              </button>
            </div>
          )}
          {!isMobile && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 mr-1">View:</span>
              <button
                onClick={() => setShowAllInfo(s => !s)}
                className={`text-sm font-medium px-3 py-1.5 rounded-lg border ${
                  showAllInfo
                    ? 'bg-blue-50 border-blue-400 text-blue-700 ring-1 ring-blue-200'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
                title="Toggle between your column selection and every field"
              >
                {showAllInfo ? '✓ All info' : 'All info'}
              </button>
              {!showAllInfo && <ColumnsPicker visible={visibleCols} setVisible={setVisibleCols} />}
            </div>
          )}
        </div>

        {isMobile ? (
          <div className="space-y-2">
            {filteredUnits.map(u => {
              const expanded = expandedUnitId === u.unit_id
              return (
              <div key={u.unit_id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-stretch">
                  <button
                    onClick={() => openUnit(u)}
                    className="flex-1 min-w-0 px-4 py-3 flex items-center justify-between gap-3 text-left active:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-800">Unit {u.unit_number}</p>
                        {u.assoc_title && <TitlePill title={u.assoc_title} />}
                      </div>
                      <p className="text-sm text-slate-500 truncate">
                        {u.owner_primary || u.tenant_name || <span className="italic text-slate-400">No unit-owner</span>}
                      </p>
                      <div className="mt-1">
                        <OwnerStatusBadge status={u.account_status} bounced={u.email_bounced} />
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <StatusBadge status={u.status} expirationDate={u.expiration_date} />
                    </div>
                  </button>
                  <button
                    onClick={() => setExpandedUnitId(expanded ? null : u.unit_id)}
                    className="px-3 flex items-center text-slate-400 border-l border-slate-100 active:bg-slate-50"
                    aria-label={expanded ? 'Hide details' : 'Show details'}
                  >
                    <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                    <dl className="space-y-1.5 text-sm">
                      {COLUMNS.filter(c => !['status', 'assoc_title', 'unit_number', 'owner_primary'].includes(c.key)).map(c => (
                        <div key={c.key} className="flex items-start justify-between gap-3">
                          <dt className="text-slate-400 flex-shrink-0">{c.label}</dt>
                          <dd className="text-slate-700 text-right break-words min-w-0">{c.render(u)}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="flex gap-2 flex-wrap mt-3 pt-3 border-t border-slate-200">
                      {inviteSuccess === u.unit_id + '-primary' ? (
                        <span className="text-xs text-green-600 font-medium py-1">Invite sent ✓</span>
                      ) : (
                        <button
                          onClick={() => { setInviteUnit(u.unit_id); setInviteEmail(u.email_primary || u.tenant_email || ''); setInviteType('primary') }}
                          className="text-xs bg-slate-700 active:bg-slate-800 text-white px-3 py-1.5 rounded-full"
                        >
                          Invite Primary
                        </button>
                      )}
                      {inviteSuccess === u.unit_id + '-secondary' ? (
                        <span className="text-xs text-green-600 font-medium py-1">Invite sent ✓</span>
                      ) : (
                        <button
                          onClick={() => { setInviteUnit(u.unit_id); setInviteEmail(u.email_secondary || ''); setInviteType('secondary') }}
                          className="text-xs bg-slate-500 active:bg-slate-600 text-white px-3 py-1.5 rounded-full"
                        >
                          Invite Secondary
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteUnit(u.unit_id)}
                        disabled={deletingUnit && deleteUnitId === u.unit_id}
                        className="text-xs text-red-500 active:text-red-700 px-2 py-1.5 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
              )
            })}
            {filteredUnits.length === 0 && !error && (
              <p className="px-4 py-6 text-center text-slate-400 italic">No units found</p>
            )}
          </div>
        ) : (
        <>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-auto max-h-[70vh]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                {(() => {
                  const filteredForHeader = units.filter(u => u.tenant_id && u.assoc_title !== 'Property Manager')
                  const allSelected = filteredForHeader.length > 0 && filteredForHeader.every(u => selectedTenantIds.has(String(u.tenant_id)))
                  return (
                    <th className="px-4 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => selectAllVisible(filteredForHeader)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                  )
                })()}
                {activeColumns.map(c => (
                  <SortTh key={c.key} label={c.label} col={c.key} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                ))}
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUnits.map(u => {
                const tenantIdStr = u.tenant_id ? String(u.tenant_id) : null
                const isSelected = tenantIdStr ? selectedTenantIds.has(tenantIdStr) : false
                const isPm = (u.assoc_title || '').trim().toLowerCase() === 'property manager'
                return (
                <tr
                  key={u.unit_id}
                  className={`hover:bg-slate-50 ${(!isPm && (u.tenant_id || u.status === 'missing')) ? 'cursor-pointer' : ''} ${isSelected ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {tenantIdStr && !isPm ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleTenantSelect(tenantIdStr)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    ) : null}
                  </td>
                  {activeColumns.map(c => (
                    <td key={c.key} className={`px-4 py-3 ${c.className || 'text-slate-600'}`} onClick={() => { if (!isPm) openUnit(u) }}>
                      {isPm && (c.key === 'status' || c.key === 'unit_number') ? null : c.render(u)}
                    </td>
                  ))}
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      {(inviteSuccess === u.unit_id + '-primary' || inviteSuccess === u.unit_id + '-secondary') && (
                        <span className="text-xs text-green-600 font-medium whitespace-nowrap">Invite sent ✓</span>
                      )}
                      <RowActionsMenu
                        items={isPm ? [
                          {
                            label: 'Send Invite',
                            onClick: () => { setInviteUnit(u.unit_id); setInviteEmail(u.email_primary || ''); setInviteType('primary') },
                          },
                          {
                            label: 'Preview Invite email',
                            onClick: () => openInvitePreview(u.unit_id),
                          },
                          {
                            label: 'Edit PM…',
                            onClick: () => openEditOwner(u, true),
                          },
                          {
                            label: 'Add New PM…',
                            onClick: () => { setAddPmFor(u.unit_id); setPmForm({ name: '', email: '' }) },
                          },
                          {
                            label: 'Delete…',
                            danger: true,
                            disabled: deletingUnit && deleteUnitId === u.unit_id,
                            onClick: () => handleDeleteUnit(u.unit_id),
                          },
                        ] : [
                          {
                            label: 'Invite Primary Owner',
                            onClick: () => { setInviteUnit(u.unit_id); setInviteEmail(u.email_primary || u.tenant_email || ''); setInviteType('primary') },
                          },
                          {
                            label: 'Invite Secondary Owner',
                            onClick: () => { setInviteUnit(u.unit_id); setInviteEmail(u.email_secondary || ''); setInviteType('secondary') },
                          },
                          {
                            label: 'Edit Owner Info…',
                            onClick: () => openEditOwner(u),
                          },
                          {
                            label: 'Unit Sold / New Owner…',
                            onClick: () => { setSoldUnit(u); setSoldForm({ owner_primary: '', email_primary: '', owner_secondary: '', email_secondary: '' }) },
                          },
                          {
                            label: 'Delete unit…',
                            danger: true,
                            disabled: deletingUnit && deleteUnitId === u.unit_id,
                            onClick: () => handleDeleteUnit(u.unit_id),
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
                )
              })}
              {filteredUnits.length === 0 && !error && (
                <tr>
                  <td colSpan={activeColumns.length + 2} className="px-4 py-6 text-center text-slate-400 italic">No units found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
        )}
      </main>
    </div>
  )
}
