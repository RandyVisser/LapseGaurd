import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import FeedbackWidget from './components/FeedbackWidget'

// Route-level code splitting — keeps the tenant bundle from carrying the
// whole admin dashboard (and vice versa)
const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const Join = lazy(() => import('./pages/Join'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const AdminDocuments = lazy(() => import('./pages/AdminDocuments'))
const AdminSettings = lazy(() => import('./pages/AdminSettings'))
const AdminTenantDetail = lazy(() => import('./pages/AdminTenantDetail'))
const TenantDashboard = lazy(() => import('./pages/TenantDashboard'))
const TenantDocuments = lazy(() => import('./pages/TenantDocuments'))
const AdminFeedback = lazy(() => import('./pages/AdminFeedback'))
const Privacy = lazy(() => import('./pages/Legal').then(m => ({ default: m.Privacy })))
const Terms = lazy(() => import('./pages/Legal').then(m => ({ default: m.Terms })))

function PageLoader() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
      Loading…
    </div>
  )
}

function RequireAuth({ role: requiredRole, children }) {
  const { loading, session, role } = useAuth()
  if (loading) return <PageLoader />
  if (!session) return <Navigate to="/login" replace />
  if (requiredRole === 'hoa_admin' && !['hoa_admin', 'super_user', 'property_manager'].includes(role)) {
    return <Navigate to="/login" replace />
  }
  if (requiredRole && requiredRole !== 'hoa_admin' && role !== requiredRole) {
    return <Navigate to="/login" replace />
  }
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/join/:token" element={<Join />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/admin/dashboard" element={<RequireAuth role="hoa_admin"><AdminDashboard /></RequireAuth>} />
            <Route path="/admin/documents" element={<RequireAuth role="hoa_admin"><AdminDocuments /></RequireAuth>} />
            <Route path="/admin/settings" element={<RequireAuth role="hoa_admin"><AdminSettings /></RequireAuth>} />
            <Route path="/admin/feedback" element={<RequireAuth role="super_user"><AdminFeedback /></RequireAuth>} />
            <Route path="/admin/tenant/:tenantId" element={<RequireAuth role="hoa_admin"><AdminTenantDetail /></RequireAuth>} />
            <Route path="/tenant/dashboard" element={<RequireAuth role="tenant"><TenantDashboard /></RequireAuth>} />
            <Route path="/tenant/documents" element={<RequireAuth role="tenant"><TenantDocuments /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <FeedbackWidget />
      </BrowserRouter>
    </AuthProvider>
  )
}
