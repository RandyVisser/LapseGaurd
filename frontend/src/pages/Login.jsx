import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const welcome = params.get('welcome')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) { setError(err.message); return }

    const role = data.user?.user_metadata?.role || data.user?.app_metadata?.role || 'tenant'
    const isAdmin = ['hoa_admin', 'super_user', 'property_manager'].includes(role)
    navigate(isAdmin ? '/admin/dashboard' : '/tenant/dashboard')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-sm">
        <img src="/logo.svg" alt="condo.insure" className="h-72 w-72 max-w-full mx-auto mb-2" />
        <p className="text-sm text-slate-500 mb-4 text-center">Condo Association Insurance Compliance</p>
        {welcome === '1' && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-sm text-green-700">
            Account created! Sign in to access your dashboard.
          </div>
        )}
        {welcome === 'tenant' && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-sm text-green-700">
            Account created! Sign in to upload your policy.
          </div>
        )}
        {welcome === 'reset' && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-sm text-green-700">
            Password updated! Sign in with your new password.
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="text-center">
            <a href="/forgot-password" className="text-sm text-slate-500 hover:text-slate-700">
              Forgot password?
            </a>
          </div>
        </form>
        <p className="text-center text-sm text-slate-500 mt-4">
          New association?{' '}
          <a href="/signup" className="text-blue-600 hover:underline">Get started free</a>
        </p>
      </div>
    </div>
  )
}
