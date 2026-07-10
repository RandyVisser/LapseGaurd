import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import { apiGet, apiPost } from '../supabase'
import { useAuth } from '../context/AuthContext'

const ALL_HOAS = '__all__'

const fmtMoney = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'))
const fmtRate = (n) => (n == null ? '—' : '$' + n.toFixed(2))

// A compact card wrapper for each summary section.
function Card({ title, subtitle, children }) {
  return (
    <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E8ECF2]">
        <h3 className="font-semibold text-[#0B1B33] text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-[#8493A8] mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Empty({ children }) {
  return <p className="text-sm text-[#8493A8] italic">{children}</p>
}

// A simple list of policies (unit / owner / carrier + optional value column).
function PolicyList({ rows, valueLabel, valueFn }) {
  if (!rows || rows.length === 0) return <Empty>None found.</Empty>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-[#8493A8]">
            <th className="pb-2 pr-3 font-semibold">Unit</th>
            <th className="pb-2 pr-3 font-semibold">Owner</th>
            <th className="pb-2 pr-3 font-semibold">Carrier</th>
            {valueLabel && <th className="pb-2 font-semibold text-right">{valueLabel}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0F3F8]">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-2 pr-3 font-semibold text-[#0B1B33] whitespace-nowrap">{r.unit_number || '—'}</td>
              <td className="py-2 pr-3 text-[#54627A]">{r.owner || '—'}</td>
              <td className="py-2 pr-3 text-[#54627A]">{r.carrier || '—'}</td>
              {valueLabel && <td className="py-2 text-right font-medium text-[#0B1B33] whitespace-nowrap">{valueFn(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CarrierTable({ rows, valueLabel, valueFn, countKey }) {
  if (!rows || rows.length === 0) {
    return <Empty>No data yet — re-parse dec pages to populate this.</Empty>
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-[#8493A8]">
          <th className="pb-2 pr-3 font-semibold">#</th>
          <th className="pb-2 pr-3 font-semibold">Carrier</th>
          <th className="pb-2 font-semibold text-right">{valueLabel}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F0F3F8]">
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="py-2 pr-3 text-[#8493A8]">{i + 1}</td>
            <td className="py-2 pr-3 text-[#0B1B33] font-medium">
              {r.carrier}
              {countKey != null && <span className="text-[#8493A8] font-normal"> · {r[countKey]} {r[countKey] === 1 ? 'policy' : 'policies'}</span>}
            </td>
            <td className="py-2 text-right font-semibold text-[#0B1B33] whitespace-nowrap">{valueFn(r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function AdminHo6Summary() {
  const { hoaId, availableHoas } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reparsing, setReparsing] = useState(false)
  const [progress, setProgress] = useState('')

  const selectedHoa = availableHoas.find(h => h.id === hoaId)
  const singleHoa = hoaId && hoaId !== ALL_HOAS

  async function load() {
    if (!singleHoa) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      setData(await apiGet(`/hoa/${hoaId}/ho6-summary`))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [hoaId])

  // Loop the batched re-parse until nothing remains, showing progress.
  async function handleReparse() {
    if (!singleHoa || reparsing) return
    setReparsing(true); setError('')
    let done = 0
    try {
      // Prime the total from the current summary's needs_reparse.
      let total = data?.coverage?.needs_reparse || 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const r = await apiPost(`/hoa/${hoaId}/ho6-reparse`, {})
        done += r.reparsed
        if (!total) total = done + r.remaining
        setProgress(`Re-parsed ${done}${total ? ` of ${total}` : ''}…`)
        if (r.remaining === 0 || r.batch === 0) break
      }
      setProgress('Refreshing summary…')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setReparsing(false)
      setProgress('')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <button onClick={() => navigate('/admin/dashboard')} className="text-sm text-[#54627A] hover:text-[#001842] mb-4 inline-block">
          &larr; Back to dashboard
        </button>

        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-[#0B1B33]">HO-6 Summary</h1>
            <p className="text-sm text-[#54627A] mt-0.5">
              {selectedHoa?.name || 'Association'} — declaration pages received
            </p>
          </div>
          {singleHoa && (
            <div className="text-right">
              <button
                onClick={handleReparse}
                disabled={reparsing}
                className="text-sm bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
                title="Re-runs AI extraction on dec pages missing premium / Cov C / wind-mit / water-damage data"
              >
                {reparsing ? (progress || 'Re-parsing…') : 'Re-parse dec pages'}
              </button>
              {data?.coverage?.needs_reparse > 0 && !reparsing && (
                <p className="text-xs text-[#946410] mt-1">{data.coverage.needs_reparse} policies need re-parsing</p>
              )}
            </div>
          )}
        </header>

        {!singleHoa && (
          <div className="bg-white rounded-xl border border-[#E8ECF2] p-6 text-center">
            <p className="text-sm text-[#54627A]">Select a single association from the dashboard to view its HO-6 summary.</p>
          </div>
        )}

        {error && <p className="text-sm text-[#C0492F] mb-4">{error}</p>}

        {singleHoa && loading && <p className="text-sm text-[#8493A8]">Loading…</p>}

        {singleHoa && !loading && data && (
          <>
            {/* Coverage / data-completeness banner */}
            <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-4 mb-6 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <span className="text-[#0B1B33]"><strong>{data.policy_count}</strong> HO-6 policies</span>
              <span className="text-[#54627A]"><strong className="text-[#0B1B33]">{data.coverage.with_premium}</strong> with premium</span>
              <span className="text-[#54627A]"><strong className="text-[#0B1B33]">{data.coverage.with_rate}</strong> with rate data</span>
              <span className="text-[#54627A]"><strong className="text-[#0B1B33]">{data.coverage.with_wind_mit_data}</strong> with wind-mit data</span>
              <span className="text-[#54627A]"><strong className="text-[#0B1B33]">{data.coverage.with_water_excl_data}</strong> with water-excl data</span>
            </div>

            {data.policy_count === 0 ? (
              <div className="bg-white rounded-xl border border-[#E8ECF2] p-6 text-center">
                <p className="text-sm text-[#54627A]">No HO-6 dec pages have been received for this association yet.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Carrier rankings */}
                <div className="grid md:grid-cols-3 gap-4">
                  <Card title="Top carriers by policy count">
                    <CarrierTable rows={data.top_carriers_by_count} valueLabel="Policies" valueFn={r => r.count} />
                  </Card>
                  <Card title="Top carriers by premium / policy" subtitle="Average total premium per policy">
                    <CarrierTable rows={data.top_carriers_by_premium} countKey="policies" valueLabel="Avg premium" valueFn={r => fmtMoney(r.avg_premium)} />
                  </Card>
                  <Card title="Top carriers by rate" subtitle="Premium ÷ (Cov A + Cov C) × 100">
                    <CarrierTable rows={data.top_carriers_by_rate} countKey="policies" valueLabel="Avg rate/$100" valueFn={r => fmtRate(r.avg_rate)} />
                  </Card>
                </div>

                {/* Flag lists */}
                <div className="grid md:grid-cols-2 gap-4">
                  <Card title="Lowest Cov A limits" subtitle="Up to 10 policies with the smallest dwelling limit">
                    <PolicyList rows={data.lowest_cov_a} valueLabel="Cov A" valueFn={r => fmtMoney(r.cov_a)} />
                  </Card>
                  <Card title="May have a wind exclusion" subtitle="coverage_type = HO6 wind-excluded">
                    <PolicyList rows={data.wind_exclusion} />
                  </Card>
                  <Card title="No wind-mitigation credits" subtitle="Dec page shows no wind-mit credit">
                    <PolicyList rows={data.no_wind_mitigation} />
                  </Card>
                  <Card title="May have a water-damage exclusion" subtitle="Water-damage exclusion / limitation detected">
                    <PolicyList rows={data.water_damage_exclusion} />
                  </Card>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
