import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../supabase'

// Trial countdown / expiry prompt shown at the top of the admin dashboard.
// Escalates as the trial runs down: quiet note at 30 days, amber at 14 days,
// red once expired. Hidden entirely until VITE_BILLING_ENABLED=true, while the
// trial has more than 30 days left, or once the association has a subscription.
const BILLING_ENABLED = import.meta.env.VITE_BILLING_ENABLED === 'true'

export default function TrialBanner({ hoaId }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    setData(null)
    if (!BILLING_ENABLED || !hoaId || hoaId === '__all__') return
    apiGet(`/hoa/${hoaId}/billing`).then(setData).catch(() => {})
  }, [hoaId])

  if (!data || data.has_subscription || !data.trial_ends_at) return null

  if (!data.trial_active) {
    return (
      <div className="mb-4 rounded-xl border border-[#E8B4A6] bg-[#FDF2EF] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-[#7A2E1D]">
          <span className="font-semibold">Your free trial has ended.</span>{' '}
          Subscribe to keep tracking owner insurance for this association.
        </p>
        <Link
          to="/admin/settings"
          className="bg-[#001842] hover:bg-[#0A2A63] text-white font-semibold py-1.5 px-4 rounded-lg text-sm flex-shrink-0"
        >
          Subscribe
        </Link>
      </div>
    )
  }

  if (data.trial_days_left > 30) return null

  if (data.trial_days_left > 14) {
    return (
      <div className="mb-4 rounded-xl border border-[#DCE3EC] bg-white px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-[#54627A]">
          <span className="font-semibold text-[#0B1B33]">
            {data.trial_days_left} days left in your free trial.
          </span>{' '}
          Set up billing whenever you're ready — billing won't start until the trial ends.
        </p>
        <Link
          to="/admin/settings"
          className="font-semibold py-1.5 px-4 rounded-lg text-sm border border-[#DCE3EC] text-[#0B1B33] hover:bg-slate-50 flex-shrink-0"
        >
          Set up billing
        </Link>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-xl border border-[#F0DDAE] bg-[#FDF8EC] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <p className="text-sm text-[#6B4E0B]">
        <span className="font-semibold">
          {data.trial_days_left} day{data.trial_days_left !== 1 ? 's' : ''} left in your free trial.
        </span>{' '}
        Subscribe now — billing won't start until the trial ends.
      </p>
      <Link
        to="/admin/settings"
        className="font-semibold py-1.5 px-4 rounded-lg text-sm border border-[#946410] text-[#6B4E0B] hover:bg-[#946410]/10 flex-shrink-0"
      >
        Set up billing
      </Link>
    </div>
  )
}
