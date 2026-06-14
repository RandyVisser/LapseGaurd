import { useEffect, useMemo, useRef, useState } from 'react'
import { apiUpload, apiPost } from '../supabase'

// Onboarding's first step: a property manager uploads their unit list (any
// columns, CSV or Excel). The backend has Claude map their columns to our
// schema; this wizard shows that mapping + a preview, lets the PM correct it,
// then commits. Kept as its own component to stay out of the dashboard's way.

// Light client-side mirrors of the backend normalization, used only to flag
// rows live in the preview (the commit is still validated server-side).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const UNIT_IN_ADDR = /\b(APT|UNIT|STE|SUITE|PH|#)\s*(\S+)/i

function looksLikeDate(s) {
  const v = (s || '').trim()
  if (!v) return true // blank is fine (optional)
  return (
    /^\d{4}-\d{1,2}-\d{1,2}/.test(v) ||                 // ISO
    /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(v) ||          // 1/15/2024, 01-15-24
    /^[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}/.test(v)      // Jan 15, 2024
  )
}

export default function ImportWizard({ hoaId, onClose, onDone }) {
  const [stage, setStage] = useState('select') // select | preview | committing | done
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [mapping, setMapping] = useState({})
  const [rows, setRows] = useState([])          // editable copy of the raw rows
  const [result, setResult] = useState(null)
  const [hoverIssue, setHoverIssue] = useState(null) // 'unit' | 'email' | 'date'
  const fileRef = useRef(null)
  const tableScrollRef = useRef(null)

  const fields = data?.fields || []
  const headers = data?.headers || []

  async function handleFile(e) {
    const file = e.target.files?.[0]
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
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Inline edit: write the new value back to the raw row's mapped column, so
  // the fix flows through normalization at commit (and re-flags live)
  function editCell(rowIdx, fieldKey, value) {
    const col = mapping[fieldKey]
    if (!col) return
    setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [col]: value } : r))
  }

  function setField(fieldKey, header) {
    setMapping(m => {
      const next = { ...m }
      for (const k of Object.keys(next)) if (next[k] === header) delete next[k]
      if (header) next[fieldKey] = header
      else delete next[fieldKey]
      return next
    })
  }

  // Per-row analysis, recomputed whenever the mapping changes
  const analysis = useMemo(() => {
    const uCol = mapping.unit_number, sCol = mapping.street_address
    const eCols = ['email_primary', 'email_secondary'].map(k => mapping[k]).filter(Boolean)
    const dCol = mapping.purchase_date
    return rows.map(r => {
      const unitVal = uCol ? (r[uCol] || '').trim() : ''
      const embedded = !unitVal && sCol && UNIT_IN_ADDR.test(r[sCol] || '')
      const missingUnit = !unitVal && !embedded
      const badEmails = eCols.filter(c => {
        const v = (r[c] || '').trim()
        return v && !EMAIL_RE.test(v)
      })
      const badDate = dCol ? !looksLikeDate(r[dCol]) : false
      return { missingUnit, badEmails, badDate }
    })
  }, [rows, mapping])

  const counts = useMemo(() => {
    let unit = 0, email = 0, date = 0
    for (const a of analysis) {
      if (a.missingUnit) unit++
      if (a.badEmails.length) email++
      if (a.badDate) date++
    }
    return { unit, email, date }
  }, [analysis])

  const importable = analysis.filter(a => !a.missingUnit).length
  const unitMapped = !!mapping.unit_number

  const issueItems = [
    counts.unit && { key: 'unit', text: `${counts.unit} row${counts.unit !== 1 ? 's have' : ' has'} no unit number — will be skipped` },
    counts.email && { key: 'email', text: `${counts.email} email${counts.email !== 1 ? 's' : ''} look${counts.email === 1 ? 's' : ''} invalid — fix below or import as-is` },
    counts.date && { key: 'date', text: `${counts.date} purchase date${counts.date !== 1 ? 's' : ''} couldn't be read — fix below or leave blank` },
  ].filter(Boolean)

  // When a warning is hovered, scroll the first matching row into view so the
  // highlight isn't off-screen
  useEffect(() => {
    if (!hoverIssue) return
    const idx = analysis.findIndex(a =>
      (hoverIssue === 'unit' && a.missingUnit) ||
      (hoverIssue === 'email' && a.badEmails.length) ||
      (hoverIssue === 'date' && a.badDate))
    const container = tableScrollRef.current
    if (idx < 0 || !container) return
    const tr = container.querySelector(`tr[data-ri="${idx}"]`)
    if (!tr) return
    const cRect = container.getBoundingClientRect()
    const rRect = tr.getBoundingClientRect()
    const delta = (rRect.top - cRect.top) - (container.clientHeight / 2 - tr.clientHeight / 2)
    container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' })
  }, [hoverIssue, analysis])

  async function handleCommit() {
    setBusy(true); setError(''); setStage('committing')
    try {
      const res = await apiPost(`/hoa/${hoaId}/units/import/commit`, { mapping, rows })
      setResult(res); setStage('done'); onDone?.()
    } catch (err) {
      setError(err.message); setStage('preview')
    } finally {
      setBusy(false)
    }
  }

  const shownFields = fields.filter(f => mapping[f.key])

  function cellClass(fieldKey, a) {
    if (hoverIssue === 'unit' && fieldKey === 'unit_number' && a.missingUnit)
      return 'bg-red-100 ring-2 ring-inset ring-red-400'
    if (hoverIssue === 'email' && a.badEmails.includes(mapping[fieldKey]))
      return 'bg-amber-100 ring-2 ring-inset ring-amber-400'
    if (hoverIssue === 'date' && fieldKey === 'purchase_date' && a.badDate)
      return 'bg-amber-100 ring-2 ring-inset ring-amber-400'
    return ''
  }

  function rowClass(a) {
    if (hoverIssue === 'unit' && a.missingUnit) return 'bg-red-50'
    if (hoverIssue === 'email' && a.badEmails.length) return 'bg-amber-50'
    if (hoverIssue === 'date' && a.badDate) return 'bg-amber-50'
    return ''
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-bold text-slate-800">Import units</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {stage === 'select' && 'Upload your owner list — any spreadsheet works'}
              {stage === 'preview' && 'We read your columns. Check the matchup, then import.'}
              {stage === 'committing' && 'Importing…'}
              {stage === 'done' && 'Import complete'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">✕</button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {error && <p className="text-sm text-red-600 mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          {/* ── Select ─────────────────────────────────────────────── */}
          {stage === 'select' && (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-xl px-6 py-12 text-center cursor-pointer hover:border-blue-400 hover:bg-slate-50"
            >
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm font-medium text-slate-600">{busy ? 'Reading your file…' : 'Click to choose a CSV or Excel file'}</p>
              <p className="text-xs text-slate-400 mt-1">We'll figure out your columns automatically — they don't need to match anything.</p>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm" className="hidden" onChange={handleFile} disabled={busy} />
            </div>
          )}

          {/* ── Preview ────────────────────────────────────────────── */}
          {(stage === 'preview' || stage === 'committing') && data && (
            <div className="space-y-5">
              {/* Counts */}
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="px-3 py-1.5 rounded-lg bg-green-50 text-green-700 font-medium border border-green-200">
                  {importable} unit{importable !== 1 ? 's' : ''} ready to import
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-slate-50 text-slate-500 border border-slate-200">
                  {rows.length} row{rows.length !== 1 ? 's' : ''} in file
                </span>
              </div>

              {/* Column mapping */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Column matchup</p>
                <p className="text-xs text-slate-500 mb-3">
                  Each row is a field <strong>we</strong> track, matched to the column from <strong>your</strong> file.
                  Fix any that look wrong, or choose <em>“— not in file —”</em> if you don't have it.
                  <span className="text-red-500"> *</span> is required.
                </p>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                  {fields.map(f => (
                    <div key={f.key} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-slate-600 flex-shrink-0">
                        {f.label}{f.required && <span className="text-red-500">*</span>}
                      </span>
                      <span className="text-slate-300 text-xs">←</span>
                      <select
                        value={mapping[f.key] || ''}
                        onChange={e => setField(f.key, e.target.value)}
                        className={`text-sm border rounded-lg px-2 py-1.5 flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          f.required && !mapping[f.key] ? 'border-red-300 bg-red-50' : 'border-slate-200'
                        }`}
                      >
                        <option value="">— not in file —</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {!unitMapped && (
                  <p className="text-xs text-red-600 mt-2">Pick the column that holds the unit number — it's required.</p>
                )}
              </div>

              {/* Warnings sit directly above the table so hovering reveals the
                  highlighted rows without them scrolling out of view */}
              {issueItems.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 -mb-2">
                  <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide mb-1">Hover a warning to highlight those rows below</p>
                  <ul className="text-xs text-amber-800 space-y-1">
                    {issueItems.map(it => (
                      <li
                        key={it.key}
                        onMouseEnter={() => setHoverIssue(it.key)}
                        onMouseLeave={() => setHoverIssue(null)}
                        className="cursor-default rounded px-1 -mx-1 hover:bg-amber-100"
                      >
                        • {it.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Preview — editable so the PM can fix data before importing;
                  scrolls on its own so long lists don't blow out the wizard */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
                  Preview <span className="text-slate-300 normal-case font-normal tracking-normal">· all {rows.length} rows · click any cell to edit</span>
                </p>
                <div ref={tableScrollRef} className="border border-slate-200 rounded-lg overflow-auto max-h-64">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                      <tr>
                        {shownFields.map(f => (
                          <th key={f.key} className="text-left px-3 py-2 font-semibold text-slate-500">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((r, i) => (
                        <tr key={i} data-ri={i} className={rowClass(analysis[i])}>
                          {shownFields.map(f => (
                            <td key={f.key} className={`px-1 py-0.5 ${cellClass(f.key, analysis[i])}`}>
                              <input
                                value={r[mapping[f.key]] ?? ''}
                                onChange={e => editCell(i, f.key, e.target.value)}
                                placeholder="—"
                                className="w-full min-w-[80px] bg-transparent px-2 py-1.5 text-slate-700 rounded focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-400 placeholder:text-slate-300"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Done ───────────────────────────────────────────────── */}
          {stage === 'done' && result && (
            <div className="text-center py-6">
              <p className="text-4xl mb-3">🎉</p>
              <p className="text-lg font-semibold text-slate-800">{result.inserted} unit{result.inserted !== 1 ? 's' : ''} imported</p>
              {result.skipped > 0 && (
                <p className="text-sm text-slate-500 mt-1">{result.skipped} skipped</p>
              )}
              {result.errors?.length > 0 && (
                <ul className="text-xs text-slate-500 mt-4 text-left max-w-sm mx-auto bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => <li key={i}>Unit {e.unit}: {e.reason}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          {stage === 'preview' && (
            <>
              <button onClick={() => { setStage('select'); setData(null); setRows([]) }} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">Back</button>
              <button
                onClick={handleCommit}
                disabled={busy || !unitMapped || importable === 0}
                className="text-sm bg-blue-700 hover:bg-blue-800 text-white font-semibold px-5 py-2 rounded-lg disabled:opacity-50"
              >
                Import {importable} unit{importable !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {stage === 'committing' && <span className="text-sm text-slate-400 px-4 py-2">Importing…</span>}
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
