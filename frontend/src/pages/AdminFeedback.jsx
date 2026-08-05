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
    ['vista_royale_view', 'VR'],
  ]],
  ['Activation', [
    ['owners_invited', 'Invited'],
    ['invite_accepted', 'Accepted'],
    ['owner_upload', 'Uploads'],
    ['staff_activated', 'Staff'],
  ]],
]

const ENGAGEMENT = new Set(['demo_click', 'tour_play', 'vista_royale_view'])

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

// --- "Where they are" map -----------------------------------------------------
// Simplified Florida outline as [lon, lat] pairs, projected with the SAME
// function that places the city dots, so geometry and data can't drift apart.
// Coordinates are hand-simplified from the real coastline — recognizable, not
// surveying-grade.
const FL_OUTLINE = [
  [-87.60, 30.99], [-85.00, 31.00], [-84.86, 30.71], [-83.60, 30.65],
  [-82.55, 30.59], [-82.20, 30.57], [-82.05, 30.36], [-81.62, 30.73],
  [-81.44, 30.71], [-81.38, 30.25], [-81.26, 29.71], [-81.05, 29.14],
  [-80.53, 28.46], [-80.30, 27.50], [-80.05, 26.97], [-80.03, 26.60],
  [-80.11, 26.10], [-80.13, 25.77], [-80.30, 25.40], [-80.36, 25.19],
  [-80.90, 25.14], [-81.16, 25.22], [-81.35, 25.85], [-81.80, 26.10],
  [-81.90, 26.45], [-82.25, 26.75], [-82.55, 27.30], [-82.65, 27.70],
  [-82.85, 28.17], [-82.70, 28.90], [-83.00, 29.13], [-83.60, 29.90],
  [-84.35, 30.06], [-84.90, 29.72], [-85.35, 29.68], [-85.70, 30.10],
  [-86.45, 30.38], [-87.20, 30.33], [-87.45, 30.30],
]
const FL_KEYS = [
  [-80.45, 25.15], [-80.60, 24.95], [-81.10, 24.72], [-81.55, 24.63], [-81.80, 24.55],
]
// Equirectangular, x compressed by cos(mid-latitude) so Florida keeps its shape.
const projGeo = ([lon, lat]) => [(lon + 87.7) * 42 * 0.885, (31.15 - lat) * 42]
const geoPath = (pts, close) =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${projGeo(p).map(n => n.toFixed(1)).join(' ')}`).join('') + (close ? 'Z' : '')

// Proportional-symbol map of Florida sessions + the outside-FL remainder.
// Outbound (mailers/Apollo) only targets Florida, so non-FL traffic is listed
// as a discount column, not mapped. Dot area scales with sessions; top cities
// are direct-labeled, every dot has a native tooltip, and the list beside the
// map carries the exact numbers.
function GeoSection({ geo }) {
  if (!geo) return null // backend predating migration 048
  const fl = geo.florida || []
  const outside = geo.outside || []
  const max = Math.max(1, ...fl.map(c => c.sessions))
  const flTotal = fl.reduce((n, c) => n + c.sessions, 0)
  const outsideTotal = outside.reduce((n, o) => n + o.sessions, 0)
  return (
    <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4 pt-4 mt-4 border-t border-[#E8ECF2]">
      <div>
        <Eyebrow>Where they are — Florida ({flTotal})</Eyebrow>
        <svg viewBox="0 0 296 288" className="w-full max-w-[280px]" role="img"
          aria-label={`Florida map: ${flTotal} sessions across ${fl.length} cities`}>
          <path d={geoPath(FL_OUTLINE, true)} fill="#EEF2F8" stroke="#DCE3EC" strokeWidth="1" strokeLinejoin="round" />
          <path d={geoPath(FL_KEYS)} fill="none" stroke="#DCE3EC" strokeWidth="2.5" strokeLinecap="round" />
          {!fl.length && (
            <text x="148" y="140" textAnchor="middle" className="fill-[#8493A8]" fontSize="11">
              No located sessions yet
            </text>
          )}
          {fl.map((c, i) => {
              const [x, y] = projGeo([c.lon, c.lat])
              const r = 4 + 8 * Math.sqrt(c.sessions / max)
              const labelLeft = x > 210
              return (
                <g key={`${c.city}-${i}`}>
                  <circle cx={x} cy={y} r={r} fill="#014AC5" fillOpacity=".78" stroke="#fff" strokeWidth="2" />
                  {i < 3 && (
                    <text x={labelLeft ? x - r - 4 : x + r + 4} y={y + 3}
                      textAnchor={labelLeft ? 'end' : 'start'}
                      className="fill-[#54627A]" fontSize="10">{c.city}</text>
                  )}
                  <title>{`${c.city}: ${c.sessions} session${c.sessions === 1 ? '' : 's'}`}</title>
                </g>
              )
            })}
          </svg>
        <p className="text-[10px] text-[#8493A8] mt-1">
          {fl.length
            ? 'Dot size = sessions. Location is city-level, resolved and discarded at ingest.'
            : 'Location is captured from Aug 5 onward — dots appear as new visitors arrive.'}
        </p>
      </div>
      <div className="space-y-4">
        <MiniList title="Top Florida cities" rows={fl.slice(0, 6).map(c => ({ where: c.city, sessions: c.sessions }))} nameKey="where" />
        <MiniList title={`Outside Florida (${outsideTotal}) — likely noise`} rows={outside} nameKey="where" />
        {geo?.unknown > 0 && (
          <p className="text-[10px] text-[#8493A8]">
            {geo.unknown} session{geo.unknown === 1 ? '' : 's'} without location (recorded before geo shipped, or lookup failed).
          </p>
        )}
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

          {top > 0 && (data.depth || []).length > 0 && (
            <div className="pt-4 mt-4 border-t border-[#E8ECF2]">
              <Eyebrow>Page depth — where visitors stop</Eyebrow>
              <div className="space-y-2">
                {data.depth.map((s, i) => {
                  const prev = i > 0 ? data.depth[i - 1].count : 0
                  return (
                    <MeterRow key={s.name} label={s.label} count={s.count} max={data.depth[0]?.count || top}
                      conv={i > 0 && prev > 0 ? Math.round((s.count / prev) * 100) : null}
                      bar="bg-[#014AC5]" track="bg-[#E7EEFA]" />
                  )
                })}
              </div>
            </div>
          )}

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

          {data.signups?.length > 0 && (
            <div className="pt-4 mt-4 border-t border-[#E8ECF2]">
              <Eyebrow>Signups — stitched to source</Eyebrow>
              <div className="space-y-1.5">
                {data.signups.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 flex-shrink-0 ${s.kind === 'firm' ? 'bg-[#E2E8F5] text-[#001842]' : 'bg-[#E7EEFA] text-[#014AC5]'}`}>
                        {s.kind === 'firm' ? 'Firm' : 'Assoc'}
                      </span>
                      <span className="text-xs font-semibold text-[#0B1B33] truncate">{s.name}</span>
                    </div>
                    <span className="text-xs text-[#54627A] flex-shrink-0 truncate max-w-[55%] text-right" style={{ fontFamily: MONO }}>
                      {s.source}{s.days_seen > 1 ? ` · ${s.days_seen} days on site` : ''}
                    </span>
                  </div>
                ))}
              </div>
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

          <GeoSection geo={data.geo} />
        </div>
      )}

      {data?.scanners_filtered > 0 && (
        <p className="text-[11px] text-[#8493A8] pt-3">
          {data.scanners_filtered} bot session{data.scanners_filtered === 1 ? '' : 's'} filtered
          out — email link scanners &amp; headless browsers that pass the UA check but scroll
          the whole page in under 4 seconds.
        </p>
      )}
    </div>
  )
}

