import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, apiGet } from '../supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [tenantProfile, setTenantProfile] = useState(null)
  const [profileError, setProfileError] = useState(null)
  const [availableHoas, setAvailableHoas] = useState([])
  const [selectedHoaId, setSelectedHoaId] = useState(null)
  // Multi-unit owners: which of their units is active in the tenant portal
  const [selectedUnitId, setSelectedUnitId] = useState(() => {
    try { return localStorage.getItem('lapseguard.tenant.selectedUnit') } catch { return null }
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) setTenantProfile(null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const appMeta = session?.user?.app_metadata || {}
  const userMeta = session?.user?.user_metadata || {}
  const role = appMeta.role || userMeta.role || 'tenant'
  const hoaId = appMeta.hoa_id || null

  useEffect(() => {
    if (session && role === 'tenant' && !tenantProfile) {
      setProfileError(null)
      apiGet('/tenant/me').then(setTenantProfile).catch(e => setProfileError(e.message))
    }
  }, [session?.user?.id, role])

  useEffect(() => {
    if (session && (role === 'super_user' || role === 'property_manager' || role === 'hoa_admin')) {
      apiGet('/hoas').then(list => {
        setAvailableHoas(list)
        // Defaults: super_users land on Sandbox (or the first association) —
        // the all-associations aggregate fans out across every HOA and won't
        // scale as customers grow, so it's opt-in via the switcher. PMs keep
        // the portfolio overview; a plain hoa_admin gets their one association.
        const SANDBOX_HOA = '00000000-0000-0000-0000-000000000001'
        const superDefault = (list.find(h => h.id === SANDBOX_HOA) || list[0])?.id
        setSelectedHoaId(prev => prev
          || (role === 'super_user' ? superDefault : role === 'property_manager' ? '__all__' : list[0]?.id)
          || null)
      }).catch(() => {})
    }
  }, [session?.user?.id, role])

  // Re-fetch the HOA switcher list (e.g. after a super user adds a new one).
  async function refreshHoas() {
    const list = await apiGet('/hoas')
    setAvailableHoas(list)
    return list
  }

  // All units this owner holds (multi-unit / multi-association); falls back
  // to the legacy single unit for older backend responses
  const tenantUnits = tenantProfile?.units
    || (tenantProfile ? [{ unit_id: tenantProfile.unit_id, hoa_id: tenantProfile.hoa_id }] : [])
  const activeUnit = tenantUnits.find(u => u.unit_id === selectedUnitId) || tenantUnits[0] || null

  function selectUnit(unitId) {
    setSelectedUnitId(unitId)
    try { localStorage.setItem('lapseguard.tenant.selectedUnit', unitId) } catch { /* ignore */ }
  }

  const effectiveHoaId = (role === 'super_user' || role === 'property_manager')
    ? selectedHoaId
    : (hoaId || activeUnit?.hoa_id || tenantProfile?.hoa_id || null)

  return (
    <AuthContext.Provider value={{
      loading,
      session,
      user: session?.user || null,
      role,
      hoaId: effectiveHoaId,
      availableHoas,
      refreshHoas,
      selectedHoaId,
      setSelectedHoaId,
      unitId: activeUnit?.unit_id || null,
      tenantUnits,
      selectUnit,
      tenantProfile,
      profileError,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
