// VOLUME per-unit pricing (since 2026-07-12), shared by the landing pricing
// section (/#pricing) and the standalone /pricing page so both always agree.
// Every unit pays the rate of the tier the TOTAL lands in:
// <=750 @ $1.00, 751-10,000 @ $0.50, 10,000+ @ $0.25, $50/mo min.
// Must match backend _volume_monthly_cents AND the Stripe volume price.
export function monthlyCost(units) {
  if (!units || units <= 0) return 0
  const rate = units <= 750 ? 1.0 : units <= 10000 ? 0.5 : 0.25
  return Math.max(units * rate, 50)
}

// $1,234 or $1,234.50 — drop cents when whole.
export function fmtUSD(n) {
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}