// Friendly names for the static /guides/ pages. Falls back to the slug, so a
// new guide shows up here without needing an entry.
const GUIDE_LABELS = {
  '/guides/index.html': 'Guides index',
  '/guides/florida-condo-insurance-requirements.html': 'FL insurance requirements',
  '/guides/florida-condo-milestone-inspection-sirs.html': 'Milestone inspections & SIRS',
  '/guides/florida-condo-insurance-statistics.html': 'FL insurance statistics',
  '/guides/florida-condo-loss-assessment-coverage.html': 'Loss assessment coverage',
  '/guides/what-is-a-declarations-page.html': 'What is a dec page',
  '/guides/ho6-vs-ho4-vs-wind-only.html': 'HO-6 vs HO-4 vs wind-only',
  '/guides/hoa-insurance-compliance-tracking.html': 'Compliance tracking',
  '/guides/loss-assessment-calculator.html': 'Loss assessment calculator',
  '/guides/ho6-compliance-cost-calculator.html': 'Cost calculator',
}

function guideLabel(path) {
  if (GUIDE_LABELS[path]) return GUIDE_LABELS[path]
  return (path || '').replace('/guides/', '').replace(/\.html$/, '') || 'unknown'
}

// Bucket → [label, pill classes]. 'search' and 'ai' are the two that tell us the
// SEO/GEO work is landing; everything else is context.
const BUCKET_META = {
  search: ['Organic search', 'bg-[#E7EEFA] text-[#014AC5] border-[#C7DBF5]'],
  ai: ['AI assistants', 'bg-[#E2F4EC] text-[#0E8E68] border-[#BFE5D5]'],
  campaign: ['Tagged campaign', 'bg-[#FAEDD2] text-[#946410] border-[#F0DDAE]'],
  referral: ['Referral', 'bg-slate-100 text-[#54627A] border-slate-200'],
  direct: ['Direct', 'bg-slate-50 text-[#8493A8] border-slate-200'],
}

