import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import { apiGet, apiPost, apiDelete, supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'
import usePageTitle from '../usePageTitle'

const DOC_TYPES = [
  'Wind Mitigation',
  'Association Evidence of Insurance',
  'Association Flood Dec Page',
  'Sprinkler and Fire Alarm Form',
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
  name: { label: 'Association Name', key: 'name' },
  dpbr_license_number: { label: 'DPBR Lic #', key: 'dpbr_license_number' },
  fein: { label: 'FEIN #', key: 'fein' },
  corp_name: { label: 'Corp Name (SunBiz)', key: 'corp_name' },
  sunbiz_doc_number: { label: 'SunBiz DOC #', key: 'sunbiz_doc_number' },
}

const ALL_HOAS = '__all__'

export default function AdminDocuments() {
  const { hoaId, role, availableHoas, setSelectedHoaId } = useAuth()
  usePageTitle('Documents')
  const [docs, setDocs] = useState([])
  const [hoaFieldType, setHoaFieldType] = useState('name')
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
    if (value === ALL_HOAS) {
      setSelectedHoaId(ALL_HOAS)
      return
    }
    const key = HOA_FIELD_OPTIONS[hoaFieldType]?.key
    const match = availableHoas.find(h => h[key] === value)
    if (match) setSelectedHoaId(match.id)
  }
  const [docType, setDocType] = useState('')
  const [windFields, setWindFields] = useState({ inspection_date: '', address: '', building: '' })
  const [eoiFields, setEoiFields] = useState({ eoi_date: '', expiration_date: '' })
  const [floodFields, setFloodFields] = useState({ building_address: '', building: '', expiration_date: '' })
  const [fireFields, setFireFields] = useState({ date_signed: '', address: '', building: '' })
  const [elevFields, setElevFields] = useState({ date_signed: '', address: '', building: '' })
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  // Email-a-document dialog
  const [emailDoc, setEmailDoc] = useState(null)
  const [emailTo, setEmailTo] = useState('')
  const [emailNote, setEmailNote] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailErr, setEmailErr] = useState('')
  const [emailSent, setEmailSent] = useState('')

  async function handleEmailDocument(e) {
    e.preventDefault()
    setEmailSending(true); setEmailErr('')
    try {
      await apiPost(`/hoa/${hoaId}/documents/${emailDoc.id}/email`, {
        email: emailTo.trim(),
        note: emailNote.trim() || undefined,
      })
      setEmailSent(`Sent to ${emailTo.trim()}.`)
      setEmailDoc(null)
      setTimeout(() => setEmailSent(''), 5000)
    } catch (err) {
      setEmailErr(err.message)
    } finally {
      setEmailSending(false)
    }
  }

  async function load() {
    if (!hoaId || hoaId === '__all__') { setDocs([]); return }
    try {
      setDocs(await apiGet(`/hoa/${hoaId}/documents`))
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [hoaId])

  async function handleUpload(e) {
    e.preventDefault()
    if (!hoaId || hoaId === '__all__') { setError('Select a single association first'); return }
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
      // Fire and sprinkler alarm forms are valid for 1 year from signing
      const fireExpiration = addYears(fireFields.date_signed, 1)
      const metadata = docType === 'Wind Mitigation'
        ? Object.fromEntries(Object.entries({ ...windFields, expiration_date: windExpiration }).filter(([, v]) => v))
        : docType === 'Association Evidence of Insurance'
        ? Object.fromEntries(Object.entries(eoiFields).filter(([, v]) => v))
        : docType === 'Association Flood Dec Page'
        ? Object.fromEntries(Object.entries(floodFields).filter(([, v]) => v))
        : docType === 'Sprinkler and Fire Alarm Form'
        ? Object.fromEntries(Object.entries({ ...fireFields, expiration_date: fireExpiration }).filter(([, v]) => v))
        : docType === 'Elevation Certificate'
        ? Object.fromEntries(Object.entries(elevFields).filter(([, v]) => v))
        : null
      // Auto-generate a name when left blank — type + building/date qualifiers
      const autoName = docType === 'Wind Mitigation'
        ? [docType, windFields.building, windFields.inspection_date].filter(Boolean).join(' — ')
        : docType === 'Association Evidence of Insurance'
        ? [docType, eoiFields.eoi_date].filter(Boolean).join(' — ')
        : docType === 'Association Flood Dec Page'
        ? [docType, floodFields.building, floodFields.building_address].filter(Boolean).join(' — ')
        : docType === 'Sprinkler and Fire Alarm Form'
        ? [docType, fireFields.building, fireFields.date_signed].filter(Boolean).join(' — ')
        : docType === 'Elevation Certificate'
        ? [docType, elevFields.building, elevFields.date_signed].filter(Boolean).join(' — ')
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
      setElevFields({ date_signed: '', address: '', building: '' })
      setFile(null)
      setFileInputKey(k => k + 1)
      setSuccess('Document uploaded.')
      // Re-fetch the docs list (refreshes expiration highlighting) without a full
      // page reload, which would drop the selected association for PMs/super users
      await load()
      setTimeout(() => setSuccess(''), 4000)
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
  if (hoaId === ALL_HOAS) {
    nextSteps.push({ icon: '🏢', text: 'Select a single association above to view or upload its documents.' })
  } else if (uploading) {
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
  } else if (docType === 'Sprinkler and Fire Alarm Form' && (!fireFields.date_signed || !fireFields.address)) {
    nextSteps.push({ icon: '📝', text: 'Fill in the Date Signed and Address (Building # is optional).' })
  } else if (docType === 'Elevation Certificate' && (!elevFields.date_signed || !elevFields.address)) {
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
        <div className={`fixed bottom-4 inset-x-4 sm:inset-x-auto sm:bottom-6 sm:right-6 z-50 sm:w-80 bg-white rounded-2xl shadow-xl overflow-hidden border ${nextSteps[0]?.success ? 'border-[#BFE3D2]' : 'border-[#C7DBF5]'}`}>
          <div className={`px-4 py-3 flex items-center gap-2 ${nextSteps[0]?.success ? 'bg-[#0E8E68]' : 'bg-[#014AC5]'}`}>
            <span className="text-white font-semibold text-sm">{nextSteps[0]?.success ? '✓ Done' : 'Next Steps'}</span>
          </div>
          <ul className="p-4 space-y-3">
            {nextSteps.map((s, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-[#0B1B33]">
                <span className="text-base leading-snug">{s.icon}</span>
                <span>
                  {!s.success && <span className="font-semibold text-[#014AC5]">{s.wait ? 'Wait: ' : 'Next: '}</span>}
                  {s.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <main className="max-w-full mx-auto px-4 pt-8 pb-44">
        {(() => { const selectedHoa = availableHoas.find(h => h.id === hoaId); return (
          <header className="mb-6">
            <h1 className="text-xl font-bold text-[#0B1B33]">
              {hoaId === ALL_HOAS ? 'All Associations' : (selectedHoa?.name || 'Shared Documents')}
            </h1>
            {selectedHoa?.corp_name && (
              <p className="text-xs text-[#8493A8] mt-0.5">SunBiz: {selectedHoa.corp_name}</p>
            )}
            {selectedHoa?.sunbiz_doc_number && (
              <p className="text-xs text-[#8493A8] mt-0.5">SunBiz Doc #: {selectedHoa.sunbiz_doc_number}</p>
            )}
            {(role === 'super_user' || role === 'property_manager') && availableHoas.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {/* Primary: pick any association by name (works for every HOA,
                    including signup-created ones with no PropRadar fields) */}
                <select
                  value={hoaId || ''}
                  onChange={e => { setHoaFieldValue(''); setSelectedHoaId(e.target.value) }}
                  className="border border-[#DCE3EC] rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                >
                  <option value={ALL_HOAS}>All Associations</option>
                  {[...availableHoas].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                    .map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
                <span className="text-xs text-[#8493A8]">or search by</span>
                <select
                  value={hoaFieldType}
                  onChange={e => { setHoaFieldType(e.target.value); setHoaFieldValue('') }}
                  className="border border-[#DCE3EC] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                >
                  {Object.entries(HOA_FIELD_OPTIONS).map(([key, opt]) => (
                    <option key={key} value={key}>{opt.label}</option>
                  ))}
                </select>
                <select
                  value={hoaFieldValue}
                  onChange={e => handleHoaFieldValueChange(e.target.value)}
                  className="border border-[#DCE3EC] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                >
                  <option value="">Select {HOA_FIELD_OPTIONS[hoaFieldType]?.label}…</option>
                  <option value={ALL_HOAS}>All</option>
                  {hoaFieldValues.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            )}
            <h2 className="text-base font-semibold text-[#0B1B33] mt-4">Shared Documents</h2>
          </header>
        ) })()}

        {/* Uploads need a single association — hidden in the all-associations view */}
        {hoaId !== ALL_HOAS && (
        <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6 mb-8">
          <h2 className="font-semibold text-[#0B1B33] mb-4">Upload New Document</h2>
          <form onSubmit={handleUpload} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-[#54627A] mb-1">Document Type</label>
              <select
                required
                value={docType}
                onChange={e => setDocType(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  docType
                    ? 'border-[#DCE3EC] bg-white focus:ring-[#014AC5]'
                    : 'border-[#EAC98A] bg-[#FAEDD2] focus:ring-[#946410]'
                }`}
              >
                <option value="">Select a document type…</option>
                {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {docType === 'Wind Mitigation' && (
              <div className="grid sm:grid-cols-3 gap-3 bg-slate-50 border border-[#E8ECF2] rounded-lg p-3">
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Inspection Date</label>
                  <input
                    type="date"
                    required
                    value={windFields.inspection_date}
                    onChange={e => setWindFields(f => ({ ...f, inspection_date: e.target.value }))}
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Address</label>
                  <input
                    required
                    value={windFields.address}
                    onChange={e => setWindFields(f => ({ ...f, address: e.target.value }))}
                    placeholder="123 Ocean Dr"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Building # or Name <span className="font-normal text-[#8493A8]">(optional)</span></label>
                  <input
                    value={windFields.building}
                    onChange={e => setWindFields(f => ({ ...f, building: e.target.value }))}
                    placeholder="e.g. Building 3 or Seaside Tower"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
              </div>
            )}
            {docType === 'Association Flood Dec Page' && (
              <div className="grid sm:grid-cols-3 gap-3 bg-slate-50 border border-[#E8ECF2] rounded-lg p-3">
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Building Address</label>
                  <input
                    required
                    value={floodFields.building_address}
                    onChange={e => setFloodFields(f => ({ ...f, building_address: e.target.value }))}
                    placeholder="123 Ocean Dr"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Building # or Name <span className="font-normal text-[#8493A8]">(optional)</span></label>
                  <input
                    value={floodFields.building}
                    onChange={e => setFloodFields(f => ({ ...f, building: e.target.value }))}
                    placeholder="e.g. Building 3 or Seaside Tower"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Expiration Date</label>
                  <input
                    type="date"
                    required
                    value={floodFields.expiration_date}
                    onChange={e => setFloodFields(f => ({ ...f, expiration_date: e.target.value }))}
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
              </div>
            )}
            {docType === 'Sprinkler and Fire Alarm Form' && (
              <div className="grid sm:grid-cols-3 gap-3 bg-slate-50 border border-[#E8ECF2] rounded-lg p-3">
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Date Signed</label>
                  <input
                    type="date"
                    required
                    value={fireFields.date_signed}
                    onChange={e => setFireFields(f => ({ ...f, date_signed: e.target.value }))}
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Address</label>
                  <input
                    required
                    value={fireFields.address}
                    onChange={e => setFireFields(f => ({ ...f, address: e.target.value }))}
                    placeholder="123 Ocean Dr"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Building # or Name <span className="font-normal text-[#8493A8]">(optional)</span></label>
                  <input
                    value={fireFields.building}
                    onChange={e => setFireFields(f => ({ ...f, building: e.target.value }))}
                    placeholder="e.g. Building 3 or Seaside Tower"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
              </div>
            )}
            {docType === 'Elevation Certificate' && (
              <div className="grid sm:grid-cols-3 gap-3 bg-slate-50 border border-[#E8ECF2] rounded-lg p-3">
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Date Signed</label>
                  <input
                    type="date"
                    required
                    value={elevFields.date_signed}
                    onChange={e => setElevFields(f => ({ ...f, date_signed: e.target.value }))}
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Address</label>
                  <input
                    required
                    value={elevFields.address}
                    onChange={e => setElevFields(f => ({ ...f, address: e.target.value }))}
                    placeholder="123 Ocean Dr"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Building # or Name <span className="font-normal text-[#8493A8]">(optional)</span></label>
                  <input
                    value={elevFields.building}
                    onChange={e => setElevFields(f => ({ ...f, building: e.target.value }))}
                    placeholder="e.g. Building 3 or Seaside Tower"
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
              </div>
            )}
            {docType === 'Association Evidence of Insurance' && (
              <div className="grid sm:grid-cols-2 gap-3 bg-slate-50 border border-[#E8ECF2] rounded-lg p-3">
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">EOI Date</label>
                  <input
                    type="date"
                    required
                    value={eoiFields.eoi_date}
                    onChange={e => setEoiFields(f => ({ ...f, eoi_date: e.target.value }))}
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#54627A] mb-1">Expiration Date</label>
                  <input
                    type="date"
                    required
                    value={eoiFields.expiration_date}
                    onChange={e => setEoiFields(f => ({ ...f, expiration_date: e.target.value }))}
                    className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-[#54627A] mb-1">File</label>
              <input
                key={fileInputKey}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                onChange={e => setFile(e.target.files[0] || null)}
                className={`w-full text-sm text-[#54627A] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold ${
                  file
                    ? 'file:bg-[#E2F4EC] file:text-[#0E8E68] hover:file:bg-[#CDEBDC]'
                    : 'file:bg-[#FAEDD2] file:text-[#946410] hover:file:bg-[#F7E4B8]'
                }`}
              />
              {file && <p className="text-xs text-[#54627A] mt-1">{file.name}</p>}
            </div>
            {error && <p className="text-sm text-[#C0492F]">{error}</p>}
            {success && <p className="text-sm text-[#0E8E68]">{success}</p>}
            <button
              type="submit"
              disabled={uploading}
              className="bg-[#001842] hover:bg-[#0A2A63] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
            >
              {uploading ? 'Uploading…' : 'Upload Document'}
            </button>
          </form>
        </div>
        )}

        <div className="bg-white rounded-xl border-2 border-[#C7DBF5] shadow-sm overflow-x-auto">
          <div className="px-4 py-3 bg-[#001842]">
            <h2 className="font-semibold text-white">Documents Available to Unit-Owners</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-[#E8ECF2]">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-[#54627A]">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-[#54627A]">Address</th>
                <th className="text-left px-4 py-3 font-semibold text-[#54627A]">Building #</th>
                <th className="text-left px-4 py-3 font-semibold text-[#54627A]">Uploaded</th>
                <th className="text-left px-4 py-3 font-semibold text-[#54627A]">Document Date</th>
                <th className="text-left px-4 py-3 font-semibold text-[#54627A]">Expires</th>
                <th className="text-left px-4 py-3 font-semibold text-[#54627A]">Link</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF2]">
              {docs.map(d => {
                const exp = docExpiration(d)
                const days = daysUntil(exp)
                const rowColor = days !== null && days < 0
                  ? 'bg-[#F9E1DA] hover:bg-[#F4D0C4]'
                  : days !== null && days <= 30
                  ? 'bg-[#FAEDD2] hover:bg-[#F7E4B8]'
                  : 'hover:bg-slate-50'
                return (
                <tr key={d.id} className={rowColor}>
                  <td className="px-4 py-3 text-[#54627A]">{d.doc_type || '—'}</td>
                  <td className="px-4 py-3 text-[#54627A]">{d.metadata?.address || d.metadata?.building_address || '—'}</td>
                  <td className="px-4 py-3 text-[#54627A]">{d.metadata?.building || 'ALL'}</td>
                  <td className="px-4 py-3 text-[#54627A]">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-[#54627A]">{(() => {
                    const date = d.metadata?.inspection_date || d.metadata?.eoi_date || d.metadata?.date_signed
                    return fmtDate(date)
                  })()}</td>
                  <td className={`px-4 py-3 ${days !== null && days < 0 ? 'text-[#C0492F] font-semibold' : days !== null && days <= 30 ? 'text-[#946410] font-semibold' : 'text-[#54627A]'}`}>
                    {fmtDate(exp)}
                    {days !== null && days < 0 && <span className="ml-1.5 text-xs">(expired)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                        className="inline-block text-xs font-semibold text-[#014AC5] border border-[#C7DBF5] bg-white hover:bg-[#E7EEFA] px-3 py-1.5 rounded-lg">
                        View
                      </a>
                      <button
                        onClick={() => { setEmailDoc(d); setEmailTo(''); setEmailNote(''); setEmailErr('') }}
                        className="inline-block text-xs font-semibold text-[#014AC5] border border-[#C7DBF5] bg-white hover:bg-[#E7EEFA] px-3 py-1.5 rounded-lg">
                        Email
                      </button>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(d.id)}
                      disabled={deletingId === d.id}
                      className="text-xs font-medium text-[#C0492F] hover:text-[#a83d26] hover:underline disabled:opacity-50"
                    >
                      {deletingId === d.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              )})}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-[#8493A8] italic">
                    {hoaId === ALL_HOAS
                      ? 'Select a single association above to view or upload its documents.'
                      : 'No documents yet'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {emailSent && (
          <p className="mt-3 text-sm text-[#0E8E68]">✓ {emailSent}</p>
        )}
      </main>

      {/* Email-a-document dialog */}
      {emailDoc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => !emailSending && setEmailDoc(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold text-[#0B1B33] mb-1">Email document</h2>
            <p className="text-xs text-[#54627A] mb-4">
              Send <strong>{emailDoc.name}</strong> as a secure link (valid 7 days). Replies go to your email.
            </p>
            <form onSubmit={handleEmailDocument} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#54627A] mb-1">Recipient email</label>
                <input
                  type="email" required autoFocus
                  value={emailTo}
                  onChange={e => setEmailTo(e.target.value)}
                  placeholder="name@email.com"
                  className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#54627A] mb-1">Note <span className="font-normal text-[#8493A8]">(optional)</span></label>
                <textarea
                  value={emailNote}
                  onChange={e => setEmailNote(e.target.value)}
                  rows={3}
                  placeholder="Add a short message…"
                  className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]"
                />
              </div>
              {emailErr && <p className="text-sm text-[#C0492F]">{emailErr}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={emailSending}
                  className="flex-1 bg-[#001842] hover:bg-[#0A2A63] text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-60">
                  {emailSending ? 'Sending…' : 'Send'}
                </button>
                <button type="button" onClick={() => setEmailDoc(null)} disabled={emailSending}
                  className="flex-1 border border-[#DCE3EC] text-[#54627A] text-sm font-semibold py-2 rounded-lg hover:bg-slate-50 disabled:opacity-60">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
