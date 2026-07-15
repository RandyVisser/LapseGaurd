import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import PmBillingPanel from '../components/PmBillingPanel'
import FirmDirectory from '../components/FirmDirectory'
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '../supabase'
import { useAuth } from '../context/AuthContext'
import usePageTitle from '../usePageTitle'

const BILLING_ENABLED = import.meta.env.VITE_BILLING_ENABLED === 'true'
const GROUP_COLORS = ['#0E8E68', '#946410', '#C0492F', '#014AC5', '#54627A', '#06245C']

// ── Firm Console (design spec 2026-07-12) ───────────────────────────────────
// The people/billing/settings side of the firm (the associations list lives on
// the Dashboard). Roles: owner (everything), manager (people ops + read-only
// billing), member (sees the roster only). Super users get the platform-wide
// firm directory instead.

const rolePill = r => r === 'owner'
  ? <span className="text-[10px] font-semibold uppercase tracking-wide bg-[#EEF3FB] text-[#014AC5] rounded px-1.5 py-0.5">Owner</span>
  : r === 'manager'
    ? <span className="text-[10px] font-semibold uppercase tracking-wide bg-[#E2F4EC] text-[#0E8E68] rounded px-1.5 py-0.5">Manager</span>
    : null

// Shown on Users/Groups while the firm is open-visibility: assignments and
// groups are being recorded but don't restrict anything yet.
function OpenVisibilityNote({ isOwner, onGoSettings }) {
  return (
    <p className="text-xs text-[#54627A] bg-[#EEF3FB] border border-[#C7DBF5] rounded-lg px-3 py-2 mb-3">
      Right now everyone on your team sees every association (open visibility).
      Assignments and groups are saved but don't limit anything until{' '}
      {isOwner
        ? <>you turn on <button type="button" onClick={onGoSettings} className="text-[#014AC5] font-medium hover:underline">"Limit members to their assigned associations" in Settings</button>.</>
        : <>the firm owner limits visibility in Settings.</>}
    </p>
  )
}

