import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../supabase'

// The multi-association PM's dashboard: a summary row and the firm's
// association list (scoped to what this login may see). Clicking a row opens
// that association's classic dashboard. Single-association viewers never see
// this — they land straight in their association (AuthContext default).
// Styling follows the classic dashboard table: status accent bars, mono
// numbers, hover rows (lapsegaurd-promo/dashboard/index.html).
const MONO = 'JetBrains Mono, monospace'

export function CompBar({ pct }) {
  if (pct == null) return <span className="text-xs text-[#8493A8]">—</span>
  const color = pct >= 85 ? '#0E8E68' : pct >= 70 ? '#946410' : '#C0492F'
  return (
    <span className="inline-flex items-center gap-2 min-w-[110px]">
      <span className="flex-1 h-1.5 rounded bg-[#E8ECF2] min-w-[56px]">
        <span className="block h-1.5 rounded" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="text-xs font-bold w-9 text-right" style={{ fontFamily: MONO, color }}>{pct}%</span>
    </span>
  )
}

function Kpi({ label, value, tone }) {
  return (
    <div className="border border-[#E8ECF2] rounded-lg px-3 py-2 bg-white">
      <p className="text-[11px] text-[#8493A8]">{label}</p>
      <p className={`text-xl font-bold ${tone === 'good' ? 'text-[#0E8E68]' : tone === 'warn' ? 'text-[#C0492F]' : 'text-[#0B1B33]'}`}
        style={{ fontFamily: MONO }}>{value}</p>
    </div>
  )
}

const accent = pct => pct == null ? '#DCE3EC' : pct >= 85 ? '#0E8E68' : pct >= 70 ? '#946410' : '#C0492F'

export default function FirmDashboard({ openHoa }) {
  const [overview, setOverview] = useState(null)
  const [registry, setRegistry] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', address: '', board_email: '' })
  const [busy, setBusy] = useState(false)

  function load() {
    apiGet('/pm/overview').then(setOverview).catch(e => setError(e.message))
    apiGet('/pm/associations').then(setRegistry).catch(e => setError(e.message))
  }
  useEffect(() => { load() }, [])

  async function handleAdd(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const { hoa_id } = await apiPost('/pm/associations', addForm)
      setShowAdd(false); setAddForm({ name: '', address: '', board_email: '' })
      openHoa(hoa_id)  // jump straight into the new association
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (error && !registry) return <p className="text-sm text-[#C0492F]">{error}</p>
  if (!overview || !registry) {
    return <div className="bg-white rounded-xl border border-[#E8ECF2] h-40 animate-pulse" />
  }
  const att = overview.attention
  const attTotal = att.lapsed + att.non_compliant + att.missing
  const q = search.toLowerCase()
  const rows = registry.hoas.filter(h => !q || h.name.toLowerCase().includes(q))

  const billPill = h => h.has_subscription
    ? (['active', 'trialing'].includes(h.billing_status)
        ? <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5 bg-[#E2F4EC] text-[#0E8E68]">{registry.firm_billing_mode === 'firm' ? 'Firm-paid' : 'Paid'}</span>
        : <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5 bg-[#F9E1DA] text-[#C0492F]">{h.billing_status}</span>)
    : h.trial_active
      ? <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5 bg-[#FAEDD2] text-[#946410]">Trial · {h.trial_days_left}d</span>
      : <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5 bg-[#E8ECF2] text-[#54627A]">Unsubscribed</span>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Associations" value={overview.associations} />
        <Kpi label="Units" value={overview.units.toLocaleString()} />
        <Kpi label="Portfolio compliance" value={overview.compliance_pct != null ? `${overview.compliance_pct}%` : '—'}
          tone={overview.compliance_pct >= 85 ? 'good' : undefined} />
        <Kpi label="Need attention" value={attTotal} tone={attTotal > 0 ? 'warn' : 'good'} />
      </div>

      <div className="bg-white rounded-2xl border border-[#E8ECF2] shadow-sm overflow-hidden">
        <div className="flex gap-2 p-4 pb-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${registry.hoas.length} association${registry.hoas.length !== 1 ? 's' : ''}…`}
            className="flex-1 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
          <button type="button" onClick={() => setShowAdd(true)}
            className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 px-4 rounded-lg text-sm flex-shrink-0">
            + Add association
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]" style={{ minWidth: 660 }}>
            <thead>
              <tr className="text-left text-[11px] uppercase text-[#8493A8] bg-[#FAFBFD] border-y border-[#E8ECF2]"
                style={{ fontFamily: MONO, letterSpacing: '.06em' }}>
                <th className="py-3 px-4 font-bold">Association</th>
                <th className="py-3 px-3 font-bold">Compliance</th>
                <th className="py-3 px-3 font-bold text-right">Units</th>
                <th className="py-3 px-3 font-bold text-right">Attention</th>
                <th className="py-3 px-3 font-bold">Assigned</th>
                <th className="py-3 px-4 font-bold">Billing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF2]">
              {rows.map(h => (
                <tr key={h.id} onClick={() => openHoa(h.id)}
                  className="cursor-pointer hover:bg-[#E7EEFA] transition-colors">
                  <td className="py-3 px-4 relative font-semibold text-[#0B1B33]">
                    <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r"
                      style={{ background: accent(h.compliance_pct) }} />
                    {h.name}
                  </td>
                  <td className="py-3 px-3"><CompBar pct={h.compliance_pct} /></td>
                  <td className="py-3 px-3 text-right font-semibold" style={{ fontFamily: MONO }}>{h.units}</td>
                  <td className="py-3 px-3 text-right" style={{ fontFamily: MONO }}>
                    {h.needs_attention > 0
                      ? <span className="font-bold text-[#C0492F]">{h.needs_attention}</span>
                      : <span className="text-[#8493A8]">0</span>}
                  </td>
                  <td className="py-3 px-3">
                    {h.assigned.length
                      ? <span className="text-xs text-[#54627A]">{h.assigned.join(', ')}</span>
                      : <span className="text-[11px] font-bold rounded-full px-2.5 py-0.5 bg-[#FAEDD2] text-[#946410]">Unassigned</span>}
                  </td>
                  <td className="py-3 px-4">{billPill(h)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan="6" className="py-9 text-center text-[#8493A8] text-sm">No associations match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h2 className="font-semibold text-[#0B1B33] mb-1">Add an association</h2>
            <p className="text-xs text-[#54627A] mb-4">
              It joins your firm's portfolio assigned to you — you'll land on its dashboard
              to import units. The board contact is optional and can log in later.
            </p>
            <form onSubmit={handleAdd} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[#0B1B33] mb-1">Association name <span className="text-[#C0492F]">*</span></label>
                <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} required
                  className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0B1B33] mb-1">Address</label>
                <input value={addForm.address} onChange={e => setAddForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0B1B33] mb-1">Board contact email <span className="text-[#8493A8] font-normal">(optional — sends a dashboard invite)</span></label>
                <input type="email" value={addForm.board_email} onChange={e => setAddForm(f => ({ ...f, board_email: e.target.value }))}
                  className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
              </div>
              {error && <p className="text-sm text-[#C0492F]">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={busy}
                  className="flex-1 bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60">
                  {busy ? 'Adding…' : 'Add association'}
                </button>
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 border border-[#DCE3EC] text-[#54627A] font-semibold py-2 rounded-lg text-sm hover:bg-slate-50">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
