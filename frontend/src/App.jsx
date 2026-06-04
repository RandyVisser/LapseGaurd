import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import AdminDashboard from './pages/AdminDashboard'
import AdminDocuments from './pages/AdminDocuments'
import TenantDashboard from './pages/TenantDashboard'

function RequireAuth({ role: requiredRole, children }) {
  const { loading, session, role } = useAuth()
  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
      Loading…
    </div>
  )
  if (!session) return <Navigate to="/login" replace />
  if (requiredRole && role !== requiredRole) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin/dashboard" element={<RequireAuth role="hoa_admin"><AdminDashboard /></RequireAuth>} />
          <Route path="/admin/documents" element={<RequireAuth role="hoa_admin"><AdminDocuments /></RequireAuth>} />
          <Route path="/tenant/dashboard" element={<RequireAuth role="tenant"><TenantDashboard /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
