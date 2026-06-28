const colors = {
  active:         'bg-green-100 text-green-800',
  expiring:       'bg-green-100 text-green-800',  // same as active — expiring is a sub-indicator
  non_compliant:  'bg-orange-100 text-orange-800',
  lapsed:         'bg-red-100 text-red-800',
  missing:        'bg-slate-100 text-slate-500',
  pending_review: 'bg-blue-100 text-blue-800',
  fail:           'bg-red-100 text-red-800',
  pass:           'bg-green-100 text-green-800',
}

const labels = {
  active:         'AI Approved',
  expiring:       'AI Approved',
  non_compliant:  'Needs Attention',
  lapsed:         'Expired',
  missing:        'Missing Policy',
  pending_review: 'Pending Review',
  fail:           'Fail',
  pass:           'Pass',
}

// Expiring Soon sub-badge — shown alongside the main status when policy expires within 30 days
export function ExpiringBadge() {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
      Expiring Soon
    </span>
  )
}

export default function StatusBadge({ status, expirationDate, manuallyApproved }) {
  const isExpiringSoon = expirationDate && status !== 'lapsed' && status !== 'missing' && (() => {
    const days = Math.ceil((new Date(expirationDate) - new Date()) / (1000 * 60 * 60 * 24))
    return days >= 0 && days <= 30
  })()

  // A PM/Admin override forces the unit compliant — flag it distinctly.
  const approved = manuallyApproved && (status === 'active' || status === 'expiring')

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${approved ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : (colors[status] || colors.missing)}`}>
        {approved ? 'Manual Approval' : (labels[status] || status)}
      </span>
      {isExpiringSoon && <ExpiringBadge />}
    </span>
  )
}
