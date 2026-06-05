import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, apiGet } from '../supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [tenantProfile, setTenantProfile] = useState(null)

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
      apiGet('/tenant/me').then(setTenantProfile).catch(() => {})
    }
  }, [session?.user?.id, role])

  return (
    <AuthContext.Provider value={{
      loading,
      session,
      user: session?.user || null,
      role,
      hoaId: hoaId || tenantProfile?.hoa_id || null,
      unitId: tenantProfile?.unit_id || null,
      tenantProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
