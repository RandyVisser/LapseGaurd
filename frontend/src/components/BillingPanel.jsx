import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../supabase'

// Subscription panel. Rendered only when VITE_BILLING_ENABLED === 'true', so it
// stays hidden until billing is switched on. Uses hosted Stripe Checkout /
// Customer Portal — we redirect out, no card data touches the app.
const STATUS_LABEL = {
  none: 'No subscription yet', active: 'Active', trialing: 'Trial',
  past_due: 'Payment past due', canceled: 'Canceled', incomplete: 'Incomplete',
}
const dollars = c => `$${(c / 100).toFixed(2)}`

function Stat({ label, value }) {
  return (
    <div className="border border-[#E8ECF2] rounded-lg px-3 py-2">
      <p className="text-xs text-[#8493A8]">{label}</p>
      <p className="font-semibold text-[#0B1B33]">{value}</p>
    </div>
  )
}

export default function BillingPanel({ hoaId }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!hoaId || hoaId === '__all__') return
    apiGet(`/hoa/${hoaId}/billing`).then(setData).catch(e => setError(e.message))
  }, [hoaId])

  if (!hoaId || hoaId === '__all__') return null

  async function go(path) {
    setBusy(true); setError('')
    try {
      const { url } = await apiPost(`/hoa/${hoaId}/billing/${path}`, {})
      if (url) window.location.href = url
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6 mt-6">
      <p className="font-semibold text-[#0B1B33]">Billing</p>
      <p className="text-xs text-[#54627A] mt-1 mb-3">Your condo.insure subscription — billed per unit, monthly.</p>
      {error && <p className="text-sm text-[#C0492F] mb-3">{error}</p>}
      {!data ? (
        <p className="text-sm text-[#8493A8]">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat label="Units" value={data.units} />
            <Stat label="Rate" value={`${dollars(data.unit_rate_cents)}/unit`} />
            <Stat label="Monthly" value={dollars(data.monthly_cents)} />
          </div>
          <p className="text-sm text-[#54627A] mb-4">
            Status: <span className="font-medium text-[#0B1B33]">{STATUS_LABEL[data.status] || data.status}</span>
          </p>
          <div className="flex gap-2">
            {data.has_subscription ? (
              <button type="button" onClick={() => go('portal')} disabled={busy}
                className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-50">
                {busy ? 'Opening…' : 'Manage billing'}
              </button>
            ) : (
              <button type="button" onClick={() => go('checkout')} disabled={busy}
                className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-50">
                {busy ? 'Loading…' : 'Subscribe'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
