import { useEffect, useState } from 'react'
import { apiGet } from '../supabase'

// Option list for the association switcher <select>. Super users get the list
// grouped by PM firm (plus an Independent group for unmanaged associations);
// everyone else gets the flat alphabetical list. Renders <option>/<optgroup>
// elements only — must live inside a <select>.
//
// Pass `firms` if the page already fetched GET /firms (Settings does, for its
// PM Firms card); otherwise the component fetches it itself for super users.
export default function HoaOptions({ role, hoas, firms: firmsProp }) {
  const [fetched, setFetched] = useState([])
  useEffect(() => {
    if (!firmsProp && role === 'super_user') apiGet('/firms').then(setFetched).catch(() => {})
  }, [role, !!firmsProp])
  const firms = firmsProp || fetched

  const sorted = [...hoas].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  if (role !== 'super_user' || firms.length === 0) {
    return sorted.map(h => <option key={h.id} value={h.id}>{h.name}</option>)
  }
  const inFirm = new Set(firms.flatMap(f => f.hoas.map(h => h.id)))
  const independent = sorted.filter(h => !inFirm.has(h.id))
  return (
    <>
      {firms.filter(f => f.hoas.length > 0).map(f => (
        <optgroup key={f.id} label={`Firm: ${f.name}`}>
          {f.hoas.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </optgroup>
      ))}
      <optgroup label="Independent">
        {independent.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
      </optgroup>
    </>
  )
}
