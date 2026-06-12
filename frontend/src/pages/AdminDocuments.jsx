import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import { apiGet, apiPost, apiDelete, supabase } from '../supabase'
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
  const [docType, setDocType] = useState('')
  const [windFields, setWindFields] = useState({ inspection_date: '', address: '', building: '' })
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
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
      const metadata = docType === 'Wind Mitigation'
        ? Object.fromEntries(Object.entries(windFields).filter(([, v]) => v))
        : null
      // Auto-generate a name when left blank — type + building/date qualifiers
      const autoName = docType === 'Wind Mitigation'
        ? [docType, windFields.building, windFields.inspection_date].filter(Boolean).join(' — ')
        : docType
      await apiPost(`/hoa/${hoaId}/documents`, {
        name: autoName,
        file_url: data.publicUrl,
        doc_type: docType || null,
        metadata: metadata && Object.keys(metadata).length ? metadata : null,
      })

      setDocType('')
      setWindFields({ inspection_date: '', address: '', building: '' })
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

  async function handleDelete(docId) {
    if (!window.confirm('Delete this document? Unit owners will no longer see it.')) return
    setDeletingId(docId)
    try {
      await apiDelete(`/hoa/${hoaId}/documents/${docId}`)
      setDocs(ds => ds.filter(d => d.id !== docId))
    } catch (e) {
      setError(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  // ── Next-steps helper box ─────────────────────────────────────────────
  const nextSteps = []
  if (uploading) {
    nextSteps.push({ icon: '⏳', text: 'Uploading your document…', wait: true })
  } else if (success) {
    nextSteps.push({ icon: '🎉', text: 'Document uploaded and shared with all unit owners.', success: true })
  } else if (!docType) {
    nextSteps.push({ icon: '📋', text: 'Select a Document Type to get started.' })
  } else if (docType === 'Wind Mitigation' && (!windFields.inspection_date || !windFields.address)) {
    nextSteps.push({ icon: '📝', text: 'Fill in the Inspection Date and Address (Building # or Name is optional).' })
  } else if (!file) {
    nextSteps.push({ icon: '📄', text: 'Choose the file to upload.' })
  } else {
    nextSteps.push({ icon: '💾', text: 'Click Upload Document to share it with all unit owners.' })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      {nextSteps.length > 0 && (
        <div className={`fixed bottom-4 inset-x-4 sm:inset-x-auto sm:bottom-6 sm:right-6 z-50 sm:w-80 bg-white rounded-2xl shadow-xl overflow-hidden border ${nextSteps[0]?.success ? 'border-green-200' : 'border-blue-200'}`}>
          <div className={`px-4 py-3 flex items-center gap-2 ${nextSteps[0]?.success ? 'bg-green-600' : 'bg-blue-600'}`}>
            <span className="text-white font-semibold text-sm">{nextSteps[0]?.success ? '✓ Done' : 'Next Steps'}</span>
          </div>
          <ul className="p-4 space-y-3">
            {nextSteps.map((s, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                <span className="text-base leading-snug">{s.icon}</span>
                <span>
                  {!s.success && <span className="font-semibold text-blue-700">{s.wait ? 'Wait: ' : 'Next: '}</span>}
                  {s.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  docType
                    ? 'border-slate-300 bg-white focus:ring-blue-500'
                    : 'border-amber-300 bg-amber-50 focus:ring-amber-400'
                }`}
              >
                <option value="">Select a document type…</option>
                {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {docType === 'Wind Mitigation' && (
              <div className="grid sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Inspection Date</label>
                  <input
                    type="date"
                    required
                    value={windFields.inspection_date}
                    onChange={e => setWindFields(f => ({ ...f, inspection_date: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Address</label>
                  <input
                    required
                    value={windFields.address}
                    onChange={e => setWindFields(f => ({ ...f, address: e.target.value }))}
                    placeholder="123 Ocean Dr"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Building # or Name <span className="font-normal text-slate-400">(optional)</span></label>
                  <input
                    value={windFields.building}
                    onChange={e => setWindFields(f => ({ ...f, building: e.target.value }))}
                    placeholder="e.g. Building 3 or Seaside Tower"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
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

        <div className="bg-white rounded-xl border-2 border-blue-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-blue-600">
            <h2 className="font-semibold text-white">Documents Available to Unit-Owners</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Uploaded</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Link</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map(d => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{d.doc_type || '—'}</td>
                  <td className="px-4 py-3 font-medium">
                    {d.name}
                    {d.metadata && (
                      <p className="text-xs text-slate-400 font-normal mt-0.5">
                        {[
                          d.metadata.inspection_date && `Inspected ${d.metadata.inspection_date}`,
                          d.metadata.address,
                          d.metadata.building && `Building: ${d.metadata.building}`,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-xs">
                      View
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(d.id)}
                      disabled={deletingId === d.id}
                      className="text-xs font-medium text-red-500 hover:text-red-700 hover:underline disabled:opacity-50"
                    >
                      {deletingId === d.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400 italic">No documents yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
