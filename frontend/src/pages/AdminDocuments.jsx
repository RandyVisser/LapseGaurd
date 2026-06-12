import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import { apiGet, apiPost, supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'

const DOC_TYPES = [
  'Wind Mitigation',
  'Association Evidence of Insurance',
  'Association Flood Dec Page',
  'Fire Alarm Form',
  'Sprinkler Alarm Form',
  'Elevation Certificate',
  'Other',
]

const HOA_FIELD_OPTIONS = {
  subdivision: { label: 'Subdivision', key: 'subdivision' },
  corp_name: { label: 'Corp Name (SunBiz)', key: 'corp_name' },
  sunbiz_doc_number: { label: 'SunBiz DOC #', key: 'sunbiz_doc_number' },
}

export default function AdminDocuments() {
  const { hoaId, role, availableHoas, setSelectedHoaId } = useAuth()
  const [docs, setDocs] = useState([])
  const [hoaFieldType, setHoaFieldType] = useState('subdivision')
  const [hoaFieldValue, setHoaFieldValue] = useState('')

  const hoaFieldValues = (() => {
    const key = HOA_FIELD_OPTIONS[hoaFieldType]?.key
    const seen = new Set()
    const vals = []
    for (const h of availableHoas) {
      const v = h[key]
      if (v && !seen.has(v)) { seen.add(v); vals.push(v) }
    }
    return vals
  })()

  function handleHoaFieldValueChange(value) {
    setHoaFieldValue(value)
    const key = HOA_FIELD_OPTIONS[hoaFieldType]?.key
    const match = availableHoas.find(h => h[key] === value)
    if (match) setSelectedHoaId(match.id)
  }
  const [name, setName] = useState('')
  const [docType, setDocType] = useState('')
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function load() {
    if (!hoaId) return
    try {
      setDocs(await apiGet(`/hoa/${hoaId}/documents`))
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [hoaId])

  async function handleUpload(e) {
    e.preventDefault()
    if (!file) { setError('Please select a file'); return }
    setError(''); setSuccess('')
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${hoaId}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('hoa-documents')
        .upload(path, file)
      if (uploadErr) throw new Error(uploadErr.message)

      const { data } = supabase.storage.from('hoa-documents').getPublicUrl(path)
      await apiPost(`/hoa/${hoaId}/documents`, { name, file_url: data.publicUrl, doc_type: docType || null })

      setName('')
      setDocType('')
      setFile(null)
      setFileInputKey(k => k + 1)
      setSuccess('Document uploaded.')
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      <main className="max-w-3xl mx-auto px-4 py-8">
        {(() => { const selectedHoa = availableHoas.find(h => h.id === hoaId); return (
          <header className="mb-6">
            <h1 className="text-xl font-bold text-slate-800">
              {selectedHoa?.name || 'Shared Documents'}
            </h1>
            {selectedHoa?.corp_name && (
              <p className="text-xs text-slate-400 mt-0.5">SunBiz: {selectedHoa.corp_name}</p>
            )}
            {selectedHoa?.sunbiz_doc_number && (
              <p className="text-xs text-slate-400 mt-0.5">SunBiz Doc #: {selectedHoa.sunbiz_doc_number}</p>
            )}
            {(role === 'super_user' || role === 'property_manager') && availableHoas.length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <select
                  value={hoaFieldType}
                  onChange={e => { setHoaFieldType(e.target.value); setHoaFieldValue('') }}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.entries(HOA_FIELD_OPTIONS).map(([key, opt]) => (
                    <option key={key} value={key}>{opt.label}</option>
                  ))}
                </select>
                <select
                  value={hoaFieldValue}
                  onChange={e => handleHoaFieldValueChange(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select {HOA_FIELD_OPTIONS[hoaFieldType]?.label}…</option>
                  {hoaFieldValues.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            )}
            <h2 className="text-base font-semibold text-slate-700 mt-4">Shared Documents</h2>
          </header>
        ) })()}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8">
          <h2 className="font-semibold text-slate-700 mb-4">Upload New Document</h2>
          <form onSubmit={handleUpload} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Document Type</label>
              <select
                required
                value={docType}
                onChange={e => setDocType(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Select a document type…</option>
                {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
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
              <label className="block text-sm font-medium text-slate-600 mb-1">File</label>
              <input
                key={fileInputKey}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                onChange={e => setFile(e.target.files[0] || null)}
                className="w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {file && <p className="text-xs text-slate-500 mt-1">{file.name}</p>}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}
            <button
              type="submit"
              disabled={uploading}
              className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
            >
              {uploading ? 'Uploading…' : 'Upload Document'}
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Uploaded</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map(d => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{d.doc_type || '—'}</td>
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-xs">
                      View
                    </a>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400 italic">No documents yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
