import { useRef, useState } from 'react'
import { apiUpload, apiPost } from '../supabase'

// Onboarding's first step: a property manager uploads their unit list (any
// columns, CSV or Excel). The backend has Claude map their columns to our
// schema; this wizard shows that mapping + a preview, lets the PM correct it,
// then commits. Kept as its own component to stay out of the dashboard's way.
export default function ImportWizard({ hoaId, onClose, onDone }) {
  const [stage, setStage] = useState('select') // select | preview | committing | done
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)      // preview response
  const [mapping, setMapping] = useState({})  // fieldKey -> header
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError('')
    try {
      const res = await apiUpload(`/hoa/${hoaId}/units/import/preview`, file)
      setData(res)
      setMapping(res.mapping || {})
      setStage('preview')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function setField(fieldKey, header) {
    setMapping(m => {
      const next = { ...m }
      // a header maps to at most one field — clear it from any other field
      for (const k of Object.keys(next)) if (next[k] === header) delete next[k]
      if (header) next[fieldKey] = header
      else delete next[fieldKey]
      return next
    })
  }

  async function handleCommit() {
    setBusy(true); setError(''); setStage('committing')
    try {
      const res = await apiPost(`/hoa/${hoaId}/units/import/commit`, { mapping, rows: data.rows })
      setResult(res)
      setStage('done')
      onDone?.()
    } catch (err) {
      setError(err.message)
      setStage('preview')
    } finally {
      setBusy(false)
    }
  }

  const fields = data?.fields || []
  const headers = data?.headers || []
  const rows = data?.rows || []
  const unitMapped = !!mapping.unit_number
  const importable = unitMapped ? rows.filter(r => (r[mapping.unit_number] || '').trim()).length : 0

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
              {/* Counts + issues */}
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="px-3 py-1.5 rounded-lg bg-green-50 text-green-700 font-medium border border-green-200">
                  {importable} unit{importable !== 1 ? 's' : ''} ready to import
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-slate-50 text-slate-500 border border-slate-200">
                  {data.total_rows} row{data.total_rows !== 1 ? 's' : ''} in file
                </span>
              </div>
              {data.issues?.length > 0 && (
                <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                  {data.issues.map((s, i) => <li key={i}>• {s}</li>)}
                </ul>
              )}

              {/* Column mapping */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Column matchup</p>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                  {fields.map(f => (
                    <div key={f.key} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-600">
                        {f.label}{f.required && <span className="text-red-500">*</span>}
                      </span>
                      <select
                        value={mapping[f.key] || ''}
                        onChange={e => setField(f.key, e.target.value)}
                        className={`text-sm border rounded-lg px-2 py-1.5 max-w-[55%] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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

              {/* Sample */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Preview</p>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {fields.filter(f => mapping[f.key]).map(f => (
                          <th key={f.key} className="text-left px-3 py-2 font-semibold text-slate-500">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.slice(0, 8).map((r, i) => (
                        <tr key={i}>
                          {fields.filter(f => mapping[f.key]).map(f => (
                            <td key={f.key} className="px-3 py-2 text-slate-600">{r[mapping[f.key]] || <span className="text-slate-300">—</span>}</td>
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
              <button onClick={() => { setStage('select'); setData(null) }} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">Back</button>
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
