import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import { apiGet, apiDownload } from '../supabase'
import { useAuth } from '../context/AuthContext'
import usePageTitle from '../usePageTitle'

// Shared documents posted by the association (bylaws, master policy, notices).
// Scoped to the selected unit's association for multi-unit owners.
export default function TenantDocuments() {
  const { unitId, tenantUnits, selectUnit, profileError } = useAuth()
  const [docs, setDocs] = useState(null)
  const [error, setError] = useState('')
  const [downloadingDoc, setDownloadingDoc] = useState(null)
  usePageTitle('Building Documents')

  const activeUnit = tenantUnits.find(u => u.unit_id === unitId)

  async function downloadPrefilled(doc) {
    setDownloadingDoc(doc.id); setError('')
    try {
      const blob = await apiDownload(`/unit/${unitId}/documents/${doc.id}/prefilled`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${doc.doc_type || doc.name}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e.message)
    } finally {
      setDownloadingDoc(null)
    }
  }

  async function viewDoc(doc) {
    // Open the tab synchronously (avoids popup blockers), then load the
    // generated PDF inline — pre-filled for forms, original otherwise.
    const win = window.open('', '_blank')
    setError('')
    try {
      const blob = await apiDownload(`/unit/${unitId}/documents/${doc.id}/prefilled`)
      const url = URL.createObjectURL(blob)
      if (win) win.location = url
      else window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) {
      if (win) win.close()
      setError(e.message)
    }
  }

  useEffect(() => {
    if (!unitId) return
    setDocs(null)
    apiGet(`/unit/${unitId}/documents`)
      .then(setDocs)
      .catch(e => setError(e.message))
  }, [unitId])

  if (!unitId) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <p className="text-[#8493A8] text-sm">{profileError || 'Loading your profile…'}</p>
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
              <h1 className="text-xl font-bold text-[#0B1B33]">
                {activeUnit?.unit_number ? `Unit ${activeUnit.unit_number}` : 'Building Documents'}
              </h1>
              {activeUnit?.street_address && (
                <p className="text-sm text-[#54627A] mt-0.5">
                  {[activeUnit.street_address, activeUnit.city, [activeUnit.state, activeUnit.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                </p>
              )}
              {activeUnit?.hoa_name && (
                <p className="text-sm text-[#54627A] mt-0.5">{activeUnit.hoa_name}</p>
              )}
            </div>
            {(activeUnit?.owner_primary || activeUnit?.owner_secondary) && (
              <div className="text-right">
                {activeUnit.owner_primary && <h1 className="text-xl font-bold text-[#0B1B33]">{activeUnit.owner_primary}</h1>}
                {activeUnit.owner_secondary && <h1 className="text-xl font-bold text-[#0B1B33]">{activeUnit.owner_secondary}</h1>}
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
                      ? 'bg-[#001842] border-[#001842] text-white'
                      : 'bg-white border-[#E8ECF2] text-[#54627A] hover:border-[#7CA9E8]'
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

        <h2 className="text-base font-semibold text-[#0B1B33] mb-3">
          Building Documents
          <span className="font-normal text-[#54627A]"> — {activeUnit?.hoa_name || 'your association'}</span>
        </h2>

        {error && <p className="text-sm text-[#C0492F] mb-4">{error}</p>}

        {docs === null && !error && (
          <div className="space-y-2">
            <div className="bg-white rounded-xl border border-[#E8ECF2] h-16 animate-pulse" />
            <div className="bg-white rounded-xl border border-[#E8ECF2] h-16 animate-pulse" />
          </div>
        )}

        {docs !== null && (
          <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm overflow-x-auto">
            {docs.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-3xl mb-2">🗂</p>
                <p className="text-sm text-[#54627A]">Nothing posted yet.</p>
                <p className="text-xs text-[#8493A8] mt-1">Documents your association shares will appear here.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-[#E8ECF2]">
                  <tr>
                    <th className="text-left px-5 py-3 font-semibold text-[#54627A]">Document</th>
                    <th className="text-left px-4 py-3 font-semibold text-[#54627A] hidden sm:table-cell">Address</th>
                    <th className="text-left px-4 py-3 font-semibold text-[#54627A] hidden sm:table-cell">Building # or Name</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8ECF2]">
                  {docs.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium">
                        <button onClick={() => downloadPrefilled(d)} disabled={downloadingDoc === d.id}
                          className="text-[#014AC5] hover:underline text-left disabled:opacity-60">
                          {d.name}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-[#54627A] hidden sm:table-cell">{d.metadata?.address || d.metadata?.building_address || '—'}</td>
                      <td className="px-4 py-3 text-[#54627A] hidden sm:table-cell">{d.metadata?.building || 'ALL'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <button
                            onClick={() => viewDoc(d)}
                            className="text-xs font-semibold text-[#014AC5] border border-[#C7DBF5] bg-white hover:bg-[#E7EEFA] px-3 py-1.5 rounded-lg">
                            View
                          </button>
                          <button
                            onClick={() => downloadPrefilled(d)}
                            disabled={downloadingDoc === d.id}
                            className="text-xs font-semibold text-white bg-[#001842] hover:bg-[#0A2A63] px-3 py-1.5 rounded-lg disabled:opacity-60">
                            {downloadingDoc === d.id ? 'Preparing…' : 'Download'}
                          </button>
                        </span>
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
