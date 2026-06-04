import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import StatusBadge from '../components/StatusBadge'
import { apiGet } from '../supabase'
import { useAuth } from '../context/AuthContext'

const QUOTE_FORM_URL = import.meta.env.VITE_QUOTE_FORM_URL || 'https://form.typeform.com/to/placeholder'

function StatCard({ label, value, color }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-1 ${color}`}>
      <span className="text-3xl font-bold">{value ?? '—'}</span>
      <span className="text-sm text-slate-500">{label}</span>
    </div>
  )
}

export default function AdminDashboard() {
  const { hoaId } = useAuth()
  const [summary, setSummary] = useState(null)
  const [units, setUnits] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!hoaId) return
    Promise.all([
      apiGet(`/hoa/${hoaId}/compliance`),
      apiGet(`/hoa/${hoaId}/units`),
    ])
      .then(([s, u]) => { setSummary(s); setUnits(u) })
      .catch(e => setError(e.message))
  }, [hoaId])

  function quoteUrl(unit) {
    const params = new URLSearchParams({
      tenant_name: unit.tenant_name || '',
      unit: unit.unit_number,
      hoa: hoaId,
    })
    return `${QUOTE_FORM_URL}?${params}`
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      <main className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-slate-800 mb-6">Compliance Overview</h1>
        {error && <p className="text-red-600 mb-4">{error}</p>}

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Units" value={summary.total_units} color="text-slate-800" />
            <StatCard label="Compliant" value={summary.compliant} color="text-green-700" />
            <StatCard label="Expiring Soon" value={summary.expiring} color="text-yellow-700" />
            <StatCard label="Lapsed / Missing" value={summary.lapsed + summary.missing} color="text-red-700" />
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Unit</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Tenant</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {units.map(u => (
                <tr key={u.unit_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{u.unit_number}</td>
                  <td className="px-4 py-3 text-slate-600">{u.tenant_name || <span className="italic text-slate-400">No tenant</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{u.tenant_email || '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                  <td className="px-4 py-3">
                    {(u.status === 'lapsed' || u.status === 'missing') && (
                      <a
                        href={quoteUrl(u)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs bg-blue-700 hover:bg-blue-800 text-white px-3 py-1 rounded-full"
                      >
                        Request Quote
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {units.length === 0 && !error && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400 italic">No units found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
