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

// Per-day table columns, grouped the way the totals view reads: prospects
// moving down the funnel, then owner/staff activation.
const DAILY_GROUPS = [
  ['Prospects', [
    ['landing_view', 'Visits'],
    ['pricing_view', 'Pricing'],
    ['signup_started', 'Started'],
    ['signup_completed', 'Signed up'],
    ['demo_click', 'Demo'],
    ['tour_play', 'Tour'],
  ]],
  ['Activation', [
    ['owners_invited', 'Invited'],
    ['invite_accepted', 'Accepted'],
    ['owner_upload', 'Uploads'],
    ['staff_activated', 'Staff'],
  ]],
]

const ENGAGEMENT = new Set(['demo_click', 'tour_play'])

function fmtDay(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function Eyebrow({ children }) {
  return (
    <p style={{ fontFamily: MONO, letterSpacing: '.14em' }} className="text-[10px] uppercase text-[#8493A8] mb-2">
      {children}
    </p>
  )
}

// One meter row: square-baseline bar with a rounded data-end, on a lighter
// track of the same ramp. The count wears ink (never the bar color); conv is
// the share of the previous funnel step that made it here.
function MeterRow({ label, count, max, conv, bar, track }) {
  const pct = max ? (count / max) * 100 : 0
  const title = `${label}: ${count}${conv != null ? ` — ${conv}% of the previous step` : ''}`
  return (
    <div className="flex items-center gap-3" title={title}>
      <span className="text-sm text-[#54627A] w-40 flex-shrink-0">{label}</span>
      <div className={`flex-1 h-4 rounded-r ${track}`}>
        <div className={`h-4 rounded-r ${bar}`}
          style={{ width: `${pct}%`, minWidth: count > 0 ? 3 : 0 }} />
      </div>
      <span style={{ fontFamily: MONO }} className="text-sm font-semibold text-[#0B1B33] w-9 text-right">{count}</span>
      <span style={{ fontFamily: MONO }} className="text-[10px] text-[#8493A8] w-12 text-right">
        {conv != null ? `→ ${conv}%` : ''}
      </span>
    </div>
  )
}

function MiniList({ title, rows, nameKey }) {
  if (!rows?.length) return null
  return (
    <div>
      <Eyebrow>{title}</Eyebrow>
      <div className="space-y-1">
        {rows.map(r => (
          <div key={r[nameKey]} className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#54627A] truncate">{r[nameKey]}</span>
            <span style={{ fontFamily: MONO }} className="text-xs font-semibold text-[#0B1B33] flex-shrink-0">{r.sessions}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Toggle({ options, value, onChange }) {
  return (
    <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-2.5 py-0.5 rounded-md text-xs font-medium ${value === v ? 'bg-white text-[#0B1B33] shadow-sm' : 'text-[#54627A]'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

function FunnelCard() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState('totals') // totals | daily
  const [days, setDays] = useState(7)
  useEffect(() => {
    setData(null)
    apiGet(`/analytics/funnel?days=${days}`).then(setData).catch(() => setFailed(true))
  }, [days])
  if (failed) return null

  const funnel = data?.funnel || []
  const top = funnel[0]?.count || 0
  const engagement = (data?.extra || []).filter(e => ENGAGEMENT.has(e.name))
  const activation = (data?.extra || []).filter(e => !ENGAGEMENT.has(e.name))
  const actMax = Math.max(1, ...activation.map(e => e.count))
  const colCount = DAILY_GROUPS.reduce((n, [, cols]) => n + cols.length, 0)

  return (
    <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <p className="font-semibold text-[#0B1B33]">Signup funnel</p>
        <div className="flex items-center gap-2">
          <Toggle options={[[7, '7d'], [30, '30d'], [90, '90d']]} value={days} onChange={setDays} />
          <Toggle options={[['totals', 'Totals'], ['daily', 'Per day']]} value={view} onChange={setView} />
        </div>
      </div>

      {!data ? (
        <div className="h-40 bg-slate-50 rounded animate-pulse" />
      ) : view === 'daily' ? (
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th></th>
                {DAILY_GROUPS.map(([group, cols], gi) => (
                  <th key={group} colSpan={cols.length}
                    style={{ fontFamily: MONO, letterSpacing: '.14em' }}
                    className={`text-[9px] uppercase font-medium text-[#8493A8] pb-0.5 text-center ${gi > 0 ? 'border-l border-[#E8ECF2]' : ''}`}>
                    {group}
                  </th>
                ))}
              </tr>
              <tr className="text-[#8493A8]">
                <th className="text-left font-medium py-1 pr-2">Day</th>
                {DAILY_GROUPS.map(([, cols], gi) =>
                  cols.map(([k, label], ci) => (
                    <th key={k} className={`text-right font-medium py-1 px-1.5 whitespace-nowrap ${gi > 0 && ci === 0 ? 'border-l border-[#E8ECF2]' : ''}`}>
                      {label}
                    </th>
                  )))}
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
              {(data.daily || []).map(d => (
                <tr key={d.day} className="border-t border-[#F1F4F9]">
                  <td className="py-1.5 pr-2 text-[#54627A] whitespace-nowrap">{fmtDay(d.day)}</td>
                  {DAILY_GROUPS.map(([, cols], gi) =>
                    cols.map(([k], ci) => {
                      const n = d.counts?.[k] || 0
                      return (
                        <td key={k} style={{ fontFamily: MONO }}
                          className={`py-1.5 px-1.5 text-right ${n ? 'font-semibold text-[#0B1B33]' : 'text-[#C6CFDC]'} ${gi > 0 && ci === 0 ? 'border-l border-[#E8ECF2]' : ''}`}>
                          {n || '·'}
                        </td>
                      )
                    }))}
                </tr>
              ))}
              {!(data.daily || []).length && (
                <tr><td colSpan={colCount + 1} className="py-3 text-[#8493A8]">
                  Per-day data needs the latest backend — redeploy and reload.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <Eyebrow>Prospects</Eyebrow>
          <div className="space-y-2">
            {funnel.map((s, i) => {
              const prev = i > 0 ? funnel[i - 1].count : 0
              return (
                <MeterRow key={s.name} label={s.label} count={s.count} max={top}
                  conv={i > 0 && prev > 0 ? Math.round((s.count / prev) * 100) : null}
                  bar="bg-[#014AC5]" track="bg-[#E7EEFA]" />
              )
            })}
          </div>
          {top === 0 && <p className="text-xs text-[#8493A8] pt-2">No visits recorded in this window yet.</p>}

          {engagement.length > 0 && (
            <div className="flex gap-2 pt-4">
              {engagement.map(e => (
                <div key={e.name} className="flex items-baseline gap-2 rounded-lg border border-[#E8ECF2] px-3 py-1.5">
                  <span style={{ fontFamily: MONO }} className="text-base font-semibold text-[#0B1B33]">{e.count}</span>
                  <span className="text-xs text-[#54627A]">{e.label}</span>
                </div>
              ))}
            </div>
          )}

          {activation.length > 0 && (
            <div className="pt-4 mt-4 border-t border-[#E8ECF2]">
              <Eyebrow>Owner &amp; staff activation</Eyebrow>
              <div className="space-y-2">
                {activation.map(e => (
                  <MeterRow key={e.name} label={e.label} count={e.count} max={actMax}
                    bar="bg-[#0E8E68]" track="bg-[#E2F4EC]" />
                ))}
              </div>
            </div>
          )}

          {(data.sources?.length > 0 || data.devices?.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4 pt-4 mt-4 border-t border-[#E8ECF2]">
              <MiniList title="Where they came from" rows={data.sources} nameKey="source" />
              <MiniList title="What they browse on" rows={data.devices} nameKey="device" />
            </div>
          )}
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
