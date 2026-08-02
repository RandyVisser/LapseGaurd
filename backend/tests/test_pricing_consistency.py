"""
Guard: volume pricing must agree everywhere it is written down.

Per CLAUDE.md and backend/CLAUDE.md, the tiers live in several places that have
to change together or invoices diverge from what customers were shown:

  1. _volume_monthly_cents()      backend/routes/billing.py   <- tested directly
  2. the landing #pricing copy    frontend/src/pages/Landing.jsx  <- parsed here
  3. the public listing copy      docs/g2-capterra-listing-kit.md <- parsed here
  4. the live Stripe Price        NOT testable here — a live API call. If the
                                  tiers below change, re-verify Stripe by hand.

Rates: <=750 units $1.00/unit, 751-10,000 $0.50/unit, >10,000 $0.25/unit,
with a $50/month minimum. Volume (not graduated): every unit bills at the rate
of the tier the TOTAL lands in.
"""
import re
from pathlib import Path

from routes.billing import _volume_monthly_cents

REPO = Path(__file__).resolve().parent.parent.parent
LANDING = REPO / "frontend" / "src" / "pages" / "Landing.jsx"
LISTING_KIT = REPO / "docs" / "g2-capterra-listing-kit.md"

TIER_1_RATE, TIER_2_RATE, TIER_3_RATE = 100, 50, 25  # cents per unit
TIER_1_MAX, TIER_2_MAX = 750, 10_000
MINIMUM_CENTS = 5000


class TestVolumeMonthlyCents:
    def test_tier_rates_at_boundaries(self):
        assert _volume_monthly_cents(TIER_1_MAX) == TIER_1_MAX * TIER_1_RATE
        assert _volume_monthly_cents(TIER_1_MAX + 1) == (TIER_1_MAX + 1) * TIER_2_RATE
        assert _volume_monthly_cents(TIER_2_MAX) == TIER_2_MAX * TIER_2_RATE
        assert _volume_monthly_cents(TIER_2_MAX + 1) == (TIER_2_MAX + 1) * TIER_3_RATE

    def test_fifty_dollar_minimum(self):
        assert _volume_monthly_cents(1) == MINIMUM_CENTS
        assert _volume_monthly_cents(49) == MINIMUM_CENTS
        assert _volume_monthly_cents(50) == MINIMUM_CENTS  # 50 units x $1 == the minimum
        assert _volume_monthly_cents(51) == 51 * TIER_1_RATE  # above it, per-unit wins

    def test_zero_units_is_free(self):
        assert _volume_monthly_cents(0) == 0
        assert _volume_monthly_cents(-5) == 0

    def test_the_750_to_751_cliff_is_intact(self):
        """751 units costs LESS than 750. Known and accepted ('simplicity sells')
        — asserted so nobody 'fixes' it into graduated pricing without also
        changing Stripe and the landing copy."""
        assert _volume_monthly_cents(751) < _volume_monthly_cents(750)

    def test_landing_page_example_still_true(self):
        """The landing states: 'A 120-unit association pays $120/month.'"""
        assert _volume_monthly_cents(120) == 12_000


class TestPublishedCopyMatches:
    def _landing(self) -> str:
        return LANDING.read_text()

    def test_landing_tier_prices(self):
        prices = re.findall(r'className="tprice">\$([0-9.]+)', self._landing())
        assert prices == ["1.00", "0.50", "0.25"], (
            f"Landing #pricing tiers are {prices}; _volume_monthly_cents implies "
            "['1.00', '0.50', '0.25']. Change both, plus the Stripe Price."
        )

    def test_landing_states_the_minimum(self):
        assert "$50/mo minimum" in self._landing(), (
            "The landing no longer states the $50/mo minimum that "
            "_volume_monthly_cents enforces."
        )

    def test_landing_worked_example_matches_the_function(self):
        m = re.search(r"A (\d+)-unit association pays <b>\$([0-9,]+)/month</b>", self._landing())
        assert m, "The landing's worked pricing example is gone or reworded."
        units, dollars = int(m.group(1)), int(m.group(2).replace(",", ""))
        assert _volume_monthly_cents(units) == dollars * 100, (
            f"Landing says {units} units costs ${dollars}/mo, but "
            f"_volume_monthly_cents says ${_volume_monthly_cents(units) / 100:.2f}."
        )

    def test_cost_calculator_matches_the_billing_function(self):
        """The public cost calculator reimplements the tiers in JS because it is a
        static page with no backend. Extract its constants and check they produce
        the same number as _volume_monthly_cents across the whole range."""
        calc = REPO / "frontend" / "public" / "guides" / "ho6-compliance-cost-calculator.html"
        if not calc.exists():
            return
        src = calc.read_text()

        def const(name: str) -> float:
            m = re.search(rf"var {name} = ([0-9.]+)", src)
            assert m, f"{name} missing from the cost calculator — did the script get rewritten?"
            return float(m.group(1))

        t1_max, t2_max = int(const("TIER_1_MAX")), int(const("TIER_2_MAX"))
        r1, r2, r3 = const("RATE_1"), const("RATE_2"), const("RATE_3")
        minimum = const("MINIMUM")

        assert (t1_max, t2_max) == (TIER_1_MAX, TIER_2_MAX)
        assert (r1, r2, r3) == (TIER_1_RATE / 100, TIER_2_RATE / 100, TIER_3_RATE / 100)
        assert minimum == MINIMUM_CENTS / 100

        def js_monthly(units: int) -> float:
            if units <= 0:
                return 0.0
            rate = r1 if units <= t1_max else r2 if units <= t2_max else r3
            return max(units * rate, minimum)

        for units in (0, 1, 25, 49, 50, 51, 120, 500, 749, 750, 751, 1000,
                      9999, 10_000, 10_001, 25_000):
            assert round(js_monthly(units) * 100) == _volume_monthly_cents(units), (
                f"At {units} units the calculator says ${js_monthly(units):,.2f} but "
                f"_volume_monthly_cents says ${_volume_monthly_cents(units) / 100:,.2f}."
            )

    def test_public_listing_copy_matches(self):
        """docs/g2-capterra-listing-kit.md is pasted into G2/Capterra, so a stale
        figure there contradicts the invoice in public."""
        if not LISTING_KIT.exists():
            return  # kit is optional; nothing to check
        kit = LISTING_KIT.read_text()
        for rate in ("$1.00", "$0.50", "$0.25"):
            assert rate in kit, f"Listing kit no longer quotes the {rate} tier."
        assert "$50" in kit, "Listing kit no longer quotes the $50/month minimum."
