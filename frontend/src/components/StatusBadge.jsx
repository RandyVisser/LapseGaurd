const colors = {
  active: 'bg-green-100 text-green-800',
  expiring: 'bg-yellow-100 text-yellow-800',
  lapsed: 'bg-red-100 text-red-800',
  missing: 'bg-yellow-100 text-yellow-800',
  pending_review: 'bg-blue-100 text-blue-800',
}

const labels = {
  pending_review: 'Pending Review',
}

export default function StatusBadge({ status }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${colors[status] || colors.missing}`}>
      {labels[status] || status}
    </span>
  )
}