// Guide-page traffic — super-user only. Same self-hiding behaviour as
// FunnelCard: if analytics isn't reachable it renders nothing rather than
// breaking the feedback page.
function PagesCard() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState('pages') // pages | sources
  const [days, setDays] = useState(30)
  useEffect(() => {
    setData(null)
    apiGet(`/analytics/pages?days=${days}`).then(setData).catch(() => setFailed(true))
  }, [days])
  if (failed) return null

  const buckets = Object.fromEntries((data?.buckets || []).map(b => [b.bucket, b.sessions]))
  const maxPage = Math.max(1, ...(data?.pages || []).map(p => p.sessions))
  const maxSource = Math.max(1, ...(data?.sources || []).map(s => s.sessions))
  const findable = (buckets.search || 0) + (buckets.ai || 0)

  return (
    <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <p className="font-semibold text-[#0B1B33]">Guide pages</p>
          <p className="text-xs text-[#8493A8] mt-0.5">
            Organic reach from the /guides/ reference pages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Toggle options={[[7, '7d'], [30, '30d'], [90, '90d']]} value={days} onChange={setDays} />
          <Toggle options={[['pages', 'Pages'], ['sources', 'Sources']]} value={view} onChange={setView} />
        </div>
      </div>

      {!data ? (
        <div className="h-40 bg-slate-50 rounded animate-pulse" />
      ) : data.total_sessions === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-[#54627A]">No guide traffic yet in this window.</p>
          <p className="text-xs text-[#8493A8] mt-1">
            Indexing typically takes days to weeks after a sitemap submission.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Readers', data.total_sessions, 'text-[#0B1B33]'],
              ['Found us via search or AI', findable, 'text-[#0E8E68]'],
              ['AI assistants', buckets.ai || 0, 'text-[#0E8E68]'],
              ['Went on to sign up', data.converted, 'text-[#014AC5]'],
            ].map(([label, n, cls]) => (
              <div key={label} className="rounded-lg border border-[#E8ECF2] px-3 py-2.5">
                <p style={{ fontFamily: MONO }} className={`text-xl font-bold ${cls}`}>{n}</p>
                <p className="text-[11px] text-[#54627A] leading-tight mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {view === 'pages' ? (
            <div className="space-y-1.5">
              <Eyebrow>Most-read guides</Eyebrow>
              {data.pages.map(p => (
                <div key={p.path} className="flex items-center gap-3"
                  title={`${p.path} — ${p.sessions} readers, ${p.views} views`}>
                  <span className="text-sm text-[#54627A] w-52 flex-shrink-0 truncate">{guideLabel(p.path)}</span>
                  <div className="flex-1 h-4 rounded-r bg-[#E7EEFA]">
                    <div className="h-4 rounded-r bg-[#014AC5]"
                      style={{ width: `${(p.sessions / maxPage) * 100}%`, minWidth: p.sessions > 0 ? 3 : 0 }} />
                  </div>
                  <span style={{ fontFamily: MONO }} className="text-sm font-semibold text-[#0B1B33] w-9 text-right">{p.sessions}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Eyebrow>Where guide readers came from</Eyebrow>
              {data.sources.map(s => {
                const [bLabel, cls] = BUCKET_META[s.bucket] || BUCKET_META.referral
                return (
                  <div key={`${s.bucket}:${s.label}`} className="flex items-center gap-3" title={bLabel}>
                    <span className="w-52 flex-shrink-0 flex items-center gap-1.5 min-w-0">
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${cls}`}>
                        {bLabel}
                      </span>
                      <span className="text-xs text-[#54627A] truncate">{s.label}</span>
                    </span>
                    <div className="flex-1 h-4 rounded-r bg-slate-100">
                      <div className="h-4 rounded-r bg-[#54627A]"
                        style={{ width: `${(s.sessions / maxSource) * 100}%`, minWidth: s.sessions > 0 ? 3 : 0 }} />
                    </div>
                    <span style={{ fontFamily: MONO }} className="text-sm font-semibold text-[#0B1B33] w-9 text-right">{s.sessions}</span>
                  </div>
                )
              })}
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
        <PagesCard />
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
