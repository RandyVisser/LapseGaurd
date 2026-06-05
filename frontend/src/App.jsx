import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Join from './pages/Join'
import AdminDashboard from './pages/AdminDashboard'
import AdminDocuments from './pages/AdminDocuments'
import AdminTenantDetail from './pages/AdminTenantDetail'
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
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/join/:token" element={<Join />} />
          <Route path="/admin/dashboard" element={<RequireAuth role="hoa_admin"><AdminDashboard /></RequireAuth>} />
          <Route path="/admin/documents" element={<RequireAuth role="hoa_admin"><AdminDocuments /></RequireAuth>} />
          <Route path="/admin/tenant/:tenantId" element={<RequireAuth role="hoa_admin"><AdminTenantDetail /></RequireAuth>} />
          <Route path="/tenant/dashboard" element={<RequireAuth role="tenant"><TenantDashboard /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
