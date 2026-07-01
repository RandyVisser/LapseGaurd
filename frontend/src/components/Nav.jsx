import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../supabase'
import { useAuth } from '../context/AuthContext'

export default function Nav({ role, title }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { role: actualRole } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const links = role === 'hoa_admin'
    ? [
        { to: '/admin/dashboard', label: 'Dashboard' },
        { to: '/admin/documents', label: 'Documents' },
        { to: '/admin/settings', label: 'Settings' },
        // Feedback inbox — super-users only (Randy + dad)
        ...(actualRole === 'super_user' ? [{ to: '/admin/feedback', label: 'Feedback' }] : []),
      ]
    : role === 'tenant'
      ? [
          { to: '/tenant/dashboard', label: 'My Policy' },
          { to: '/tenant/documents', label: 'Building Documents' },
        ]
      : []

  return (
    <nav className="bg-[#001842] text-white px-4 sm:px-6 py-3 relative">
      <div className="flex items-center justify-between">
        <span className="font-bold text-lg tracking-tight" style={{ fontFamily: '"Bricolage Grotesque", sans-serif' }}>
          condo.insure
        </span>
        {title && <span className="hidden md:block font-bold text-xl text-white absolute left-1/2 -translate-x-1/2" style={{ fontFamily: '"Bricolage Grotesque", sans-serif' }}>{title}</span>}

        {/* Desktop links */}
        <div className="hidden sm:flex items-center gap-4 text-sm">
          {links.map(l => (
            <Link key={l.to} to={l.to}
              className={location.pathname === l.to
                ? 'bg-white text-[#001842] font-semibold px-3 py-1 rounded'
                : 'hover:underline'}>
              {l.label}
            </Link>
          ))}
          <button onClick={handleLogout} className="bg-[#014AC5] hover:bg-[#0139a3] px-3 py-1 rounded">
            Sign out
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden p-1 -mr-1"
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {menuOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="sm:hidden mt-3 pb-1 flex flex-col gap-1 text-sm border-t border-[#06245C] pt-3">
          {links.map(l => (
            <Link key={l.to} to={l.to} onClick={() => setMenuOpen(false)}
              className={`px-2 py-2 rounded ${location.pathname === l.to ? 'bg-white text-[#001842] font-semibold' : 'hover:bg-[#06245C]'}`}>
              {l.label}
            </Link>
          ))}
          <button onClick={handleLogout}
            className="text-left px-2 py-2 rounded hover:bg-[#06245C]">
            Sign out
          </button>
        </div>
      )}
    </nav>
  )
}
