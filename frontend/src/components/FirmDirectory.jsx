// Super-user directory of PM firms (with a billing hover per firm) and the
// associations no firm manages. Lives on the Firm page; clicking an
// association hands off via onOpenHoa (selects it and jumps to its settings).
export default function FirmDirectory({ firms, availableHoas, onOpenHoa }) {
  const inFirm = new Set(firms.flatMap(f => f.hoas.map(h => h.id)))
  const independent = [...availableHoas]
    .filter(h => !inFirm.has(h.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  return (
    <>
      {firms.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6 mb-6">
          <p className="font-semibold text-[#0B1B33]">PM Firms</p>
          <p className="text-xs text-[#54627A] mt-1 mb-3">
            Property-management firms and the associations they manage. Hover a firm for its
            billing; click an association to open its settings.
          </p>
          <div className="border border-[#E8ECF2] rounded-lg divide-y divide-[#E8ECF2]">
            {firms.map(f => (
              <div key={f.id} className="px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="relative group">
                    <p className="text-sm font-medium text-[#0B1B33] cursor-help border-b border-dotted border-[#8493A8] inline">{f.name}</p>
                    {f.billing && (
                      <div className="hidden group-hover:block absolute left-0 top-full mt-1.5 z-20 w-64 bg-white border border-[#E8ECF2] rounded-lg shadow-lg p-3">
                        <p className="text-lg font-bold text-[#0B1B33]">
                          ${(f.billing.monthly_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          <span className="text-xs font-normal text-[#8493A8]">/mo</span>
                        </p>
                        <p className="text-xs text-[#54627A] mt-0.5">
                          {f.billing.units.toLocaleString()} billable unit{f.billing.units !== 1 ? 's' : ''} across{' '}
                          {f.hoas.length} association{f.hoas.length !== 1 ? 's' : ''}
                        </p>
                        <p className={`text-xs mt-1 font-medium ${f.billing.in_good_standing ? 'text-[#0E8E68]' : 'text-[#C0492F]'}`}>
                          {f.billing.has_subscription
                            ? `Subscription: ${f.billing.status}`
                            : 'No subscription yet'}
                        </p>
                        {f.billing.self_paying > 0 && (
                          <p className="text-xs text-[#8493A8] mt-1">
                            {f.billing.self_paying} association{f.billing.self_paying !== 1 ? 's' : ''} pay
                            {f.billing.self_paying === 1 ? 's' : ''} separately (not in this total).
                          </p>
                        )}
                      </div>
                    )}
                  </span>
                  <p className="text-xs text-[#8493A8] truncate">{f.members.join(', ')}</p>
                </div>
                {f.hoas.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {f.hoas.map(h => (
                      <button key={h.id} type="button" onClick={() => onOpenHoa(h.id)}
                        className="text-xs bg-[#EEF3FB] text-[#014AC5] hover:bg-[#DCE7F8] rounded px-2 py-0.5">
                        {h.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#8493A8] mt-1">No associations yet</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {independent.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E8ECF2] shadow-sm p-6 mb-6">
          <p className="font-semibold text-[#0B1B33]">Independent Associations</p>
          <p className="text-xs text-[#54627A] mt-1 mb-3">
            Self-managed — no PM firm attached. Click one to open its settings.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {independent.map(h => (
              <button key={h.id} type="button" onClick={() => onOpenHoa(h.id)}
                className="text-xs bg-[#EEF3FB] text-[#014AC5] hover:bg-[#DCE7F8] rounded px-2 py-0.5">
                {h.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
