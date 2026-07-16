import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import usePageTitle from '../usePageTitle'
import { apiGet, apiPatch } from '../supabase'

const TYPE_META = {
  feedback: ['💬', 'Feedback', 'bg-[#E7EEFA] text-[#014AC5] border-[#C7DBF5]'],
  feature: ['✨', 'Feature request', 'bg-[#E2E8F5] text-[#001842] border-[#C7D2E8]'],
  help: ['🆘', 'Help needed', 'bg-[#FAEDD2] text-[#946410] border-[#F0DDAE]'],
}

// Signup funnel — super-user only. Hides itself if analytics isn't reachable so
// it can never break the feedback page.
const MONO = '"JetBrains Mono", monospace'
const DAILY_COLS = [
  ['landing_view', 'Visits'],
  ['pricing_view', 'Pricing'],
  ['signup_started', 'Started'],
  ['signup_completed', 'Signed up'],
  ['owners_invited', 'Invited'],
  ['invite_accepted', 'Accepted'],
  ['owner_upload', 'Uploads'],
  ['staff_activated', 'Staff'],
  ['demo_click', 'Demo'],
  ['tour_play', 'Tour'],
]

function fmtDay(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function FunnelCard() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState('totals') // totals | daily
  useEffect(() => { apiGet('/analytics/funnel?days=7').then(setData).catch(() => setFailed(true)) }, [])
  if (failed) return null
  const top = data?.funnel?.[0]?.count || 0
  return (
    <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <p className="font-semibold text-[#0B1B33]">Signup funnel</p>
          <span className="text-xs text-[#8493A8]">last 7 days</span>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          {[['totals', 'Totals'], ['daily', 'Per day']].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 py-0.5 rounded-md text-xs font-medium ${view === v ? 'bg-white text-[#0B1B33] shadow-sm' : 'text-[#54627A]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {!data ? (
        <div className="h-24 bg-slate-50 rounded animate-pulse" />
      ) : view === 'daily' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#8493A8]">
                <th className="text-left font-medium py-1 pr-2">Day</th>
                {DAILY_COLS.map(([k, label]) => (
                  <th key={k} className="text-right font-medium py-1 px-1.5 whitespace-nowrap">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.daily || []).map(d => (
                <tr key={d.day} className="border-t border-[#F1F4F9]">
                  <td className="py-1.5 pr-2 text-[#54627A] whitespace-nowrap">{fmtDay(d.day)}</td>
                  {DAILY_COLS.map(([k]) => {
                    const n = d.counts?.[k] || 0
                    return (
                      <td key={k} style={{ fontFamily: MONO }}
                        className={`py-1.5 px-1.5 text-right ${n ? 'font-semibold text-[#0B1B33]' : 'text-[#C6CFDC]'}`}>
                        {n || '·'}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {!(data.daily || []).length && (
                <tr><td colSpan={DAILY_COLS.length + 1} className="py-3 text-[#8493A8]">
                  Per-day data needs the latest backend — redeploy and reload.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2">
          {data.funnel.map(s => {
            const pct = top ? Math.round((s.count / top) * 100) : 0
            return (
              <div key={s.name} className="flex items-center gap-3">
                <span className="text-sm text-[#54627A] w-32 flex-shrink-0">{s.label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                  <div className="bg-[#014AC5] h-5 rounded-full transition-all"
                    style={{ width: `${s.count > 0 ? Math.max(pct, 5) : 0}%` }} />
                </div>
                <span className="text-sm font-semibold text-[#0B1B33] w-8 text-right">{s.count}</span>
              </div>
            )
          })}
          {data.extra?.length > 0 && (() => {
            const extraMax = Math.max(1, ...data.extra.map(e => e.count))
            return (
              <div className="pt-3 mt-1 border-t border-[#E8ECF2] space-y-2">
                {data.extra.map(e => {
                  const pct = Math.round((e.count / extraMax) * 100)
                  return (
                    <div key={e.name} className="flex items-center gap-3">
                      <span className="text-sm text-[#54627A] w-32 flex-shrink-0">{e.label}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                        <div className="bg-[#0E8E68] h-5 rounded-full transition-all"
                          style={{ width: `${e.count > 0 ? Math.max(pct, 5) : 0}%` }} />
                      </div>
                      <span className="text-sm font-semibold text-[#0B1B33] w-8 text-right">{e.count}</span>
                    </div>
                  )
                })}
              </div>
            )
          })()}
          {data.sources?.length > 0 && (
            <div className="pt-3 mt-1 border-t border-[#E8ECF2]">
              <p className="text-xs text-[#8493A8] mb-1.5">Where visitors came from</p>
              <div className="space-y-1">
                {data.sources.map(s => (
                  <div key={s.source} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[#54627A] truncate">{s.source}</span>
                    <span className="text-xs font-semibold text-[#0B1B33] flex-shrink-0">{s.sessions}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.devices?.length > 0 && (
            <div className="pt-3 mt-1 border-t border-[#E8ECF2]">
              <p className="text-xs text-[#8493A8] mb-1.5">What they browse on</p>
              <div className="space-y-1">
                {data.devices.map(d => (
                  <div key={d.device} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[#54627A] truncate">{d.device}</span>
                    <span className="text-xs font-semibold text-[#0B1B33] flex-shrink-0">{d.sessions}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {top === 0 && <p className="text-xs text-[#8493A8] pt-1">No visits recorded yet.</p>}
        </div>
      )}
    </div>
  )
}

export default function AdminFeedback() {
  usePageTitle('Feedback')
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('new') // new | all

  function load() {
    apiGet('/feedback').then(setItems).catch(e => setError(e.message))
  }
  useEffect(load, [])

  async function setStatus(id, status) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i))
    try { await apiPatch(`/feedback/${id}`, { status }) } catch (e) { setError(e.message); load() }
  }

  const shown = (items || []).filter(i => filter === 'all' || i.status === 'new')
  const newCount = (items || []).filter(i => i.status === 'new').length

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" title="Feedback" />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <FunnelCard />
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-[#0B1B33]">Pilot feedback</h1>
            <p className="text-sm text-[#54627A] mt-0.5">{newCount} new · {(items || []).length} total</p>
          </div>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {['new', 'all'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-sm font-medium ${filter === f ? 'bg-white text-[#0B1B33] shadow-sm' : 'text-[#54627A]'}`}>
                {f === 'new' ? 'New' : 'All'}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-[#C0492F] mb-4">{error}</p>}
        {items === null && !error && <div className="bg-white rounded-xl border border-[#E8ECF2] h-24 animate-pulse" />}

        {items !== null && shown.length === 0 && (
          <div className="bg-white rounded-xl border border-[#E8ECF2] px-6 py-12 text-center text-[#8493A8]">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-sm">{filter === 'new' ? 'No new feedback.' : 'No feedback yet.'}</p>
          </div>
        )}

        <div className="space-y-3">
          {shown.map(it => {
            const [icon, label, cls] = TYPE_META[it.type] || TYPE_META.feedback
            return (
              <div key={it.id} className={`bg-white rounded-xl border shadow-sm p-4 ${it.status === 'new' ? 'border-[#E8ECF2]' : 'border-slate-100 opacity-70'}`}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{icon} {label}</span>
                  <span className="text-xs text-[#8493A8]">{new Date(it.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-[#0B1B33] whitespace-pre-wrap">{it.message}</p>
                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-100">
                  <div className="text-xs text-[#8493A8] min-w-0 truncate">
                    {it.email ? <a href={`mailto:${it.email}`} className="text-[#014AC5] hover:underline">{it.email}</a> : 'unknown'}
                    {' · '}{it.role}{it.hoa_name ? ` · ${it.hoa_name}` : ''}{it.page ? ` · ${it.page}` : ''}
                  </div>
                  <button
                    onClick={() => setStatus(it.id, it.status === 'new' ? 'resolved' : 'new')}
                    className="text-xs font-medium px-3 py-1 rounded-lg border border-[#E8ECF2] text-[#54627A] hover:bg-slate-50 flex-shrink-0"
                  >
                    {it.status === 'new' ? 'Mark resolved' : 'Reopen'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
