import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import Nav from '../components/Nav'
import StatusBadge from '../components/StatusBadge'
import { apiGet, apiPost, supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import useIsMobile from '../hooks/useIsMobile'

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

// All available table columns. `group` drives the picker layout; columns
// without a group are the always-sensible core set shown by default.
const COLUMNS = [
  { key: 'status',                 label: 'Status',                render: u => <StatusBadge status={u.status} expirationDate={u.expiration_date} /> },
  { key: 'assoc_title',            label: 'Board',                 render: u => <TitlePill title={u.assoc_title} /> },
  { key: 'unit_number',            label: 'Unit',                  className: 'font-medium', render: u => u.unit_number },
  { key: 'owner_primary',          label: 'Primary Name',          render: u => u.owner_primary || u.tenant_name || <span className="italic text-slate-400">No unit-owner</span> },
  { key: 'email_primary',          label: 'Email (Primary)',       render: u => displayEmail(u.email_primary) || displayEmail(u.tenant_email) || '—' },
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
    subdivision: { label: 'Subdivision', key: 'subdivision' },
    corp_name: { label: 'Corp Name (SunBiz)', key: 'corp_name' },
    sunbiz_doc_number: { label: 'SunBiz DOC #', key: 'sunbiz_doc_number' },
  }
  const [hoaFieldType, setHoaFieldType] = useState('subdivision')
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
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [exporting, setExporting] = useState(false)
  const importFileRef = useRef(null)
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
  const [detailUnit, setDetailUnit] = useState(null)
  const [visibleCols, setVisibleCols] = useState(loadVisibleColumns)
  useEffect(() => {
    try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleCols)) } catch { /* storage full/blocked */ }
  }, [visibleCols])
  const activeColumns = COLUMNS.filter(c => visibleCols.includes(c.key))

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

  async function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file || !hoaId || hoaId === '__all__') return
    setImporting(true)
    setImportResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API}/hoa/${hoaId}/units/import`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Import failed')
      setImportResult(`Imported ${data.inserted} units${data.skipped ? `, skipped ${data.skipped}` : ''}.`)
      const [s, u] = await Promise.all([apiGet(`/hoa/${hoaId}/compliance`), apiGet(`/hoa/${hoaId}/units`)])
      setSummary(s); setUnits(u)
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
      if (importFileRef.current) importFileRef.current.value = ''
    }
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
            for (const key of ['total_units', 'board_members', 'property_managers', 'compliant', 'expiring', 'lapsed', 'non_compliant', 'pending_review', 'missing']) {
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
    if (sortCol) {
      filtered.sort((a, b) => {
        const av = (a[sortCol] || '').toString().toLowerCase()
        const bv = (b[sortCol] || '').toString().toLowerCase()
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    }
    return filtered
  })()

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" title="Compliance Dashboard" />
      <main className="max-w-full mx-auto px-4 pt-3 pb-8">
        <div className="sm:flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-bold text-slate-800">Condo Association</h2>
            {(role === 'super_user' || role === 'property_manager') && availableHoas.length > 0 && (
              <div className="flex items-center gap-2">
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
            <div className="flex items-center mt-2">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or unit…"
                className="w-56 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="ml-2 text-sm text-slate-400 hover:text-slate-600">
                  ✕ Clear
                </button>
              )}
            </div>
            {summary && (
              <div className="flex flex-col gap-2 mt-2">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <StatCard compact label="Total Units" value={summary.total_units} color="text-slate-800" active={activeFilter === 'all'} onClick={() => setActiveFilter('all')} />
                  <StatCard compact label="Board Members" value={summary.board_members} color="text-green-700" active={activeFilter === 'board'} onClick={() => setActiveFilter('board')} />
                  <StatCard compact label="Property Managers" value={summary.property_managers ?? 0} color="text-purple-700" active={activeFilter === 'pm'} onClick={() => setActiveFilter('pm')} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <StatCard compact label="Active · Meets Requirements" value={summary.compliant + (summary.expiring ?? 0)} color="text-green-700" active={activeFilter === 'active'} onClick={() => setActiveFilter('active')} />
                  <StatCard compact label="Active · Non-Compliant" value={summary.non_compliant ?? 0} color="text-orange-600" active={activeFilter === 'non_compliant'} onClick={() => setActiveFilter('non_compliant')} />
                  <StatCard compact label="Expired" value={summary.lapsed} color="text-red-700" active={activeFilter === 'lapsed'} onClick={() => setActiveFilter('lapsed')} />
                  <StatCard compact label="Pending Review" value={summary.pending_review ?? 0} color="text-blue-600" active={activeFilter === 'pending_review'} onClick={() => setActiveFilter('pending_review')} />
                  <StatCard compact label="No Policy Received" value={summary.missing} color="text-slate-500" active={activeFilter === 'missing'} onClick={() => setActiveFilter('missing')} />
                </div>
              </div>
            )}
          </div>
          {!isMobile && (
          <div className="flex items-start gap-3 flex-wrap">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 flex-wrap">
              <ColumnsPicker visible={visibleCols} setVisible={setVisibleCols} />
              <button
                onClick={handleExport}
                disabled={exporting || !hoaId || hoaId === '__all__'}
                className="text-sm bg-slate-700 hover:bg-slate-800 text-white font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
              <label className={`text-sm bg-blue-700 hover:bg-blue-800 text-white font-medium px-3 py-1.5 rounded-lg cursor-pointer ${importing || !hoaId || hoaId === '__all__' ? 'opacity-50 pointer-events-none' : ''}`}>
                {importing ? 'Importing…' : 'Import CSV'}
                <input ref={importFileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
              </label>
              <button
                onClick={handleSendBoardReport}
                disabled={sendingReport || !hoaId || hoaId === '__all__'}
                className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {sendingReport ? 'Sending…' : reportSent ? 'Report Sent ✓' : 'Email Report'}
              </button>
            </div>
            {importResult && <p className="text-xs text-green-600">{importResult}</p>}
            {bulkSuccess && <p className="text-xs text-green-600">{bulkSuccess}</p>}
          </div>
          {(() => {
            const selectedHoa = availableHoas.find(h => h.id === hoaId)
            if (!selectedHoa) return null
            const { ho6_coverage_a_min, ho6_coverage_e_min, ho6_wind_required, ho6_additional_interest_required, ho6_policy_in_force_required, ho6_named_insured_match_required, ho6_property_address_match_required } = selectedHoa
            const fmt = v => v == null ? 'Not Selected' : `$${Number(v).toLocaleString()}`
            const req = v => v ? 'Required' : 'Not Required'
            return (
              <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm">
                {selectedHoa.corp_name && (
                  <p className="text-slate-600 mb-2">
                    <span className="font-semibold text-slate-700">Corp Name (SunBiz):</span> <span className="text-orange-500 font-semibold">{selectedHoa.corp_name}</span>
                  </p>
                )}
                <p className="font-semibold text-slate-700 mb-1">HO-6 Requirements</p>
                <ul className="text-slate-600 space-y-0.5">
                  <li className="flex items-center justify-between gap-6">
                    <span>Policy In-Force</span>
                    <span className="font-medium text-slate-800">{req(ho6_policy_in_force_required)}</span>
                  </li>
                  <li className="flex items-center justify-between gap-6">
                    <span>Named Insured Matches</span>
                    <span className="font-medium text-slate-800">{req(ho6_named_insured_match_required)}</span>
                  </li>
                  <li className="flex items-center justify-between gap-6">
                    <span>Property Address Matches</span>
                    <span className="font-medium text-slate-800">{req(ho6_property_address_match_required)}</span>
                  </li>
                  <li className="flex items-center justify-between gap-6">
                    <span>Coverage A (Dwelling) min</span>
                    <span className="font-medium text-slate-800">{fmt(ho6_coverage_a_min)}</span>
                  </li>
                  <li className="flex items-center justify-between gap-6">
                    <span>Coverage E (Liability) min</span>
                    <span className="font-medium text-slate-800">{fmt(ho6_coverage_e_min)}</span>
                  </li>
                  <li className="flex items-center justify-between gap-6">
                    <span>Wind Coverage</span>
                    <span className="font-medium text-slate-800">{ho6_wind_required ? 'Required' : 'Not Required'}</span>
                  </li>
                  <li className="flex items-center justify-between gap-6">
                    <span>Association Listed as Additional Interest</span>
                    <span className="font-medium text-slate-800">{ho6_additional_interest_required ? 'Required' : 'Not Required'}</span>
                  </li>
                </ul>
              </div>
            )
          })()}
          </div>
          )}
        </div>

        {!isMobile && trendData.length > 0 && <TrendChart data={trendData} />}

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

        {/* Unit details modal (⋯ button) */}
        {detailUnit && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setDetailUnit(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-slate-800">Unit {detailUnit.unit_number}</h2>
                  <StatusBadge status={detailUnit.status} expirationDate={detailUnit.expiration_date} />
                </div>
                <button onClick={() => setDetailUnit(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">✕</button>
              </div>
              <dl className="px-5 py-4 space-y-2 text-sm overflow-y-auto">
                {COLUMNS.filter(c => c.key !== 'status').map(c => (
                  <div key={c.key} className="flex items-start justify-between gap-4">
                    <dt className="text-slate-400 flex-shrink-0">{c.label}</dt>
                    <dd className="text-slate-700 text-right break-words min-w-0">{c.render(detailUnit)}</dd>
                  </div>
                ))}
              </dl>
              <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
                <button
                  onClick={() => { const u = detailUnit; setDetailUnit(null); openUnit(u) }}
                  className="text-sm bg-blue-700 hover:bg-blue-800 text-white font-medium px-4 py-1.5 rounded-lg"
                >
                  Open unit →
                </button>
              </div>
            </div>
          </div>
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
                return (
                <tr
                  key={u.unit_id}
                  className={`hover:bg-slate-50 ${(u.tenant_id || u.status === 'missing') ? 'cursor-pointer' : ''} ${isSelected ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {tenantIdStr && u.assoc_title !== 'Property Manager' ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleTenantSelect(tenantIdStr)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    ) : null}
                  </td>
                  {activeColumns.map(c => (
                    <td key={c.key} className={`px-4 py-3 ${c.className || 'text-slate-600'}`} onClick={() => openUnit(u)}>
                      {c.render(u)}
                    </td>
                  ))}
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex flex-row gap-1 flex-wrap items-center">
                      <button
                        onClick={e => { e.stopPropagation(); setDetailUnit(u) }}
                        className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full w-7 h-7 flex items-center justify-center text-lg leading-none"
                        title="All unit details"
                      >
                        ⋯
                      </button>
                      {inviteSuccess === u.unit_id + '-primary' ? (
                        <span className="text-xs text-green-600 font-medium">Invite sent ✓</span>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setInviteUnit(u.unit_id); setInviteEmail(u.email_primary || u.tenant_email || ''); setInviteType('primary') }}
                          className="text-xs bg-slate-700 hover:bg-slate-800 text-white px-3 py-1 rounded-full text-left"
                        >
                          Invite Primary
                        </button>
                      )}
                      {inviteSuccess === u.unit_id + '-secondary' ? (
                        <span className="text-xs text-green-600 font-medium">Invite sent ✓</span>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setInviteUnit(u.unit_id); setInviteEmail(u.email_secondary || ''); setInviteType('secondary') }}
                          className="text-xs bg-slate-500 hover:bg-slate-600 text-white px-3 py-1 rounded-full text-left"
                        >
                          Invite Secondary
                        </button>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteUnit(u.unit_id) }}
                        disabled={deletingUnit && deleteUnitId === u.unit_id}
                        className="text-xs text-red-500 hover:text-red-700 hover:underline px-1 disabled:opacity-50"
                      >
                        Delete
                      </button>
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
        )}
      </main>
    </div>
  )
}
