import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { track } from '../analytics'

const TOUR_EMBED_URL = 'https://share.descript.com/embed/yR7DW1QXNOZ'

function NavBar() {
  const navigate = useNavigate()
  return (
    <nav className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 max-w-6xl mx-auto">
      <img src="/logo.svg" alt="condo.insure" className="h-56 w-56 max-w-full shrink-0" />
      <span className="sr-only">condo.insure</span>
      <div className="flex items-center gap-2 sm:gap-4">
        <button onClick={() => navigate('/pricing')} className="text-sm text-slate-600 hover:text-slate-900">
          Pricing
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
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => track('landing_view'), [])

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">
          Unit-owner insurance compliance,<br />
          <span className="text-blue-700">handled for your association.</span>
        </h1>
        <p className="mt-6 text-lg text-slate-500 max-w-2xl mx-auto">
          condo.insure helps condo associations track unit-owner insurance policies,
          send automated renewal reminders, and verify declaration pages — all in one simple dashboard.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={() => navigate('/signup')}
            className="bg-blue-700 hover:bg-blue-800 text-white font-semibold px-8 py-3 rounded-lg text-base">
            Get Started Free
          </button>
          <button onClick={() => setTourOpen(true)}
            className="bg-white border border-slate-300 hover:border-slate-400 text-slate-700 font-semibold px-8 py-3 rounded-lg text-base flex items-center justify-center gap-2">
            <span className="text-blue-700">▶</span> Watch 2-min tour
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
          <Step number="2" title="We build out your association"
            desc="We use property-assessor records to build out your association automatically. Once it's ready, you'll get an invite to view your dashboard." />
          <Step number="3" title="Review owner list, add emails, invite unit-owners"
            desc="Review the owner list we built, fill in any missing email addresses, and send each unit-owner a personalized invite link." />
          <Step number="4" title="Owners upload their declaration pages"
            desc="Each owner creates an account, uploads their insurance declaration page, and receives reminders to stay compliant." />
          <Step number="5" title="You get a real-time compliance dashboard"
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
          <Feature title="AI-assisted declaration page review"
            desc="Uploaded declaration pages are parsed and checked against the association's insurance requirements." />
          <Feature title="Document center"
            desc="Store shared association insurance documents — wind mitigation reports, master policy evidence, flood declaration pages, elevation certificates, bylaws, and more." />
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
            Ready to simplify unit-owner insurance compliance?
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
        <p>© {new Date().getFullYear()} condo.insure. All rights reserved.</p>
        <p className="mt-2 space-x-4">
          <a href="/privacy" className="hover:text-slate-600 underline underline-offset-2">Privacy</a>
          <a href="/terms" className="hover:text-slate-600 underline underline-offset-2">Terms</a>
        </p>
      </footer>

      {/* 2-minute tour modal */}
      {tourOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setTourOpen(false)}>
          <div className="relative w-full max-w-4xl" onClick={e => e.stopPropagation()}>
            <button onClick={() => setTourOpen(false)}
              className="absolute -top-9 right-0 text-white/80 hover:text-white text-2xl leading-none" aria-label="Close">✕</button>
            <div className="relative w-full rounded-xl overflow-hidden bg-black shadow-2xl" style={{ paddingBottom: '56.25%' }}>
              <iframe
                src={TOUR_EMBED_URL}
                title="condo.insure — 2-minute tour"
                className="absolute inset-0 w-full h-full"
                allow="autoplay; fullscreen"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
