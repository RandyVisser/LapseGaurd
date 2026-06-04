const colors = {
  active: 'bg-green-100 text-green-800',
  expiring: 'bg-yellow-100 text-yellow-800',
  lapsed: 'bg-red-100 text-red-800',
  missing: 'bg-gray-100 text-gray-600',
}

export default function StatusBadge({ status }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${colors[status] || colors.missing}`}>
      {status}
    </span>
  )
}
