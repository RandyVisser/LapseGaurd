const colors = {
  active: 'bg-green-100 text-green-800',
  expiring: 'bg-yellow-100 text-yellow-800',
  non_compliant: 'bg-orange-100 text-orange-800',
  lapsed: 'bg-red-100 text-red-800',
  missing: 'bg-yellow-100 text-yellow-800',
  pending_review: 'bg-blue-100 text-blue-800',
  fail: 'bg-red-100 text-red-800',
  pass: 'bg-green-100 text-green-800',
  expired: 'bg-slate-100 text-slate-500',
}

const labels = {
  non_compliant: 'Non-Compliant',
  pending_review: 'Pending Review',
  fail: 'Fail',
  pass: 'Pass',
  expired: 'Expired',
}

export default function StatusBadge({ status }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${colors[status] || colors.missing}`}>
      {labels[status] || status}
    </span>
  )
}
