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
          // Bottom-LEFT on purpose: the Next Steps helper owns the bottom-right
          // corner on TenantDashboard + AdminTenantDetail (mobile pill AND the
          // persistent w-80 desktop panel) — moving right would bury this button.
          className="fixed bottom-4 left-4 z-40 flex items-center gap-2 bg-[#001842] hover:bg-[#0A2A63] text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg"
          aria-label="Send feedback"
        >
          💬 Feedback
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-start sm:pl-4 bg-black/30 sm:bg-transparent pointer-events-none">
          <div className="pointer-events-auto bg-white w-full sm:w-96 sm:mb-4 rounded-t-2xl sm:rounded-2xl shadow-xl border border-[#E8ECF2] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#E8ECF2]">
              <p className="font-semibold text-[#0B1B33] text-sm">Tell us what you think</p>
              <button onClick={() => { setOpen(false); setError('') }} className="text-[#8493A8] hover:text-[#54627A] text-xl leading-none" aria-label="Close">✕</button>
            </div>

            {sent ? (
              <div className="px-5 py-8 text-center">
                <p className="text-3xl mb-2">🙏</p>
                <p className="text-sm font-medium text-[#0B1B33]">Thank you — we got it.</p>
                <p className="text-xs text-[#8493A8] mt-1">We read every note during the pilot.</p>
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
                        type === t.key ? 'bg-[#E7EEFA] border-[#7CA9E8] text-[#014AC5]' : 'bg-white border-[#E8ECF2] text-[#54627A]'
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
                  className="w-full border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5] resize-none"
                />
                {error && <p className="text-xs text-[#C0492F]">{error}</p>}
                <button
                  type="submit"
                  disabled={busy || !message.trim()}
                  className="w-full bg-[#001842] hover:bg-[#0A2A63] text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50"
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
