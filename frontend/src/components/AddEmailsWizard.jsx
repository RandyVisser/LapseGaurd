import { useMemo, useRef, useState } from 'react'
import { apiUpload, apiPost } from '../supabase'

// Bulk-add unit-owner emails to EXISTING units (matched by unit number).
// Reuses the import preview (file parse + AI column mapping), but the commit
// only writes email fields onto units that already exist — it never inserts a
// unit and never touches names/addresses. That keeps the PropertyRadar-built
// data safe: at worst a row doesn't match and is reported back, not created.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Mirror of the backend _norm_unit so the preview's match/skip counts agree.
function normUnit(s) {
  return (s || '').trim().toUpperCase().replace(/^(APT|UNIT|STE|SUITE|#)\.?\s*/, '').replace(/#/g, '').trim()
}

export default function AddEmailsWizard({ hoaId, existingUnits = [], onClose, onDone }) {
  const [stage, setStage] = useState('select') // select | preview | committing | done
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [mapping, setMapping] = useState({})
  const [rows, setRows] = useState([])
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)

  const headers = data?.headers || []
  const existingKeys = useMemo(
    () => new Set(existingUnits.map(u => normUnit(u.unit_number))),
    [existingUnits]
  )

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setBusy(true); setError('')
    try {
      const res = await apiUpload(`/hoa/${hoaId}/units/import/preview`, file)
      setData(res)
      setMapping(res.mapping || {})
      setRows(res.rows || [])
      setStage('preview')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function setField(fieldKey, header) {
    setMapping(m => {
      const next = { ...m }
      if (header) next[fieldKey] = header
      else delete next[fieldKey]
      return next
    })
  }

  // Per-row classification for the preview, recomputed when mapping changes
  const analysis = useMemo(() => {
    const uCol = mapping.unit_number
    const pCol = mapping.email_primary
    const sCol = mapping.email_secondary
    return rows.map(r => {
      const unit = uCol ? (r[uCol] || '').trim() : ''
      const email = [pCol && r[pCol], sCol && r[sCol]].filter(Boolean).map(v => (v || '').trim()).find(Boolean) || ''
      const hasEmail = !!email
      const validEmail = hasEmail && EMAIL_RE.test(email)
      const matches = !!unit && existingKeys.has(normUnit(unit))
      return { unit, email, hasEmail, validEmail, matches }
    })
  }, [rows, mapping, existingKeys])

  const counts = useMemo(() => {
    let willUpdate = 0, noMatch = 0, noEmail = 0
    for (const a of analysis) {
      if (!a.hasEmail) noEmail++
      else if (!a.matches) noMatch++
      else willUpdate++
    }
    return { willUpdate, noMatch, noEmail }
  }, [analysis])

  const ready = !!mapping.unit_number && !!mapping.email_primary && counts.willUpdate > 0

  async function handleCommit() {
    setBusy(true); setError(''); setStage('committing')
    try {
      const res = await apiPost(`/hoa/${hoaId}/units/emails/commit`, { mapping, rows })
      setResult(res); setStage('done'); onDone?.()
    } catch (err) {
      setError(err.message); setStage('preview')
    } finally {
      setBusy(false)
    }
  }

  const FIELD_LABELS = [
    { key: 'unit_number', label: 'Unit number', required: true },
    { key: 'email_primary', label: 'Primary email', required: true },
    { key: 'email_secondary', label: 'Secondary email', required: false },
  ]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-bold text-slate-800">Add emails to existing units</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {stage === 'select' && 'Upload a list — we match by unit number and fill in emails only.'}
              {stage === 'preview' && 'Check the matchup, then add the emails.'}
              {stage === 'committing' && 'Adding emails…'}
              {stage === 'done' && 'Done'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">✕</button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {error && <p className="text-sm text-red-600 mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          {stage === 'select' && (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-xl px-6 py-12 text-center cursor-pointer hover:border-blue-400 hover:bg-slate-50"
            >
              <p className="text-3xl mb-2">✉️</p>
              <p className="text-sm font-medium text-slate-600">{busy ? 'Reading your file…' : 'Click to choose a CSV or Excel file'}</p>
              <p className="text-xs text-slate-400 mt-1">It only needs a unit number and an email column. Existing units get the email — nothing else changes, and no units are created.</p>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm" className="hidden" onChange={handleFile} disabled={busy} />
            </div>
          )}

          {(stage === 'preview' || stage === 'committing') && data && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="px-3 py-1.5 rounded-lg bg-green-50 text-green-700 font-medium border border-green-200">
                  {counts.willUpdate} email{counts.willUpdate !== 1 ? 's' : ''} will be added
                </span>
                {counts.noMatch > 0 && (
                  <span className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                    {counts.noMatch} no matching unit
                  </span>
                )}
                {counts.noEmail > 0 && (
                  <span className="px-3 py-1.5 rounded-lg bg-slate-50 text-slate-500 border border-slate-200">
                    {counts.noEmail} no email
                  </span>
                )}
              </div>

              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Which columns to use</p>
                <div className="grid sm:grid-cols-3 gap-3">
                  {FIELD_LABELS.map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-slate-500 mb-1">{f.label}{f.required && <span className="text-red-500">*</span>}</label>
                      <select
                        value={mapping[f.key] || ''}
                        onChange={e => setField(f.key, e.target.value)}
                        className={`w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          f.required && !mapping[f.key] ? 'border-red-300 bg-red-50' : 'border-slate-200'
                        }`}
                      >
                        <option value="">— not in file —</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
                  Preview <span className="text-slate-300 normal-case font-normal tracking-normal">· all {rows.length} rows</span>
                </p>
                <div className="border border-slate-200 rounded-lg overflow-auto max-h-64">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-slate-500">Unit</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-500">Email</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analysis.map((a, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 text-slate-700">{a.unit || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-600">{a.email || '—'}</td>
                          <td className="px-3 py-1.5">
                            {!a.hasEmail
                              ? <span className="text-slate-400">no email — skipped</span>
                              : !a.matches
                              ? <span className="text-amber-600">no matching unit — skipped</span>
                              : a.validEmail
                              ? <span className="text-green-600">✓ will add</span>
                              : <span className="text-amber-600">⚠ email looks invalid</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {counts.noMatch > 0 && (
                  <p className="text-xs text-slate-400 mt-2">Rows with no matching unit are left alone — no new units are created. Check the unit numbers if you expected a match.</p>
                )}
              </div>
            </div>
          )}

          {stage === 'done' && result && (
            <div className="text-center py-6">
              <p className="text-4xl mb-3">🎉</p>
              <p className="text-lg font-semibold text-slate-800">{result.updated} email{result.updated !== 1 ? 's' : ''} added</p>
              {(result.unmatched_count > 0) && (
                <p className="text-sm text-slate-500 mt-1">{result.unmatched_count} row{result.unmatched_count !== 1 ? 's' : ''} didn't match a unit</p>
              )}
              {result.skipped > 0 && (
                <p className="text-sm text-slate-400 mt-1">{result.skipped} skipped (no email)</p>
              )}
              {result.unmatched?.length > 0 && (
                <p className="text-xs text-slate-400 mt-3">No unit found for: {result.unmatched.join(', ')}</p>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          {stage === 'preview' && (
            <>
              <button onClick={() => { setStage('select'); setData(null); setRows([]) }} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">Back</button>
              <button
                onClick={handleCommit}
                disabled={busy || !ready}
                className="text-sm bg-blue-700 hover:bg-blue-800 text-white font-semibold px-5 py-2 rounded-lg disabled:opacity-50"
              >
                Add {counts.willUpdate} email{counts.willUpdate !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {stage === 'committing' && <span className="text-sm text-slate-400 px-4 py-2">Adding…</span>}
          {(stage === 'done' || stage === 'select') && (
            <button onClick={onClose} className="text-sm bg-slate-800 hover:bg-slate-900 text-white font-semibold px-5 py-2 rounded-lg">
              {stage === 'done' ? 'Done' : 'Cancel'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
