import { useEffect, useState } from 'react'
import { apiGet } from '../supabase'

// Flat option descriptors for the dashboard switcher (selectableFirms mode):
// firm rows (value `firm:<id>`) followed by their associations (indent:true),
// then unmanaged associations tagged group:'Independent'. Exported so the
// dashboard's searchable combobox renders exactly the same list (same values,
// same order) as the native <select> options rendered below.
export function buildSwitcherOptions(role, hoas, firms) {
  const sorted = [...hoas].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  if (role !== 'super_user' || firms.length === 0) {
    return sorted.map(h => ({ value: h.id, label: h.name }))
  }
  const inFirm = new Set(firms.flatMap(f => f.hoas.map(h => h.id)))
  const independent = sorted.filter(h => !inFirm.has(h.id))
  return [
    ...firms.filter(f => f.hoas.length > 0).flatMap(f => [
      { value: `firm:${f.id}`, label: f.name, firm: true },
      ...f.hoas.map(h => ({ value: h.id, label: h.name, indent: true })),
    ]),
    ...independent.map(h => ({ value: h.id, label: h.name, group: 'Independent' })),
  ]
}

// Option list for the association switcher <select>. Super users get the list
// grouped by PM firm (plus an Independent group for unmanaged associations);
// everyone else gets the flat alphabetical list. Renders <option>/<optgroup>
// elements only — must live inside a <select>.
//
// Pass `firms` if the page already fetched GET /firms (Settings does, for its
// PM Firms card); otherwise the component fetches it itself for super users.
// With `selectableFirms` (the dashboard), the firm NAME itself is the option —
// picking it (value `firm:<id>`) opens the firm's whole-portfolio view, with
// its associations indented beneath it. Optgroup labels aren't clickable in
// native selects, so firm groups become options in that mode.
export default function HoaOptions({ role, hoas, firms: firmsProp, selectableFirms = false }) {
  const [fetched, setFetched] = useState([])
  useEffect(() => {
    if (!firmsProp && role === 'super_user') apiGet('/firms').then(setFetched).catch(() => {})
  }, [role, !!firmsProp])
  const firms = firmsProp || fetched

  const sorted = [...hoas].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  if (role !== 'super_user' || firms.length === 0) {
    return sorted.map(h => <option key={h.id} value={h.id}>{h.name}</option>)
  }
  if (selectableFirms) {
    const opts = buildSwitcherOptions(role, hoas, firms)
    return (
      <>
        {opts.filter(o => !o.group).map(o => (
          <option key={o.value} value={o.value}>{o.indent ? ' ' : ''}{o.label}</option>
        ))}
        <optgroup label="Independent">
          {opts.filter(o => o.group === 'Independent').map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </optgroup>
      </>
    )
  }
  return (
    <>
      {firms.filter(f => f.hoas.length > 0).map(f => (
        <optgroup key={f.id} label={`Firm: ${f.name}`}>
          {f.hoas.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </optgroup>
      ))}
      <optgroup label="Independent">
        {independentOf(sorted, firms).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
      </optgroup>
    </>
  )
}

function independentOf(sorted, firms) {
  const inFirm = new Set(firms.flatMap(f => f.hoas.map(h => h.id)))
  return sorted.filter(h => !inFirm.has(h.id))
}
