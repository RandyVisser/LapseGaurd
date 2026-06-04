import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import { apiGet, apiPost } from '../supabase'
import { useAuth } from '../context/AuthContext'

export default function AdminDocuments() {
  const { hoaId } = useAuth()
  const [docs, setDocs] = useState([])
  const [name, setName] = useState('')
  const [fileUrl, setFileUrl] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function load() {
    if (!hoaId) return
    try {
      const data = await apiGet(`/hoa/${hoaId}/documents`)
      setDocs(data)
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [hoaId])

  async function handleUpload(e) {
    e.preventDefault()
    setError(''); setSuccess('')
    try {
      await apiPost(`/hoa/${hoaId}/documents`, { name, file_url: fileUrl })
      setName(''); setFileUrl('')
      setSuccess('Document uploaded.')
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-slate-800 mb-6">Condo Association Shared Documents</h1>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8">
          <h2 className="font-semibold text-slate-700 mb-4">Upload New Document</h2>
          <form onSubmit={handleUpload} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Document Name</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Wind Mitigation Report 2024"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">File URL (Supabase Storage)</label>
              <input
                required
                value={fileUrl}
                onChange={e => setFileUrl(e.target.value)}
                placeholder="https://..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}
            <button
              type="submit"
              className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Upload
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Uploaded</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map(d => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">
                      View
                    </a>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-400 italic">No documents yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
