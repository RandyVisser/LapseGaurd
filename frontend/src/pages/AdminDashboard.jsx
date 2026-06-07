import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import StatusBadge from '../components/StatusBadge'
import { apiGet, apiPost } from '../supabase'
import { useAuth } from '../context/AuthContext'

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

function StatCard({ label, value, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`bg-white rounded-xl border-2 shadow-sm p-5 flex flex-col gap-1 text-left w-full transition-all ${color} ${active ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <span className="text-3xl font-bold">{value ?? '—'}</span>
      <span className="text-sm text-slate-500">{label}</span>
    </button>
  )
}

export default function AdminDashboard() {
  const { hoaId } = useAuth()
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [units, setUnits] = useState([])
  const [error, setError] = useState('')
  const [notifying, setNotifying] = useState(null)
  const [notifySuccess, setNotifySuccess] = useState(null)
  const [newUnit, setNewUnit] = useState('')
  const [addingUnit, setAddingUnit] = useState(false)
  const [inviteUnit, setInviteUnit] = useState(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteType, setInviteType] = useState('primary')
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(null)
  const [activeFilter, setActiveFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  async function handleAddUnit(e) {
    e.preventDefault()
    if (!newUnit.trim()) return
    setAddingUnit(true)
    try {
      await apiPost(`/hoa/${hoaId}/units`, { unit_number: newUnit.trim() })
      setNewUnit('')
      const [s, u] = await Promise.all([apiGet(`/hoa/${hoaId}/compliance`), apiGet(`/hoa/${hoaId}/units`)])
      setSummary(s); setUnits(u)
    } catch (err) { setError(err.message) }
    finally { setAddingUnit(false) }
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

  useEffect(() => {
    if (!hoaId) return
    Promise.all([
      apiGet(`/hoa/${hoaId}/compliance`),
      apiGet(`/hoa/${hoaId}/units`),
    ])
      .then(([s, u]) => { setSummary(s); setUnits(u) })
      .catch(e => setError(e.message))
  }, [hoaId])

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      <main className="max-w-full mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-800">Compliance Overview</h1>
          <form onSubmit={handleAddUnit} className="flex gap-2">
            <input
              value={newUnit}
              onChange={e => setNewUnit(e.target.value)}
              placeholder="Unit number"
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
            />
            <button type="submit" disabled={addingUnit}
              className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60">
              {addingUnit ? '…' : '+ Add Unit'}
            </button>
          </form>
        </div>
        {error && <p className="text-red-600 mb-4">{error}</p>}

        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or unit…"
            className="w-full sm:w-80 border border-slate-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="ml-2 text-sm text-slate-400 hover:text-slate-600">
              ✕ Clear
            </button>
          )}
        </div>

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
                  placeholder="tenant@email.com"
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

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Units" value={summary.total_units} color="text-slate-800" active={activeFilter === 'all'} onClick={() => setActiveFilter('all')} />
            <StatCard label="Compliant" value={summary.compliant} color="text-green-700" active={activeFilter === 'active'} onClick={() => setActiveFilter('active')} />
            <StatCard label="Expiring Soon" value={summary.expiring} color="text-yellow-700" active={activeFilter === 'expiring'} onClick={() => setActiveFilter('expiring')} />
            <StatCard label="Lapsed / Missing" value={summary.lapsed + summary.missing} color="text-red-700" active={activeFilter === 'lapsed'} onClick={() => setActiveFilter('lapsed')} />
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-auto max-h-[70vh]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <SortTh label="RadarID"           col="radar_id"              sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="APN"               col="assessor_parcel_number" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Type"              col="type"                  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Subdivision"       col="subdivision"           sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Sunbiz DOC #"      col="sunbiz_doc_number"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="FEIN"              col="fein"                  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Primary Name"      col="owner_primary"         sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Email (Primary)"   col="email_primary"         sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Secondary Name"    col="owner_secondary"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Email (Secondary)" col="email_secondary"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Purchase Date"     col="purchase_date"         sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Street Address"    col="street_address"        sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Unit"              col="unit_number"           sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="City"              col="city"                  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="St"                col="state"                 sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Zip"               col="zip"                   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortTh label="Status"            col="status"                sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Action</th>
              </tr>
            </thead>
            {(() => {
              const filtered = units.filter(u => {
                if (activeFilter !== 'all') {
                  if (activeFilter === 'lapsed' && u.status !== 'lapsed' && u.status !== 'missing') return false
                  if (activeFilter !== 'lapsed' && u.status !== activeFilter) return false
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
              return (
            <tbody className="divide-y divide-slate-100">
              {filtered.map(u => (
                <tr
                  key={u.unit_id}
                  onClick={() => u.tenant_id && navigate(`/admin/tenant/${u.tenant_id}`)}
                  className={`hover:bg-slate-50 ${u.tenant_id ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-4 py-3 text-slate-600">{u.radar_id || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.assessor_parcel_number || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.type || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.subdivision || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.sunbiz_doc_number || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.fein || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.owner_primary || u.tenant_name || <span className="italic text-slate-400">No unit-owner</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{u.email_primary || u.tenant_email || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.owner_secondary || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.email_secondary || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.purchase_date || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.street_address || <span className="italic text-slate-400">—</span>}</td>
                  <td className="px-4 py-3 font-medium">{u.unit_number}</td>
                  <td className="px-4 py-3 text-slate-600">{u.city || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.state || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.zip || '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex flex-row gap-1">
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
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !error && (
                <tr>
                  <td colSpan={18} className="px-4 py-6 text-center text-slate-400 italic">No units found</td>
                </tr>
              )}
            </tbody>
              )
            })()}
          </table>
        </div>
      </main>
    </div>
  )
}
