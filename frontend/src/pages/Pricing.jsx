import { useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { track } from '../analytics'

function NavBar() {
  const navigate = useNavigate()
  return (
    <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
      <Link to="/" className="text-xl font-bold text-blue-800">condo.insure</Link>
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/')} className="text-sm text-slate-600 hover:text-slate-900">
          Home
        </button>
        <button onClick={() => navigate('/login')} className="text-sm text-slate-600 hover:text-slate-900">
          Sign in
        </button>
        <button onClick={() => navigate('/signup')}
          className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-lg">
          Get Started Free
        </button>
      </div>
    </nav>
  )
}

function Check({ children }) {
  return (
    <li className="flex items-start gap-3 text-slate-700">
      <span className="mt-0.5 w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold flex-shrink-0">✓</span>
      <span>{children}</span>
    </li>
  )
}

export default function Pricing() {
  const navigate = useNavigate()
  useEffect(() => track('pricing_view'), [])

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-16 pb-8 text-center">
        <span className="inline-block bg-green-100 text-green-800 text-sm font-semibold px-3 py-1 rounded-full mb-4">
          90 days free — no credit card required
        </span>
        <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">
          Simple, transparent pricing
        </h1>
        <p className="mt-4 text-lg text-slate-500">
          One plan with everything included — no setup fees and no surprises.
        </p>
      </section>

      {/* Plans */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-2 gap-6 items-start">

          {/* Association */}
          <div className="bg-white rounded-2xl border-2 border-blue-200 shadow-sm overflow-hidden">
            <div className="bg-blue-700 px-8 py-6 text-center">
              <p className="text-blue-100 text-sm font-semibold uppercase tracking-wide">Association</p>
              <div className="mt-3 flex items-end justify-center gap-1 text-white">
                <span className="text-5xl font-bold">$1.00</span>
                <span className="text-blue-200 text-lg mb-1">/ unit / mo</span>
              </div>
              <p className="text-blue-200 text-sm mt-2">$50/mo minimum · capped at $750/mo</p>
            </div>
            <div className="px-8 py-7">
              <p className="text-sm text-slate-500 mb-4">For a single condo association.</p>
              <ul className="space-y-3 text-sm">
                <Check><strong>90-day free trial</strong> — no credit card to start</Check>
                <Check><strong>No setup fees</strong></Check>
                <Check>Unlimited user invites</Check>
                <Check>Unlimited document storage</Check>
                <Check>AI declaration-page review included</Check>
                <Check>Automated renewal &amp; lapse reminders</Check>
                <Check>Real-time compliance dashboard</Check>
              </ul>
              <button onClick={() => navigate('/signup')}
                className="mt-7 w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 rounded-lg text-base">
                Start your 90-day free trial
              </button>
            </div>
          </div>

          {/* Property Management */}
          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-800 px-8 py-6 text-center">
              <p className="text-slate-300 text-sm font-semibold uppercase tracking-wide">Property Management</p>
              <div className="mt-3 flex items-end justify-center gap-1 text-white">
                <span className="text-5xl font-bold">$0.50</span>
                <span className="text-slate-300 text-lg mb-1">/ unit / mo</span>
              </div>
              <p className="text-slate-300 text-sm mt-2">first 10,000 units, then $0.25/unit · $500/mo minimum</p>
            </div>
            <div className="px-8 py-7">
              <p className="text-sm text-slate-500 mb-4">For managers running multiple associations.</p>
              <ul className="space-y-3 text-sm">
                <Check><strong>Everything in Association</strong></Check>
                <Check>All your associations in <strong>one dashboard</strong></Check>
                <Check><strong>Volume pricing</strong> — $0.50/unit up to 10,000, $0.25/unit beyond</Check>
                <Check>Unlimited user invites &amp; document storage</Check>
                <Check>AI declaration-page review included</Check>
              </ul>
              <button onClick={() => navigate('/signup')}
                className="mt-7 w-full bg-slate-800 hover:bg-slate-900 text-white font-semibold py-3 rounded-lg text-base">
                Start your 90-day free trial
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">Billed monthly. Cancel anytime. No long-term contract.</p>
      </section>

      <footer className="text-center py-8 text-sm text-slate-400">
        <p>© {new Date().getFullYear()} condo.insure. All rights reserved.</p>
        <p className="mt-2 space-x-4">
          <a href="/privacy" className="hover:text-slate-600 underline underline-offset-2">Privacy</a>
          <a href="/terms" className="hover:text-slate-600 underline underline-offset-2">Terms</a>
        </p>
      </footer>
    </div>
  )
}
