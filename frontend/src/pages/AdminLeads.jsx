import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import { apiGet } from '../supabase'
import usePageTitle from '../usePageTitle'

// Renewal-lead calendar (super-user only): current owner policies expiring in
// the next 30/60/90 days across ALL associations, with contact + carrier +
// premium. Read-only — a lead surface for the agency, not a mailer.

const WINDOWS = [30, 60, 90]

const MONO = '"JetBrains Mono", monospace'

const fmtMoney = (n) =>
  n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US')

const fmtDate = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// Days-left pill — brand status palette: coral ≤7, amber ≤30, neutral beyond.
function DaysLeftPill({ days }) {
  const cls = days <= 7
    ? 'bg-[#F9E1DA] text-[#C0492F]'
    : days <= 30
      ? 'bg-[#FAEDD2] text-[#946410]'
      : 'bg-slate-100 text-[#54627A]'
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}
      style={{ fontFamily: MONO }}>
      {days === 0 ? 'today' : `${days}d`}
    </span>
  )
}

function csvEscape(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export default function AdminLeads() {
  usePageTitle('Renewal Leads')
  const [days, setDays] = useState(60)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    apiGet(`/leads/expiring?days=${days}`)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const leads = data?.leads || []

  function handleExport() {
    const header = ['expiration_date', 'days_left', 'association', 'unit', 'owner', 'email', 'insurer', 'policy_number', 'premium']
    const lines = [header.join(',')]
    for (const l of leads) {
      lines.push([
        l.expiration_date, l.days_left, l.hoa_name, l.unit_number, l.owner,
        l.email, l.insurer, l.policy_number, l.premium,
      ].map(csvEscape).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-expiring-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-[#0B1B33]">Renewal Leads</h1>
            <p className="text-sm text-[#54627A] mt-0.5">
              {loading
                ? 'Loading policies…'
                : `${data?.total ?? 0} ${data?.total === 1 ? 'policy' : 'policies'} expiring in the next ${days} days — all associations`}
              {!loading && data && data.total > 0 && days > 30 && (
                <span className="text-[#8493A8]"> ({data.within_30} within 30)</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-[#DCE3EC] overflow-hidden text-sm">
              {WINDOWS.map(w => (
                <button key={w} onClick={() => setDays(w)}
                  className={days === w
                    ? 'px-3 py-1.5 bg-[#001842] text-white font-semibold'
                    : 'px-3 py-1.5 bg-white text-[#54627A] hover:bg-slate-50'}>
                  {w}d
                </button>
              ))}
            </div>
            <button onClick={handleExport} disabled={loading || leads.length === 0}
              className="text-sm bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50">
              Export CSV
            </button>
          </div>
        </header>

        {error && <p className="text-sm text-[#C0492F] mb-4">{error}</p>}

        {loading && (
          <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-4 space-y-3 animate-pulse">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-4 bg-slate-100 rounded" />
            ))}
          </div>
        )}

        {!loading && !error && leads.length === 0 && (
          <div className="bg-white rounded-xl border border-[#E8ECF2] p-8 text-center">
            <p className="text-sm text-[#54627A]">No policies expiring in this window.</p>
          </div>
        )}

        {!loading && leads.length > 0 && (
          <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#8493A8] border-b border-[#E8ECF2]">
                  <th className="px-4 py-3 font-semibold">Expires</th>
                  <th className="px-3 py-3 font-semibold">Association</th>
                  <th className="px-3 py-3 font-semibold">Unit</th>
                  <th className="px-3 py-3 font-semibold">Owner</th>
                  <th className="px-3 py-3 font-semibold">Email</th>
                  <th className="px-3 py-3 font-semibold">Insurer</th>
                  <th className="px-4 py-3 font-semibold text-right">Premium</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F3F8]">
                {leads.map((l, i) => (
                  <tr key={i} className="hover:bg-[#F4F8FE]">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="text-[#0B1B33] font-medium mr-2" style={{ fontFamily: MONO }}>
                        {fmtDate(l.expiration_date)}
                      </span>
                      <DaysLeftPill days={l.days_left} />
                    </td>
                    <td className="px-3 py-2.5 text-[#54627A]">{l.hoa_name}</td>
                    <td className="px-3 py-2.5 font-semibold text-[#014AC5] whitespace-nowrap" style={{ fontFamily: MONO }}>
                      {l.unit_number || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-[#0B1B33]">{l.owner || '—'}</td>
                    <td className="px-3 py-2.5">
                      {l.email
                        ? <a href={`mailto:${l.email}`} className="text-[#014AC5] hover:underline">{l.email}</a>
                        : <span className="text-[#8493A8]">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[#54627A]">{l.insurer || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-[#0B1B33] whitespace-nowrap" style={{ fontFamily: MONO }}>
                      {fmtMoney(l.premium)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
