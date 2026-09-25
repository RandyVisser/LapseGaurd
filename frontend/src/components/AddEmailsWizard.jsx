import { useEffect, useRef, useState } from 'react'
import { apiUpload, apiPost } from '../supabase'

// Bulk-add unit-owner emails to EXISTING units. Reuses the import preview
// (file parse + AI column mapping); the per-row match is then computed by the
// backend planner (/units/emails/preview) — the SAME code the commit runs — so
// the preview is exactly what gets written. Matching is on (street address,
// unit number) like the importer: unit numbers repeat across buildings, so an
// ambiguous row is refused and listed, never guessed. PM/Admin contact rows
// and renter sub-units are never matched. It only FILLS IN blank emails; a
// unit's different existing email is kept unless the admin explicitly ticks
// "replace". Never inserts a unit, never touches names/addresses.

const STATUS_VIEW = {
  fill:      { text: '✓ will add',                          cls: 'text-[#0E8E68]' },
  replace:   { text: '↻ will replace existing email',       cls: 'text-[#014AC5]' },
  unchanged: { text: 'already on file',                     cls: 'text-[#8493A8]' },
  conflict:  { text: 'has a different email — kept',        cls: 'text-[#946410]' },
  ambiguous: { text: '⚠ ambiguous — skipped',               cls: 'text-[#C0492F]' },
  no_match:  { text: 'no matching unit — skipped',          cls: 'text-[#946410]' },
  no_email:  { text: 'no email — skipped',                  cls: 'text-[#8493A8]' },
  invalid:   { text: '⚠ email looks invalid — skipped',     cls: 'text-[#946410]' },
  duplicate: { text: 'same unit as an earlier row — skipped', cls: 'text-[#8493A8]' },
}

