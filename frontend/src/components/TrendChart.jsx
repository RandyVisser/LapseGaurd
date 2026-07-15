import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// Compliance-trend chart for the classic admin dashboard. Lives in its own
// file so recharts code-splits into an on-demand chunk (loaded via
// React.lazy on first "VIEW TREND" expand) instead of shipping in the
// AdminDashboard bundle on first paint.
export default function TrendChart({ data }) {
  if (!data || data.length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-4 mb-4">
      <p className="text-xs font-semibold text-[#54627A] uppercase tracking-wide mb-3">Compliance Trend (6 months)</p>
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
            formatter={(val, name) => [val, name === 'compliant' ? 'Compliant' : name === 'expiring' ? 'Expiring' : 'Lapsed']}
          />
          <Line type="monotone" dataKey="compliant" stroke="#16a34a" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="expiring" stroke="#ca8a04" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="lapsed" stroke="#dc2626" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
