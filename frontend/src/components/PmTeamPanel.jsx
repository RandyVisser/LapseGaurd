import { useEffect, useState } from 'react'
import { apiGet, apiPost, apiPatch, apiDelete } from '../supabase'

// Firm roster for property managers: everyone listed here sees the firm's
// whole portfolio. One invite = access to every association, current and
// future. Owner-only: invite, revoke, remove, rename.
export default function PmTeamPanel() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  async function load() {
    try { setData(await apiGet('/pm/team')) } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  async function run(fn, okMsg) {
    setBusy(true); setError(''); setMsg('')
    try {
      await fn()
      if (okMsg) setMsg(okMsg)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  function handleInvite(e) {
    e.preventDefault()
    const email = inviteEmail.trim()
    if (!email) return
    run(async () => {
      await apiPost('/pm/team/invite', { email })
      setInviteEmail('')
    }, `Invite sent to ${email}.`)
  }

  function handleRename(e) {
    e.preventDefault()
    run(async () => {
      await apiPatch('/pm/team', { name: nameDraft })
      setEditingName(false)
    })
  }

  if (!data && !error) return null

  return (
    <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6 mb-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-[#0B1B33]">Team</p>
          {!editingName ? (
            <p className="text-xs text-[#54627A] mt-1">
              {data?.firm?.name}
              {data?.is_owner && (
                <button type="button" className="ml-2 text-[#014AC5] hover:underline"
                  onClick={() => { setNameDraft(data.firm.name); setEditingName(true) }}>
                  Rename
                </button>
              )}
            </p>
          ) : (
            <form onSubmit={handleRename} className="flex gap-2 mt-1">
              <input value={nameDraft} onChange={e => setNameDraft(e.target.value)}
                placeholder="Firm name"
                className="border border-[#DCE3EC] rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
              <button type="submit" disabled={busy} className="text-xs font-semibold text-[#014AC5]">Save</button>
              <button type="button" onClick={() => setEditingName(false)} className="text-xs text-[#8493A8]">Cancel</button>
            </form>
          )}
        </div>
      </div>
      <p className="text-xs text-[#54627A] mt-2 mb-3">
        Everyone on your team can see and manage every association your firm handles —
        including ones added later.
      </p>
      {error && <p className="text-sm text-[#C0492F] mb-3">{error}</p>}
      {msg && <p className="text-sm text-[#0E8E68] mb-3">{msg}</p>}

      {data && (
        <>
          <div className="border border-[#E8ECF2] rounded-lg divide-y divide-[#E8ECF2] mb-3">
            {data.members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-[#0B1B33]">
                  {m.email || m.user_id}
                  {m.you && <span className="text-[#8493A8]"> (you)</span>}
                  {m.is_owner && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide bg-[#EEF3FB] text-[#014AC5] rounded px-1.5 py-0.5">Owner</span>
                  )}
                </span>
                {data.is_owner && !m.you && (
                  <button type="button" disabled={busy}
                    onClick={() => window.confirm(`Remove ${m.email} from your team? Their login will be deleted.`)
                      && run(() => apiDelete(`/pm/team/members/${m.user_id}`))}
                    className="text-xs text-[#C0492F] hover:underline">
                    Remove
                  </button>
                )}
              </div>
            ))}
            {data.pending.map(p => (
              <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-[#8493A8]">{p.email} — invite pending</span>
                {data.is_owner && (
                  <button type="button" disabled={busy}
                    onClick={() => run(() => apiDelete(`/pm/team/invites/${p.id}`))}
                    className="text-xs text-[#C0492F] hover:underline">
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>

          {data.is_owner && (
            <form onSubmit={handleInvite} className="flex gap-2">
              <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                placeholder="colleague@yourfirm.com"
                className="flex-1 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
              <button type="submit" disabled={busy || !inviteEmail.trim()}
                className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-50">
                {busy ? 'Sending…' : 'Invite teammate'}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  )
}
