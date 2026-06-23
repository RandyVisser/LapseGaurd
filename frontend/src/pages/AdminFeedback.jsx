import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import { apiGet, apiPatch } from '../supabase'

const TYPE_META = {
  feedback: ['💬', 'Feedback', 'bg-blue-50 text-blue-700 border-blue-200'],
  feature: ['✨', 'Feature request', 'bg-purple-50 text-purple-700 border-purple-200'],
  help: ['🆘', 'Help needed', 'bg-amber-50 text-amber-800 border-amber-200'],
}

// Signup funnel — super-user only. Hides itself if analytics isn't reachable so
// it can never break the feedback page.
function FunnelCard() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { apiGet('/analytics/funnel?days=7').then(setData).catch(() => setFailed(true)) }, [])
  if (failed) return null
  const top = data?.funnel?.[0]?.count || 0
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-slate-800">Signup funnel</p>
        <span className="text-xs text-slate-400">last 7 days</span>
      </div>
      {!data ? (
        <div className="h-24 bg-slate-50 rounded animate-pulse" />
      ) : (
        <div className="space-y-2">
          {data.funnel.map(s => {
            const pct = top ? Math.round((s.count / top) * 100) : 0
            return (
              <div key={s.name} className="flex items-center gap-3">
                <span className="text-sm text-slate-600 w-32 flex-shrink-0">{s.label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                  <div className="bg-blue-500 h-5 rounded-full transition-all"
                    style={{ width: `${s.count > 0 ? Math.max(pct, 5) : 0}%` }} />
                </div>
                <span className="text-sm font-semibold text-slate-800 w-8 text-right">{s.count}</span>
              </div>
            )
          })}
          {data.extra?.some(e => e.count > 0) && (
            <div className="pt-3 mt-1 border-t border-slate-100 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
              {data.extra.map(e => <span key={e.name}>{e.label}: <b className="text-slate-700">{e.count}</b></span>)}
            </div>
          )}
          {top === 0 && <p className="text-xs text-slate-400 pt-1">No visits recorded yet.</p>}
        </div>
      )}
    </div>
  )
}

export default function AdminFeedback() {
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
            <h1 className="text-xl font-bold text-slate-800">Pilot feedback</h1>
            <p className="text-sm text-slate-500 mt-0.5">{newCount} new · {(items || []).length} total</p>
          </div>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {['new', 'all'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-sm font-medium ${filter === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                {f === 'new' ? 'New' : 'All'}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        {items === null && !error && <div className="bg-white rounded-xl border border-slate-200 h-24 animate-pulse" />}

        {items !== null && shown.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 px-6 py-12 text-center text-slate-400">
            <p className="text-3xl mb-2">📭</p>
            <p className="text-sm">{filter === 'new' ? 'No new feedback.' : 'No feedback yet.'}</p>
          </div>
        )}

        <div className="space-y-3">
          {shown.map(it => {
            const [icon, label, cls] = TYPE_META[it.type] || TYPE_META.feedback
            return (
              <div key={it.id} className={`bg-white rounded-xl border shadow-sm p-4 ${it.status === 'new' ? 'border-slate-200' : 'border-slate-100 opacity-70'}`}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{icon} {label}</span>
                  <span className="text-xs text-slate-400">{new Date(it.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{it.message}</p>
                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-100">
                  <div className="text-xs text-slate-400 min-w-0 truncate">
                    {it.email ? <a href={`mailto:${it.email}`} className="text-blue-600 hover:underline">{it.email}</a> : 'unknown'}
                    {' · '}{it.role}{it.hoa_name ? ` · ${it.hoa_name}` : ''}{it.page ? ` · ${it.page}` : ''}
                  </div>
                  <button
                    onClick={() => setStatus(it.id, it.status === 'new' ? 'resolved' : 'new')}
                    className="text-xs font-medium px-3 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex-shrink-0"
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
