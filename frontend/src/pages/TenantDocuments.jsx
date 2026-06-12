import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import { apiGet } from '../supabase'
import { useAuth } from '../context/AuthContext'

// Shared documents posted by the association (bylaws, master policy, notices).
// Scoped to the selected unit's association for multi-unit owners.
export default function TenantDocuments() {
  const { unitId, tenantUnits, selectUnit, profileError } = useAuth()
  const [docs, setDocs] = useState(null)
  const [error, setError] = useState('')

  const activeUnit = tenantUnits.find(u => u.unit_id === unitId)

  useEffect(() => {
    if (!unitId) return
    setDocs(null)
    apiGet(`/unit/${unitId}/documents`)
      .then(setDocs)
      .catch(e => setError(e.message))
  }, [unitId])

  if (!unitId) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <p className="text-slate-400 text-sm">{profileError || 'Loading your profile…'}</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="tenant" />
      <main className="max-w-2xl mx-auto px-4 py-8">

        {/* Unit context — same header as the My Policy page */}
        <header className="mb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-800">
                {activeUnit?.unit_number ? `Unit ${activeUnit.unit_number}` : 'Building Documents'}
              </h1>
              {activeUnit?.street_address && (
                <p className="text-sm text-slate-500 mt-0.5">
                  {[activeUnit.street_address, activeUnit.city, [activeUnit.state, activeUnit.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                </p>
              )}
              {activeUnit?.hoa_name && (
                <p className="text-sm text-slate-500 mt-0.5">{activeUnit.hoa_name}</p>
              )}
            </div>
            {(activeUnit?.owner_primary || activeUnit?.owner_secondary) && (
              <div className="text-right">
                {activeUnit.owner_primary && <h1 className="text-xl font-bold text-slate-800">{activeUnit.owner_primary}</h1>}
                {activeUnit.owner_secondary && <h1 className="text-xl font-bold text-slate-800">{activeUnit.owner_secondary}</h1>}
              </div>
            )}
          </div>
          {tenantUnits.length > 1 && (
            <div className="flex gap-2 flex-wrap mt-3">
              {tenantUnits.map(u => (
                <button
                  key={u.unit_id}
                  onClick={() => selectUnit(u.unit_id)}
                  className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                    u.unit_id === unitId
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'
                  }`}
                >
                  Unit {u.unit_number || '—'}
                  {u.hoa_name && tenantUnits.some(o => o.hoa_id !== u.hoa_id) && (
                    <span className="opacity-70"> · {u.hoa_name}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </header>

        <h2 className="text-base font-semibold text-slate-700 mb-3">
          Building Documents
          <span className="font-normal text-slate-500"> — {activeUnit?.hoa_name || 'your association'}</span>
        </h2>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {docs === null && !error && (
          <div className="space-y-2">
            <div className="bg-white rounded-xl border border-slate-200 h-16 animate-pulse" />
            <div className="bg-white rounded-xl border border-slate-200 h-16 animate-pulse" />
          </div>
        )}

        {docs !== null && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {docs.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-3xl mb-2">🗂</p>
                <p className="text-sm text-slate-500">Nothing posted yet.</p>
                <p className="text-xs text-slate-400 mt-1">Documents your association shares will appear here.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-5 py-3 font-semibold text-slate-600">Document</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Address</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Building # or Name</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {docs.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-700">{d.name}</td>
                      <td className="px-4 py-3 text-slate-500">{d.metadata?.address || d.metadata?.building_address || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{d.metadata?.building || 'ALL'}</td>
                      <td className="px-4 py-3 text-right">
                        <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap">
                          Open ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