// ── People: Users + Groups ───────────────────────────────────────────────────
function PeopleTab({ view, onGoSettings }) {
  const [team, setTeam] = useState(null)
  const [groups, setGroups] = useState([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePre, setInvitePre] = useState([])
  const [editing, setEditing] = useState(null)   // member being edited (assignments)
  const [newGroup, setNewGroup] = useState('')

  function load() {
    apiGet('/pm/team').then(setTeam).catch(e => setError(e.message))
    apiGet('/pm/groups').then(setGroups).catch(() => {})
  }
  useEffect(() => { load() }, [])

  async function run(fn, ok) {
    setBusy(true); setError(''); setMsg('')
    try { await fn(); if (ok) setMsg(ok); load() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (error && !team) return <p className="text-sm text-[#C0492F]">{error}</p>
  if (!team) return <p className="text-sm text-[#8493A8]">Loading…</p>
  const canManage = team.role === 'owner' || team.role === 'manager'
  const isOwner = team.role === 'owner'
  const openVis = team.firm.open_visibility !== false
  const groupsOf = uid => groups.filter(g => g.member_ids.includes(uid))

  return (
    <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-5">
      {error && <p className="text-sm text-[#C0492F] mb-3">{error}</p>}
      {msg && <p className="text-sm text-[#0E8E68] mb-3">{msg}</p>}
      {canManage && openVis && <OpenVisibilityNote isOwner={isOwner} onGoSettings={onGoSettings} />}

      {view === 'users' && (
        <>
          <div className="border border-[#E8ECF2] rounded-lg divide-y divide-[#E8ECF2] mb-4">
            {team.members.map(m => (
              <div key={m.user_id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm text-[#0B1B33]">
                    {m.email || m.user_id}
                    {m.you && <span className="text-[#8493A8]"> (you)</span>}
                    <span className="ml-2">{rolePill(m.role)}</span>
                  </span>
                  <span className="flex items-center gap-3 flex-shrink-0">
                    {groupsOf(m.user_id).map(g => (
                      <span key={g.id} className="text-[11px] font-semibold rounded px-1.5 py-0.5"
                        style={{ background: '#EEF3FB', color: g.color || '#014AC5' }}>{g.name}</span>
                    ))}
                    <span className="text-xs text-[#8493A8]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {openVis || m.role === 'owner' || m.role === 'manager'
                        ? 'sees all'
                        : `${m.assigned_hoa_ids.length} assigned`}
                    </span>
                    {isOwner && !m.you && m.role !== 'owner' && (
                      <select value={m.role} disabled={busy}
                        onChange={e => { const role = e.target.value
                          if (role === 'manager' && !window.confirm(`Make ${m.email} a manager? Managers see the whole portfolio and can manage people.`)) return
                          run(() => apiPatch(`/pm/team/members/${m.user_id}`, { role }), `${m.email} is now a ${role}.`) }}
                        className="border border-[#DCE3EC] rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#014AC5]">
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                      </select>
                    )}
                    {canManage && !m.you && m.role === 'member' && !openVis && (
                      <button type="button" onClick={() => setEditing(editing === m.user_id ? null : m.user_id)}
                        className="text-xs text-[#014AC5] hover:underline">Assignments</button>
                    )}
                    {canManage && !m.you && m.role !== 'owner' && (isOwner || m.role === 'member') && (
                      <button type="button" disabled={busy}
                        onClick={() => window.confirm(`Remove ${m.email} from your team? Their login will be deleted.`)
                          && run(() => apiDelete(`/pm/team/members/${m.user_id}`))}
                        className="text-xs text-[#C0492F] hover:underline">Remove</button>
                    )}
                  </span>
                </div>
                {editing === m.user_id && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pl-1">
                    {team.hoas.map(h => (
                      <label key={h.id} className="flex items-center gap-1 text-xs text-[#54627A]">
                        <input type="checkbox" disabled={busy}
                          checked={m.assigned_hoa_ids.includes(h.id)}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...m.assigned_hoa_ids, h.id]
                              : m.assigned_hoa_ids.filter(id => id !== h.id)
                            run(() => apiPut(`/pm/team/members/${m.user_id}/hoas`, { hoa_ids: next }))
                          }}
                          className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]" />
                        {h.name}
                      </label>
                    ))}
                    {team.hoas.length === 0 && <span className="text-xs text-[#8493A8]">No associations in the portfolio yet.</span>}
                  </div>
                )}
              </div>
            ))}
            {team.pending.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="text-[#8493A8]">
                  {p.email} — invite pending
                  {p.sent_at && <> · sent {new Date(p.sent_at).toLocaleDateString()}</>}
                </span>
                {canManage && (
                  <span className="flex items-center gap-3 flex-shrink-0">
                    {/* Re-inviting replaces the pending link — pass its pre-assignments
                        back through or the backend would wipe them. */}
                    <button type="button" disabled={busy}
                      onClick={() => run(() => apiPost('/pm/team/invite', { email: p.email, hoa_ids: p.hoa_ids || [] }),
                        `Invite re-sent to ${p.email}.`)}
                      className="text-xs text-[#014AC5] hover:underline">Resend</button>
                    <button type="button" disabled={busy}
                      onClick={() => run(() => apiDelete(`/pm/team/invites/${p.id}`))}
                      className="text-xs text-[#C0492F] hover:underline">Revoke</button>
                  </span>
                )}
              </div>
            ))}
          </div>

          {canManage && (
            <form onSubmit={e => { e.preventDefault(); const email = inviteEmail.trim(); if (!email) return
              run(async () => { await apiPost('/pm/team/invite', { email, hoa_ids: invitePre }); setInviteEmail(''); setInvitePre([]) },
                `Invite sent to ${email}.`) }} className="space-y-2">
              <div className="flex gap-2">
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@yourfirm.com"
                  className="flex-1 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
                <button type="submit" disabled={busy || !inviteEmail.trim()}
                  className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-50">
                  {busy ? 'Sending…' : 'Invite PM'}
                </button>
              </div>
              {/* Under open visibility pre-assignment changes nothing — the new
                  PM sees everything anyway, so the block would be a no-op. */}
              {!openVis && team.hoas.length > 0 && inviteEmail.trim() && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="text-xs text-[#8493A8] w-full">Pre-assign associations (they'll see these on day one):</span>
                  {team.hoas.map(h => (
                    <label key={h.id} className="flex items-center gap-1 text-xs text-[#54627A]">
                      <input type="checkbox" checked={invitePre.includes(h.id)}
                        onChange={e => setInvitePre(p => e.target.checked ? [...p, h.id] : p.filter(x => x !== h.id))}
                        className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]" />
                      {h.name}
                    </label>
                  ))}
                </div>
              )}
            </form>
          )}
        </>
      )}

      {view === 'groups' && (
        <>
          <p className="text-xs text-[#54627A] mb-3">
            A group is a set of PMs covering a set of associations. Group members see the
            group's whole book — moving someone between teams is one change here.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            {groups.map(g => (
              <GroupCard key={g.id} group={g} team={team} busy={busy} canManage={canManage} run={run} />
            ))}
            {groups.length === 0 && (
              <p className="text-sm text-[#8493A8] col-span-2">
                No groups yet. Name one below (e.g. "Green Team"), then tick which PMs are
                on it and which associations they cover.
              </p>
            )}
          </div>
          {canManage && (
            <form onSubmit={e => { e.preventDefault(); const name = newGroup.trim(); if (!name) return
              run(async () => { await apiPost('/pm/groups', { name, color: GROUP_COLORS[groups.length % GROUP_COLORS.length] }); setNewGroup('') }) }}
              className="flex gap-2">
              <input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="e.g. Green Team"
                className="flex-1 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
              <button type="submit" disabled={busy || !newGroup.trim()}
                className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-50">
                + New group
              </button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

function GroupCard({ group, team, busy, canManage, run }) {
  const toggle = (list, id) => list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  return (
    <div className="border border-[#E8ECF2] rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded" style={{ background: group.color || '#014AC5' }} />
        <span className="font-semibold text-sm text-[#0B1B33]">{group.name}</span>
        <span className="ml-auto text-[11px] text-[#8493A8]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {group.member_ids.length} PM{group.member_ids.length !== 1 ? 's' : ''} · {group.hoa_ids.length} assoc
        </span>
        {canManage && (
          <button type="button" disabled={busy}
            onClick={() => window.confirm(`Delete ${group.name}? Members lose the group's associations (direct assignments stay).`)
              && run(() => apiDelete(`/pm/groups/${group.id}`))}
            className="text-xs text-[#C0492F] hover:underline">Delete</button>
        )}
      </div>
      <p className="text-[10.5px] uppercase text-[#8493A8] mb-1" style={{ fontFamily: 'JetBrains Mono, monospace', letterSpacing: '.08em' }}>People</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
        {team.members.filter(m => m.role !== 'owner').map(m => (
          // Managers always see the whole portfolio, so group membership is
          // inert for them — shown (rosters shouldn't hide people) but disabled.
          m.role === 'manager'
            ? <span key={m.user_id} className="flex items-center gap-1 text-xs text-[#8493A8]">
                <input type="checkbox" disabled checked={group.member_ids.includes(m.user_id)}
                  className="rounded border-[#DCE3EC]" />
                {m.email} <span className="italic">(sees all)</span>
              </span>
            : <label key={m.user_id} className="flex items-center gap-1 text-xs text-[#54627A]">
                <input type="checkbox" disabled={busy || !canManage} checked={group.member_ids.includes(m.user_id)}
                  onChange={() => run(() => apiPatch(`/pm/groups/${group.id}`, { member_ids: toggle(group.member_ids, m.user_id) }))}
                  className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]" />
                {m.email}
              </label>
        ))}
        {team.members.filter(m => m.role !== 'owner').length === 0 && (
          <span className="text-xs text-[#8493A8]">No teammates yet — invite PMs on the Users tab.</span>
        )}
      </div>
      <p className="text-[10.5px] uppercase text-[#8493A8] mb-1" style={{ fontFamily: 'JetBrains Mono, monospace', letterSpacing: '.08em' }}>Associations</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {team.hoas.map(h => (
          <label key={h.id} className="flex items-center gap-1 text-xs text-[#54627A]">
            <input type="checkbox" disabled={busy || !canManage} checked={group.hoa_ids.includes(h.id)}
              onChange={() => run(() => apiPatch(`/pm/groups/${group.id}`, { hoa_ids: toggle(group.hoa_ids, h.id) }))}
              className="rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]" />
            {h.name}
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Settings (owner only) ────────────────────────────────────────────────────
function SettingsTab() {
  const [team, setTeam] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  function load() { apiGet('/pm/team').then(t => { setTeam(t); setName(t.firm.name) }).catch(e => setError(e.message)) }
  useEffect(() => { load() }, [])
  async function save(patch) {
    setBusy(true); setError('')
    try { await apiPatch('/pm/team', patch); load() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  if (error && !team) return <p className="text-sm text-[#C0492F]">{error}</p>
  if (!team) return <p className="text-sm text-[#8493A8]">Loading…</p>
  return (
    <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-5 space-y-4 max-w-lg">
      {error && <p className="text-sm text-[#C0492F]">{error}</p>}
      <div>
        <label className="block text-sm font-medium text-[#0B1B33] mb-1">Firm name</label>
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)}
            className="flex-1 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
          <button type="button" disabled={busy || name.trim() === team.firm.name}
            onClick={() => save({ name: name.trim() })}
            className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold px-4 rounded-lg text-sm disabled:opacity-50">Save</button>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-[#0B1B33] mb-1">CAB #</label>
        <input defaultValue={team.firm.cab_number || ''} placeholder="—" disabled={busy}
          onBlur={e => { const v = e.target.value.trim(); if (v !== (team.firm.cab_number || '')) save({ cab_number: v }) }}
          className="w-40 border border-[#DCE3EC] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#014AC5]" />
        <p className="text-xs text-[#8493A8] mt-1">Your Florida community association management firm license, if you have one.</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-[#54627A]">
        <input type="checkbox" checked={team.firm.open_visibility === false} disabled={busy}
          onChange={e => save({ open_visibility: !e.target.checked })}
          className="mt-0.5 rounded border-[#DCE3EC] text-[#014AC5] focus:ring-[#014AC5]" />
        <span><span className="font-medium text-[#0B1B33]">Limit members to their assigned associations.</span>{' '}
          Owners and managers always see the whole portfolio; members see their direct
          assignments plus their groups' books. After turning this on, set each member's
          assignments on the Users tab (or put them in groups on the Groups tab) — an
          unassigned member sees nothing.</span>
      </label>
    </div>
  )
}

// ── Page shell ───────────────────────────────────────────────────────────────
export default function AdminFirm() {
  usePageTitle('Firm')
  const { role, availableHoas, setSelectedHoaId } = useAuth()
  const navigate = useNavigate()
  const [firms, setFirms] = useState([])
  const [tab, setTab] = useState('users')
  const [myRole, setMyRole] = useState(null)
  const [firmName, setFirmName] = useState('')

  useEffect(() => {
    if (role === 'super_user') apiGet('/firms').then(setFirms).catch(() => {})
    if (role === 'property_manager') {
      apiGet('/pm/team')
        .then(t => { setMyRole(t.role); setFirmName(t.firm?.name || '') })
        .catch(() => setMyRole('member'))
    }
  }, [role])

  if (role && role !== 'property_manager' && role !== 'super_user') {
    return <Navigate to="/admin/dashboard" replace />
  }

  function openHoa(id, page = '/admin/dashboard') {
    setSelectedHoaId(id)
    navigate(page)
  }

  // The associations list lives on the Dashboard page; the Firm page is the
  // people/billing/settings side of the house.
  const tabs = [
    { id: 'users', label: 'Users' },
    ...(myRole === 'owner' || myRole === 'manager' ? [{ id: 'groups', label: 'Groups' }] : []),
    ...(BILLING_ENABLED && (myRole === 'owner' || myRole === 'manager') ? [{ id: 'billing', label: 'Billing' }] : []),
    ...(myRole === 'owner' ? [{ id: 'settings', label: 'Settings' }] : []),
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav role="hoa_admin" />
      <main className="max-w-[60rem] mx-auto px-4 py-8">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-[#0B1B33]">
            {role === 'super_user' ? 'PM Firms' : (firmName || 'Your Firm')}
          </h1>
          <p className="text-sm text-[#54627A] mt-1">
            {role === 'super_user'
              ? 'Every property-management firm on the platform, and who they manage.'
              : myRole === 'member'
                ? 'Your firm’s team. Your associations are on the Dashboard.'
                : 'Your team, who sees what, and how the portfolio gets billed. Your associations are on the Dashboard.'}
          </p>
        </div>

        {role === 'property_manager' && (
          <>
            {/* A plain member only has the roster — skip the tab chrome. */}
            {tabs.length > 1 && (
              <div className="flex gap-1 border-b border-[#E8ECF2] mb-5 overflow-x-auto">
                {tabs.map(t => (
                  <button key={t.id} type="button" onClick={() => setTab(t.id)}
                    className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px ${
                      tab === t.id ? 'text-[#014AC5] border-[#014AC5]' : 'text-[#54627A] border-transparent hover:text-[#0B1B33]'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            {tab === 'users' && <PeopleTab view="users" onGoSettings={() => setTab('settings')} />}
            {tab === 'groups' && <PeopleTab view="groups" onGoSettings={() => setTab('settings')} />}
            {tab === 'billing' && <PmBillingPanel />}
            {tab === 'settings' && <SettingsTab />}
          </>
        )}

        {role === 'super_user' && (
          <FirmDirectory firms={firms} availableHoas={availableHoas}
            onOpenHoa={id => openHoa(id, '/admin/settings')} />
        )}
      </main>
    </div>
  )
}
