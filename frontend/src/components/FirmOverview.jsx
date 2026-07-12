import { useEffect, useState } from 'react'
import { apiGet } from '../supabase'

// Firm-level dashboard block for property managers: portfolio KPIs and the
// lowest-compliance associations, aggregated server-side (GET /pm/overview,
// scoped to what this login may see). Lives at the top of the PM's
// all-associations Dashboard view; clicking anything drills into that
// association. Table-filtering pills stay with the dashboard's ActionStrip.
function Kpi({ label, value, tone }) {
  return (
    <div className="border border-[#E8ECF2] rounded-lg px-3 py-2 bg-white">
      <p className="text-[11px] text-[#8493A8]">{label}</p>
      <p className={`text-xl font-bold ${tone === 'good' ? 'text-[#0E8E68]' : tone === 'warn' ? 'text-[#C0492F]' : 'text-[#0B1B33]'}`}
        style={{ fontFamily: 'JetBrains Mono, monospace' }}>{value}</p>
    </div>
  )
}

export function CompBar({ pct }) {
  if (pct == null) return <span className="text-xs text-[#8493A8]">—</span>
  const color = pct >= 85 ? '#0E8E68' : pct >= 70 ? '#946410' : '#C0492F'
  return (
    <span className="inline-flex items-center gap-2 min-w-[110px]">
      <span className="flex-1 h-1.5 rounded bg-[#E8ECF2] min-w-[56px]">
        <span className="block h-1.5 rounded" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="text-xs font-bold w-9 text-right" style={{ fontFamily: 'JetBrains Mono, monospace', color }}>{pct}%</span>
    </span>
  )
}

export default function FirmOverview({ openHoa }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { apiGet('/pm/overview').then(setData).catch(e => setError(e.message)) }, [])
  if (error) return null  // fail quiet on the dashboard; the table below still works
  if (!data) return <div className="bg-white rounded-xl border border-[#E8ECF2] h-24 animate-pulse mb-4" />
  const att = data.attention
  return (
    <div className="space-y-4 mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Kpi label="Associations" value={data.associations} />
        <Kpi label="Units" value={data.units.toLocaleString()} />
        <Kpi label="Portfolio compliance" value={data.compliance_pct != null ? `${data.compliance_pct}%` : '—'}
          tone={data.compliance_pct >= 85 ? 'good' : undefined} />
        <Kpi label="Need attention" value={att.lapsed + att.non_compliant + att.missing}
          tone={(att.lapsed + att.non_compliant + att.missing) > 0 ? 'warn' : 'good'} />
        <Kpi label="Team" value={data.team_size} />
      </div>
      {data.worst.length > 1 && (
        <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-5">
          <p className="font-semibold text-[#0B1B33] mb-2">Lowest compliance</p>
          <div className="divide-y divide-[#E8ECF2]">
            {data.worst.map(h => (
              <button key={h.id} type="button" onClick={() => openHoa(h.id)}
                className="w-full flex items-center justify-between gap-3 py-2 text-left hover:bg-slate-50 rounded px-1">
                <span className="text-sm text-[#0B1B33] truncate">{h.name}</span>
                <span className="flex items-center gap-4 flex-shrink-0">
                  <CompBar pct={h.compliance_pct} />
                  <span className="text-xs text-[#8493A8] w-16 text-right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {h.units} units
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
