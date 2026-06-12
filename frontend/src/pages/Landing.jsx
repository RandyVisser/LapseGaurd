import { useNavigate } from 'react-router-dom'

function NavBar() {
  const navigate = useNavigate()
  return (
    <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
      <span className="text-xl font-bold text-blue-800">LapseGuard</span>
      <div className="flex items-center gap-4">
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

function Step({ number, title, desc }) {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 rounded-full bg-blue-700 text-white flex items-center justify-center text-sm font-bold shrink-0">
        {number}
      </div>
      <div>
        <p className="font-semibold text-slate-800">{title}</p>
        <p className="text-sm text-slate-500 mt-1">{desc}</p>
      </div>
    </div>
  )
}

function Feature({ title, desc }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <p className="font-semibold text-slate-800 mb-2">{title}</p>
      <p className="text-sm text-slate-500">{desc}</p>
    </div>
  )
}

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">
          Insurance compliance,<br />
          <span className="text-blue-700">handled for your association.</span>
        </h1>
        <p className="mt-6 text-lg text-slate-500 max-w-2xl mx-auto">
          LapseGuard helps condo associations track unit owner insurance policies,
          send automated renewal reminders, and verify dec pages — all in one place.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={() => navigate('/signup')}
            className="bg-blue-700 hover:bg-blue-800 text-white font-semibold px-8 py-3 rounded-lg text-base">
            Get Started Free
          </button>
          <button onClick={() => navigate('/login')}
            className="bg-white border border-slate-300 hover:border-slate-400 text-slate-700 font-semibold px-8 py-3 rounded-lg text-base">
            Sign In
          </button>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-2xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-slate-800 text-center mb-10">How it works</h2>
        <div className="space-y-8">
          <Step number="1" title="Sign up your association"
            desc="Create your account, add your association name and address. Takes 60 seconds." />
          <Step number="2" title="Add your units and invite owners"
            desc="Add each unit number and send owners a personalized invite link by email." />
          <Step number="3" title="Owners upload their dec pages"
            desc="Each owner creates an account, uploads their insurance declaration page, and stays compliant." />
          <Step number="4" title="You get a real-time compliance dashboard"
            desc="See who's active, expiring, or lapsed at a glance. Send reminders in one click." />
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-slate-800 text-center mb-10">Everything you need</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Feature title="Real-time compliance dashboard"
            desc="See every unit's insurance status at a glance — active, expiring, lapsed, or missing." />
          <Feature title="Automated renewal alerts"
            desc="Owners get email reminders before their policy lapses. No more manual follow-ups." />
          <Feature title="AI dec page verification"
            desc="Uploaded policies are automatically parsed and verified against submitted details." />
          <Feature title="Document center"
            desc="Store and share association documents — wind mitigation reports, bylaws, and more." />
          <Feature title="One-click owner invites"
            desc="Send personalized signup links to each unit owner. They're linked to their unit automatically." />
          <Feature title="Multi-association ready"
            desc="Manage multiple properties from separate accounts. Each association is fully isolated." />
        </div>
      </section>

      {/* CTA */}
      <section className="bg-blue-800 py-16 mt-8">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">
            Ready to get your association compliant?
          </h2>
          <p className="text-blue-200 mb-8">
            Set up your association in minutes. No credit card required.
          </p>
          <button onClick={() => navigate('/signup')}
            className="bg-white text-blue-800 font-bold px-8 py-3 rounded-lg text-base hover:bg-blue-50">
            Get Started Free
          </button>
        </div>
      </section>

      <footer className="text-center py-8 text-sm text-slate-400">
        <p>© {new Date().getFullYear()} LapseGuard. All rights reserved.</p>
        <p className="mt-2 space-x-4">
          <a href="/privacy" className="hover:text-slate-600 underline underline-offset-2">Privacy</a>
          <a href="/terms" className="hover:text-slate-600 underline underline-offset-2">Terms</a>
        </p>
      </footer>
    </div>
  )
}
