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

// Effective expiration for a document — stored date, or inspection date + 5 years for wind mits
function docExpiration(d) {
  let exp = d.metadata?.expiration_date
  if (!exp && d.metadata?.inspection_date) {
    const dt = new Date(d.metadata.inspection_date + 'T00:00:00')
    dt.setFullYear(dt.getFullYear() + 5)
    exp = dt.toISOString().slice(0, 10)
  }
  return exp || null
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
  if (isNaN(d)) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((d - today) / 86400000)
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
  return isNaN(d) ? '—' : d.toLocaleDateString()
}

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
  const [eoiFields, setEoiFields] = useState({ eoi_date: '', expiration_date: '' })
  const [floodFields, setFloodFields] = useState({ building_address: '', building: '', expiration_date: '' })
  const [fireFields, setFireFields] = useState({ date_signed: '', address: '', building: '' })
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
      const addYears = (dateStr, years) => {
        if (!dateStr) return ''
        const d = new Date(dateStr + 'T00:00:00'); d.setFullYear(d.getFullYear() + years)
        return d.toISOString().slice(0, 10)
      }
      // Wind mitigation inspections are valid for 5 years
      const windExpiration = addYears(windFields.inspection_date, 5)
      // Fire alarm forms are valid for 1 year from signing
      const fireExpiration = addYears(fireFields.date_signed, 1)
      const metadata = docType === 'Wind Mitigation'
        ? Object.fromEntries(Object.entries({ ...windFields, expiration_date: windExpiration }).filter(([, v]) => v))
        : docType === 'Association Evidence of Insurance'
        ? Object.fromEntries(Object.entries(eoiFields).filter(([, v]) => v))
        : docType === 'Association Flood Dec Page'
        ? Object.fromEntries(Object.entries(floodFields).filter(([, v]) => v))
        : docType === 'Fire Alarm Form'
        ? Object.fromEntries(Object.entries({ ...fireFields, expiration_date: fireExpiration }).filter(([, v]) => v))
        : null
      // Auto-generate a name when left blank — type + building/date qualifiers
      const autoName = docType === 'Wind Mitigation'
        ? [docType, windFields.building, windFields.inspection_date].filter(Boolean).join(' — ')
        : docType === 'Association Evidence of Insurance'
        ? [docType, eoiFields.eoi_date].filter(Boolean).join(' — ')
        : docType === 'Association Flood Dec Page'
        ? [docType, floodFields.building, floodFields.building_address].filter(Boolean).join(' — ')
        : docType === 'Fire Alarm Form'
        ? [docType, fireFields.building, fireFields.date_signed].filter(Boolean).join(' — ')
        : docType
      await apiPost(`/hoa/${hoaId}/documents`, {
        name: autoName,
        file_url: data.publicUrl,
        doc_type: docType || null,
        metadata: metadata && Object.keys(metadata).length ? metadata : null,
      })

      setDocType('')
      setWindFields({ inspection_date: '', address: '', building: '' })
      setEoiFields({ eoi_date: '', expiration_date: '' })
      setFloodFields({ building_address: '', building: '', expiration_date: '' })
      setFireFields({ date_signed: '', address: '', building: '' })
      setFile(null)
      setFileInputKey(k => k + 1)
      setSuccess('Document uploaded.')
      // Full reload so expiration highlighting and all derived state start fresh
      setTimeout(() => window.location.reload(), 800)
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
  } else if (docType === 'Association Evidence of Insurance' && (!eoiFields.eoi_date || !eoiFields.expiration_date)) {
    nextSteps.push({ icon: '📝', text: 'Fill in the EOI Date and Expiration Date.' })
  } else if (docType === 'Association Flood Dec Page' && (!floodFields.building_address || !floodFields.expiration_date)) {
    nextSteps.push({ icon: '📝', text: 'Fill in the Building Address and Expiration Date.' })
  } else if (docType === 'Fire Alarm Form' && (!fireFields.date_signed || !fireFields.address)) {
    nextSteps.push({ icon: '📝', text: 'Fill in the Date Signed and Address (Building # is optional).' })
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
      <main className="max-w-full mx-auto px-4 py-8">
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
            {docType === 'Association Flood Dec Page' && (
              <div className="grid sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Building Address</label>
                  <input
                    required
                    value={floodFields.building_address}
                    onChange={e => setFloodFields(f => ({ ...f, building_address: e.target.value }))}
                    placeholder="123 Ocean Dr"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Building # or Name <span className="font-normal text-slate-400">(optional)</span></label>
                  <input
                    value={floodFields.building}
                    onChange={e => setFloodFields(f => ({ ...f, building: e.target.value }))}
                    placeholder="e.g. Building 3 or Seaside Tower"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Expiration Date</label>
                  <input
                    type="date"
                    required
                    value={floodFields.expiration_date}
                    onChange={e => setFloodFields(f => ({ ...f, expiration_date: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
            {docType === 'Fire Alarm Form' && (
              <div className="grid sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Date Signed</label>
                  <input
                    type="date"
                    required
                    value={fireFields.date_signed}
                    onChange={e => setFireFields(f => ({ ...f, date_signed: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Address</label>
                  <input
                    required
                    value={fireFields.address}
                    onChange={e => setFireFields(f => ({ ...f, address: e.target.value }))}
                    placeholder="123 Ocean Dr"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Building # or Name <span className="font-normal text-slate-400">(optional)</span></label>
                  <input
                    value={fireFields.building}
                    onChange={e => setFireFields(f => ({ ...f, building: e.target.value }))}
                    placeholder="e.g. Building 3 or Seaside Tower"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
            {docType === 'Association Evidence of Insurance' && (
              <div className="grid sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">EOI Date</label>
                  <input
                    type="date"
                    required
                    value={eoiFields.eoi_date}
                    onChange={e => setEoiFields(f => ({ ...f, eoi_date: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Expiration Date</label>
                  <input
                    type="date"
                    required
                    value={eoiFields.expiration_date}
                    onChange={e => setEoiFields(f => ({ ...f, expiration_date: e.target.value }))}
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
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Document Date</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Address</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Building #</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Uploaded</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Expires</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Link</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map(d => {
                const exp = docExpiration(d)
                const days = daysUntil(exp)
                const rowColor = days !== null && days < 0
                  ? 'bg-red-50 hover:bg-red-100'
                  : days !== null && days <= 30
                  ? 'bg-amber-50 hover:bg-amber-100'
                  : 'hover:bg-slate-50'
                return (
                <tr key={d.id} className={rowColor}>
                  <td className="px-4 py-3 text-slate-600">{d.doc_type || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{(() => {
                    const date = d.metadata?.inspection_date || d.metadata?.eoi_date || d.metadata?.date_signed
                    return fmtDate(date)
                  })()}</td>
                  <td className="px-4 py-3 text-slate-500">{d.metadata?.address || d.metadata?.building_address || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{d.metadata?.building || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className={`px-4 py-3 ${days !== null && days < 0 ? 'text-red-700 font-semibold' : days !== null && days <= 30 ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
                    {fmtDate(exp)}
                    {days !== null && days < 0 && <span className="ml-1.5 text-xs">(expired)</span>}
                  </td>
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
              )})}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400 italic">No documents yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
