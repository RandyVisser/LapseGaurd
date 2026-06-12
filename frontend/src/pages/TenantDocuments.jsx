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
              <ul className="divide-y divide-slate-100">
                {docs.map(d => (
                  <li key={d.id}>
                    <a
                      href={d.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{d.name}</p>
                        </div>
                      </div>
                      <span className="text-xs font-medium text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        Open ↗
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
