import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

export default function Nav({ role }) {
  const navigate = useNavigate()

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <nav className="bg-blue-800 text-white px-6 py-3 flex items-center justify-between">
      <span className="font-bold text-lg tracking-tight">LapseGuard</span>
      <div className="flex items-center gap-4 text-sm">
        {role === 'hoa_admin' && (
          <>
            <a href="/admin/dashboard" className="hover:underline">Dashboard</a>
            <a href="/admin/documents" className="hover:underline">Documents</a>
          </>
        )}
        {role === 'tenant' && (
          <>
            <a href="/tenant/dashboard" className="hover:underline">My Policy</a>
          </>
        )}
        <button
          onClick={handleLogout}
          className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded"
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
