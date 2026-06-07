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
        setSelectedHoaId(prev => prev || list[0]?.id || null)
      }).catch(() => {})
    }
  }, [session?.user?.id, role])

  const effectiveHoaId = (role === 'super_user' || role === 'property_manager')
    ? selectedHoaId
    : (hoaId || tenantProfile?.hoa_id || null)

  return (
    <AuthContext.Provider value={{
      loading,
      session,
      user: session?.user || null,
      role,
      hoaId: effectiveHoaId,
      availableHoas,
      selectedHoaId,
      setSelectedHoaId,
      unitId: tenantProfile?.unit_id || null,
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
