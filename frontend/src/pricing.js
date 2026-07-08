// Graduated per-unit pricing, shared by the landing pricing section (/#pricing)
// and the standalone /pricing page so both always agree.
// First 750 units @ $1.00, next up to 10,000 @ $0.50, beyond @ $0.25, $50/mo min.
export function monthlyCost(units) {
  if (!units || units <= 0) return 0
  let cost
  if (units <= 750) cost = units * 1.0
  else if (units <= 10000) cost = 750 + (units - 750) * 0.5
  else cost = 750 + 9250 * 0.5 + (units - 10000) * 0.25
  return Math.max(cost, 50)
}

// $1,234 or $1,234.50 — drop cents when whole.
export function fmtUSD(n) {
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}
