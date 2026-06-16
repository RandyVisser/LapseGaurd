import { useState } from 'react'
import { apiPost } from '../supabase'
import { useAuth } from '../context/AuthContext'

// Floating "Feedback" button → modal. Available app-wide during the pilot so
// admins and owners can send feedback / feature requests / help-needed in
// context. Each submission emails the super-users and lands in /admin/feedback.
const TYPES = [
  { key: 'feedback', label: '💬 Feedback' },
  { key: 'feature', label: '✨ Feature request' },
  { key: 'help', label: '🆘 Help needed' },
]

export default function FeedbackWidget() {
  const { session, hoaId } = useAuth()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('feedback')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  if (!session) return null // only for logged-in users

  async function submit(e) {
    e.preventDefault()
    if (!message.trim()) return
    setBusy(true); setError('')
    try {
      await apiPost('/feedback', {
        type, message: message.trim(),
        page: window.location.pathname,
        hoa_id: hoaId || null,
      })
      setSent(true)
      setMessage('')
      setTimeout(() => { setOpen(false); setSent(false); setType('feedback') }, 1800)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 left-4 z-40 flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg"
          aria-label="Send feedback"
        >
          💬 Feedback
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-start sm:pl-4 bg-black/30 sm:bg-transparent pointer-events-none">
          <div className="pointer-events-auto bg-white w-full sm:w-96 sm:mb-4 rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <p className="font-semibold text-slate-800 text-sm">Tell us what you think</p>
              <button onClick={() => { setOpen(false); setError('') }} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">✕</button>
            </div>

            {sent ? (
              <div className="px-5 py-8 text-center">
                <p className="text-3xl mb-2">🙏</p>
                <p className="text-sm font-medium text-slate-700">Thank you — we got it.</p>
                <p className="text-xs text-slate-400 mt-1">We read every note during the pilot.</p>
              </div>
            ) : (
              <form onSubmit={submit} className="px-5 py-4 space-y-3">
                <div className="flex gap-1.5">
                  {TYPES.map(t => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setType(t.key)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border ${
                        type === t.key ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder={
                    type === 'feature' ? 'What would make this more useful?'
                      : type === 'help' ? 'What are you stuck on?'
                      : 'What worked, what didn\'t, anything at all…'
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                {error && <p className="text-xs text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={busy || !message.trim()}
                  className="w-full bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50"
                >
                  {busy ? 'Sending…' : 'Send'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
