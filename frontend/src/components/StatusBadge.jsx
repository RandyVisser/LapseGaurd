const colors = {
  active:         'bg-[#E2F4EC] text-[#0E8E68]',
  expiring:       'bg-[#E2F4EC] text-[#0E8E68]',  // same as active — expiring is a sub-indicator
  non_compliant:  'bg-[#FAEDD2] text-[#946410]',
  lapsed:         'bg-[#F9E1DA] text-[#C0492F]',
  missing:        'bg-[#E8ECF2] text-[#54627A]',
  pending_review: 'bg-[#E7EEFA] text-[#014AC5]',
  fail:           'bg-[#F9E1DA] text-[#C0492F]',
  pass:           'bg-[#E2F4EC] text-[#0E8E68]',
}

const labels = {
  active:         'Approved',
  expiring:       'Approved',
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
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#FAEDD2] text-[#946410] border border-[#F0DDAE]">
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
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${approved ? 'bg-[#E2F4EC] text-[#0E8E68] border border-[#0E8E68]/30' : (colors[status] || colors.missing)}`}>
        {approved ? 'Manual Approval' : (labels[status] || status)}
      </span>
      {isExpiringSoon && <ExpiringBadge />}
    </span>
  )
}
