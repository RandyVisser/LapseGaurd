import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../supabase'

// Portfolio subscription panel for property managers: one subscription that
// covers every association they manage, priced on the combined unit count so
// the graduated volume tiers kick in. Rendered on the all-associations view of
// Settings, only when VITE_BILLING_ENABLED === 'true'.
const STATUS_LABEL = {
  none: 'No subscription yet', active: 'Active', trialing: 'Trial',
  past_due: 'Payment past due', canceled: 'Canceled', incomplete: 'Incomplete',
}
const dollars = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

function Stat({ label, value }) {
  return (
    <div className="border border-[#E8ECF2] rounded-lg px-3 py-2">
      <p className="text-xs text-[#8493A8]">{label}</p>
      <p className="font-semibold text-[#0B1B33]">{value}</p>
    </div>
  )
}

export default function PmBillingPanel() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiGet('/pm/billing').then(setData).catch(e => setError(e.message))
  }, [])

  async function go(path) {
    setBusy(true); setError('')
    try {
      const { url } = await apiPost(`/pm/billing/${path}`, {})
      if (url) window.location.href = url
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const included = data?.hoas?.filter(h => h.included) || []
  const excluded = data?.hoas?.filter(h => !h.included) || []

  return (
    <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6 mb-6">
      <p className="font-semibold text-[#0B1B33]">Billing — all associations</p>
      <p className="text-xs text-[#54627A] mt-1 mb-3">
        One subscription covering your whole portfolio, billed on the combined unit count.
      </p>
      {error && <p className="text-sm text-[#C0492F] mb-3">{error}</p>}
      {!data ? (
        !error && <p className="text-sm text-[#8493A8]">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
            <Stat label="Associations" value={included.length} />
            <Stat label="Units" value={data.units} />
            <Stat label="Effective Rate" value={data.units > 0 ? `${dollars(data.monthly_cents / data.units)}/unit` : '—'} />
            <Stat label="Monthly" value={dollars(data.monthly_cents)} />
            <Stat label="Portfolio Savings" value={`${dollars(data.savings_cents || 0)}/mo`} />
          </div>
          {data.savings_cents > 0 && (
            <p className="text-sm text-[#0E8E68] font-medium mb-3">
              Portfolio pricing saves you {dollars(data.savings_cents)}/mo vs subscribing each
              association separately ({dollars(data.separate_monthly_cents)}).
            </p>
          )}
          <p className="text-sm text-[#54627A] mb-1">
            Status: <span className="font-medium text-[#0B1B33]">
              {data.cancel_at && data.status !== 'canceled' ? 'Canceled' : (STATUS_LABEL[data.status] || data.status)}
            </span>
          </p>
          {data.cancel_at && data.status !== 'canceled' && (
            <p className="text-sm text-[#C0492F] font-medium mb-3">
              Subscription canceled — access ends {new Date(data.cancel_at).toLocaleDateString()}.
              Use “Manage billing” to resume it.
            </p>
          )}
          {!data.has_subscription && data.trial_ends_at && (
            <p className={`text-sm mb-3 ${data.trial_active ? 'text-[#54627A]' : 'text-[#C0492F] font-medium'}`}>
              {data.trial_active
                ? <>Free trial — {data.trial_days_left} day{data.trial_days_left !== 1 ? 's' : ''} left
                    (ends {new Date(data.trial_ends_at).toLocaleDateString()}). Subscribe now and billing
                    starts when the trial ends.</>
                : 'Your free trial has ended — subscribe to keep compliance tracking running.'}
            </p>
          )}
          {included.length > 0 && (
            <div className="border border-[#E8ECF2] rounded-lg divide-y divide-[#E8ECF2] mb-4 mt-2">
              {included.map(h => (
                <div key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-[#0B1B33]">{h.name}</span>
                  <span className="text-[#8493A8]">{h.units} unit{h.units !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          )}
          {excluded.length > 0 && (
            <p className="text-xs text-[#8493A8] mb-4">
              {excluded.map(h => h.name).join(', ')} {excluded.length === 1 ? 'has' : 'have'} their
              own subscription and {excluded.length === 1 ? 'is' : 'are'} not included here.
            </p>
          )}
          <div className="flex gap-2">
            {data.has_subscription ? (
              <button type="button" onClick={() => go('portal')} disabled={busy}
                className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-50">
                {busy ? 'Opening…' : 'Manage billing'}
              </button>
            ) : (
              <button type="button" onClick={() => go('checkout')} disabled={busy}
                className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-50">
                {busy ? 'Loading…' : 'Subscribe for all associations'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