export default function AddEmailsWizard({ hoaId, onClose, onDone }) {
  const [stage, setStage] = useState('select') // select | preview | committing | done
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [mapping, setMapping] = useState({})
  const [rows, setRows] = useState([])
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)

  const headers = data?.headers || []
  const [overwrite, setOverwrite] = useState(false)
  const [plan, setPlan] = useState(null)       // {rows, counts} from the backend planner
  const [planning, setPlanning] = useState(false)
  const planSeq = useRef(0)

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
      setPlan(null)
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

  // Re-plan on the server whenever the column matchup or the overwrite choice
  // changes. A sequence number drops stale responses from earlier edits.
  useEffect(() => {
    if (stage !== 'preview' || !rows.length) return
    if (!mapping.unit_number || !mapping.email_primary) { setPlan(null); return }
    const seq = ++planSeq.current
    setPlanning(true)
    apiPost(`/hoa/${hoaId}/units/emails/preview`, { mapping, rows, overwrite })
      .then(p => { if (seq === planSeq.current) { setPlan(p); setError('') } })
      .catch(err => { if (seq === planSeq.current) setError(err.message) })
      .finally(() => { if (seq === planSeq.current) setPlanning(false) })
  }, [stage, rows, mapping, overwrite, hoaId])

  const counts = plan?.counts || {}
  const willWrite = (counts.fill || 0) + (counts.replace || 0)
  const conflictCount = (counts.conflict || 0) + (counts.replace || 0)
  const ready = !!mapping.unit_number && !!mapping.email_primary && !!plan && !planning && willWrite > 0

  async function handleCommit() {
    setBusy(true); setError(''); setStage('committing')
    try {
      // The commit re-runs the same planner server-side, so only the rows the
      // preview marked "will add/replace" are written.
      const res = await apiPost(`/hoa/${hoaId}/units/emails/commit`, { mapping, rows, overwrite })
      setResult(res); setStage('done'); onDone?.(res)
    } catch (err) {
      setError(err.message); setStage('preview')
    } finally {
      setBusy(false)
    }
  }

  const FIELD_LABELS = [
    { key: 'unit_number', label: 'Unit number', required: true },
    { key: 'street_address', label: 'Street address', required: false },
    { key: 'email_primary', label: 'Primary email', required: true },
    { key: 'email_secondary', label: 'Secondary email', required: false },
  ]

  // Backdrop click: safe to close before a file is chosen (and after commit),
  // but during preview the admin may have fixed the column matchup — confirm
  // before throwing that away. Ignore entirely while the commit is in flight.
  function handleBackdrop() {
    if (stage === 'committing') return
    if (stage === 'preview') {
      if (!window.confirm('Discard this import and your edits?')) return
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={handleBackdrop}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8ECF2]">
          <div>
            <h2 className="font-bold text-[#0B1B33]">Add emails to existing units</h2>
            <p className="text-xs text-[#8493A8] mt-0.5">
              {stage === 'select' && 'Upload a list — we match by street address + unit number and fill in blank emails only.'}
              {stage === 'preview' && 'Check the matchup, then add the emails.'}
              {stage === 'committing' && 'Adding emails…'}
              {stage === 'done' && 'Done'}
            </p>
          </div>
          <button onClick={onClose} className="text-[#8493A8] hover:text-[#54627A] text-xl leading-none" aria-label="Close">✕</button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {error && <p className="text-sm text-[#C0492F] mb-4 bg-[#F9E1DA] border border-[#F0C4B4] rounded-lg px-3 py-2">{error}</p>}

          {stage === 'select' && (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-[#DCE3EC] rounded-xl px-6 py-12 text-center cursor-pointer hover:border-[#7CA9E8] hover:bg-slate-50"
            >
              <p className="text-3xl mb-2">✉️</p>
              <p className="text-sm font-medium text-[#54627A]">{busy ? 'Reading your file…' : 'Click to choose a CSV or Excel file'}</p>
              <p className="text-xs text-[#8493A8] mt-1">It needs a unit number and an email column; include the street address if unit numbers repeat across buildings. Blank emails get filled in — nothing else changes, and no units are created.</p>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm" className="hidden" onChange={handleFile} disabled={busy} />
            </div>
          )}

          {(stage === 'preview' || stage === 'committing') && data && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-3 text-sm">
                {planning && !plan && <span className="px-3 py-1.5 text-[#8493A8]">Matching…</span>}
                {plan && (
                  <span className="px-3 py-1.5 rounded-lg bg-[#E2F4EC] text-[#0E8E68] font-medium border border-[#BFE3D2]">
                    {willWrite} email{willWrite !== 1 ? 's' : ''} will be {overwrite && counts.replace ? 'added or replaced' : 'added'}
                  </span>
                )}
                {counts.ambiguous > 0 && (
                  <span className="px-3 py-1.5 rounded-lg bg-[#F9E1DA] text-[#C0492F] border border-[#F0C4B4]">
                    {counts.ambiguous} ambiguous — skipped
                  </span>
                )}
                {counts.conflict > 0 && (
                  <span className="px-3 py-1.5 rounded-lg bg-[#FAEDD2] text-[#946410] border border-[#F0DDAE]">
                    {counts.conflict} already ha{counts.conflict !== 1 ? 've' : 's'} a different email — kept
                  </span>
                )}
                {counts.invalid > 0 && (
                  <span className="px-3 py-1.5 rounded-lg bg-[#FAEDD2] text-[#946410] border border-[#F0DDAE]">
                    {counts.invalid} skipped — email{counts.invalid !== 1 ? 's' : ''} look{counts.invalid === 1 ? 's' : ''} invalid
                  </span>
                )}
                {counts.no_match > 0 && (
                  <span className="px-3 py-1.5 rounded-lg bg-[#FAEDD2] text-[#946410] border border-[#F0DDAE]">
                    {counts.no_match} no matching unit
                  </span>
                )}
                {(counts.unchanged > 0 || counts.duplicate > 0) && (
                  <span className="px-3 py-1.5 rounded-lg bg-slate-50 text-[#54627A] border border-[#E8ECF2]">
                    {(counts.unchanged || 0) + (counts.duplicate || 0)} already on file / repeated
                  </span>
                )}
                {counts.no_email > 0 && (
                  <span className="px-3 py-1.5 rounded-lg bg-slate-50 text-[#54627A] border border-[#E8ECF2]">
                    {counts.no_email} no email
                  </span>
                )}
              </div>

              {conflictCount > 0 && (
                <label className="flex items-start gap-2 text-sm text-[#54627A] bg-[#FDF8EC] border border-[#F0DDAE] rounded-lg px-3 py-2">
                  <input type="checkbox" className="mt-0.5" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
                  <span>
                    Replace existing emails with the ones in this file
                    <span className="block text-xs text-[#8493A8]">
                      Off: units that already have a different email keep it. On: {conflictCount} unit{conflictCount !== 1 ? 's' : ''}' email{conflictCount !== 1 ? 's' : ''} will be overwritten.
                    </span>
                  </span>
                </label>
              )}

              <div>
                <p className="text-[11px] font-semibold text-[#8493A8] uppercase tracking-widest mb-2">Which columns to use</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {FIELD_LABELS.map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-[#54627A] mb-1">{f.label}{f.required && <span className="text-[#C0492F]">*</span>}</label>
                      <select
                        value={mapping[f.key] || ''}
                        onChange={e => setField(f.key, e.target.value)}
                        className={`w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#014AC5] ${
                          f.required && !mapping[f.key] ? 'border-[#F0C4B4] bg-[#F9E1DA]' : 'border-[#E8ECF2]'
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
                <p className="text-[11px] font-semibold text-[#8493A8] uppercase tracking-widest mb-2">
                  Preview <span className="text-[#8493A8] normal-case font-normal tracking-normal">· all {rows.length} rows</span>
                </p>
                <div className="border border-[#E8ECF2] rounded-lg overflow-auto max-h-64">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-[#E8ECF2] sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-[#54627A]">Unit</th>
                        <th className="text-left px-3 py-2 font-semibold text-[#54627A]">Email</th>
                        <th className="text-left px-3 py-2 font-semibold text-[#54627A]">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8ECF2]">
                      {(plan?.rows || []).map(a => {
                        const v = STATUS_VIEW[a.status] || { text: a.status, cls: 'text-[#54627A]' }
                        const existing = a.status === 'replace' ? a.replaces : a.existing
                        return (
                          <tr key={a.row}>
                            <td className="px-3 py-1.5 text-[#0B1B33]">
                              {a.unit || '—'}
                              {(a.street_address || a.matched_address) && (
                                <span className="text-[#8493A8]"> · {a.street_address || a.matched_address}</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-[#54627A]">{[a.email_primary, a.email_secondary].filter(Boolean).join(', ') || '—'}</td>
                            <td className="px-3 py-1.5 whitespace-normal">
                              <span className={v.cls}>{v.text}</span>
                              {existing && Object.values(existing).length > 0 && (
                                <span className="block text-[#8493A8]">on file: {Object.values(existing).join(', ')}</span>
                              )}
                              {a.status === 'ambiguous' && a.reason && (
                                <span className="block text-[#8493A8]">{a.reason}</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {counts.ambiguous > 0 && (
                  <p className="text-xs text-[#8493A8] mt-2">Ambiguous rows match a unit number that exists at more than one address. Map a street address column (or fix the address) so we can tell which building it is.</p>
                )}
                {counts.no_match > 0 && (
                  <p className="text-xs text-[#8493A8] mt-2">Rows with no matching unit are left alone — no new units are created. Check the unit numbers if you expected a match.</p>
                )}
              </div>
            </div>
          )}

          {stage === 'done' && result && (
            <div className="text-center py-6">
              <p className="text-4xl mb-3">🎉</p>
              <p className="text-lg font-semibold text-[#0B1B33]">{result.updated} unit{result.updated !== 1 ? 's' : ''} updated</p>
              {result.replaced > 0 && (
                <p className="text-sm text-[#54627A] mt-1">{result.replaced} existing email{result.replaced !== 1 ? 's' : ''} replaced</p>
              )}
              {result.conflicts > 0 && (
                <p className="text-sm text-[#54627A] mt-1">{result.conflicts} unit{result.conflicts !== 1 ? 's' : ''} kept a different email already on file</p>
              )}
              {result.ambiguous_count > 0 && (
                <p className="text-sm text-[#C0492F] mt-1">{result.ambiguous_count} ambiguous row{result.ambiguous_count !== 1 ? 's' : ''} skipped: {result.ambiguous.join(', ')}</p>
              )}
              {result.unmatched_count > 0 && (
                <p className="text-sm text-[#54627A] mt-1">{result.unmatched_count} row{result.unmatched_count !== 1 ? 's' : ''} didn't match a unit</p>
              )}
              {result.unmatched?.length > 0 && (
                <p className="text-xs text-[#8493A8] mt-3">No unit found for: {result.unmatched.join(', ')}</p>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#E8ECF2] flex justify-end gap-2">
          {stage === 'preview' && (
            <>
              <button onClick={() => { setStage('select'); setData(null); setRows([]); setPlan(null); setOverwrite(false) }} className="text-sm text-[#54627A] hover:text-[#0B1B33] px-4 py-2">Back</button>
              <button
                onClick={handleCommit}
                disabled={busy || !ready}
                className="text-sm bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold px-5 py-2 rounded-lg disabled:opacity-50"
              >
                {planning ? 'Matching…' : `${overwrite && counts.replace ? 'Write' : 'Add'} ${willWrite} email${willWrite !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
          {stage === 'committing' && <span className="text-sm text-[#8493A8] px-4 py-2">Adding…</span>}
          {(stage === 'done' || stage === 'select') && (
            <button onClick={onClose} className="text-sm bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold px-5 py-2 rounded-lg">
              {stage === 'done' ? 'Done' : 'Cancel'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
