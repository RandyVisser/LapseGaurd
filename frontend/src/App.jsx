import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import FeedbackWidget from './components/FeedbackWidget'
// Landing is eager: "/" is the most common entry point and the chunk is tiny,
// so skipping the lazy round trip paints the marketing page a hop sooner
import Landing from './pages/Landing'

// Route-level code splitting — keeps the tenant bundle from carrying the
// whole admin dashboard (and vice versa)
const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const VistaRoyale = lazy(() => import('./pages/VistaRoyale'))
const Join = lazy(() => import('./pages/Join'))
const AdminSetup = lazy(() => import('./pages/AdminSetup'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const AdminDocuments = lazy(() => import('./pages/AdminDocuments'))
const AdminSettings = lazy(() => import('./pages/AdminSettings'))
const AdminFirm = lazy(() => import('./pages/AdminFirm'))
const AdminTenantDetail = lazy(() => import('./pages/AdminTenantDetail'))
const TenantDashboard = lazy(() => import('./pages/TenantDashboard'))
const TenantDocuments = lazy(() => import('./pages/TenantDocuments'))
const AdminFeedback = lazy(() => import('./pages/AdminFeedback'))
const AdminHo6Summary = lazy(() => import('./pages/AdminHo6Summary'))
const Privacy = lazy(() => import('./pages/Legal').then(m => ({ default: m.Privacy })))
const Terms = lazy(() => import('./pages/Legal').then(m => ({ default: m.Terms })))

function PageLoader() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
      Loading…
    </div>
  )
}

// Unrecognized roles fall back to the public landing page — sending them to a
// guarded dashboard would redirect-loop (both dashboards reject unknown roles).
const ADMIN_ROLES = ['hoa_admin', 'super_user', 'property_manager']
function homeFor(role) {
  if (role === 'tenant') return '/tenant/dashboard'
  return ADMIN_ROLES.includes(role) ? '/admin/dashboard' : '/'
}

function RequireAuth({ role: requiredRole, children }) {
  const { loading, session, role } = useAuth()
  if (loading) return <PageLoader />
  if (!session) return <Navigate to="/login" replace />
  // Wrong role → their own home, never the login page (they're already logged in)
  const home = homeFor(role)
  if (requiredRole === 'hoa_admin' && !ADMIN_ROLES.includes(role)) {
    return <Navigate to={home} replace />
  }
  if (requiredRole && requiredRole !== 'hoa_admin' && role !== requiredRole) {
    return <Navigate to={home} replace />
  }
  return children
}

// Unknown URL: logged-in users go to their dashboard, visitors to the landing page
function CatchAll() {
  const { loading, session, role } = useAuth()
  if (loading) return <PageLoader />
  if (!session) return <Navigate to="/" replace />
  return <Navigate to={homeFor(role)} replace />
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
            {/* /pricing was retired in favor of the landing pricing section */}
            <Route path="/pricing" element={<Navigate to="/#pricing" replace />} />
            {/* Postcard campaign landing page for the Vista Royale board.
                Accept both underscore and hyphen spellings of the URL. */}
            <Route path="/vista_royale" element={<VistaRoyale />} />
            <Route path="/vista-royale" element={<VistaRoyale />} />
            <Route path="/join/:token" element={<Join />} />
            <Route path="/admin-setup/:token" element={<AdminSetup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/admin/dashboard" element={<RequireAuth role="hoa_admin"><AdminDashboard /></RequireAuth>} />
            <Route path="/admin/documents" element={<RequireAuth role="hoa_admin"><AdminDocuments /></RequireAuth>} />
            <Route path="/admin/settings" element={<RequireAuth role="hoa_admin"><AdminSettings /></RequireAuth>} />
            <Route path="/admin/firm" element={<RequireAuth role="hoa_admin"><AdminFirm /></RequireAuth>} />
            <Route path="/admin/feedback" element={<RequireAuth role="super_user"><AdminFeedback /></RequireAuth>} />
            <Route path="/admin/ho6-summary" element={<RequireAuth role="super_user"><AdminHo6Summary /></RequireAuth>} />
            <Route path="/admin/tenant/:tenantId" element={<RequireAuth role="hoa_admin"><AdminTenantDetail /></RequireAuth>} />
            <Route path="/tenant/dashboard" element={<RequireAuth role="tenant"><TenantDashboard /></RequireAuth>} />
            <Route path="/tenant/documents" element={<RequireAuth role="tenant"><TenantDocuments /></RequireAuth>} />
            <Route path="*" element={<CatchAll />} />
          </Routes>
        </Suspense>
        <FeedbackWidget />
      </BrowserRouter>
    </AuthProvider>
  )
}
