"""
Regression tests for services/compliance.py — the logic that decides a unit's
overall status from its mix of HO6 / wind-only policies.
"""
from datetime import date, datetime, timedelta

from services.compliance import evaluate_compliance


_uploaded = datetime(2026, 1, 1, 12, 0, 0)


def _policy(id, status, coverage_type, exp_days=180, uploaded=None):
    return {
        "id": id,
        "status": status,
        "coverage_type": coverage_type,
        "expiration_date": date.today() + timedelta(days=exp_days) if exp_days is not None else None,
        "uploaded_at": uploaded or _uploaded,
    }


class TestNoPolicies:
    def test_empty_list_is_missing(self):
        result = evaluate_compliance([])
        assert result["status"] == "missing"
        assert result["current_ids"] == set()
        assert result["needs_wind_policy"] is False


class TestSingleHo6WithWind:
    def test_active_full_policy(self):
        result = evaluate_compliance([_policy("a", "active", "ho6_with_wind")])
        assert result["status"] == "active"
        assert result["current_ids"] == {"a"}
        assert result["needs_wind_policy"] is False

    def test_full_policy_beats_excluded_pair(self):
        result = evaluate_compliance([
            _policy("full", "active", "ho6_with_wind"),
            _policy("excl", "active", "ho6_wind_excluded"),
            _policy("wind", "active", "wind_only"),
        ])
        assert result["current_ids"] == {"full"}

    def test_newest_expiration_wins_within_type(self):
        result = evaluate_compliance([
            _policy("old", "active", "ho6_with_wind", exp_days=30),
            _policy("new", "active", "ho6_with_wind", exp_days=365),
        ])
        assert result["current_ids"] == {"new"}


class TestExcludedPlusWindPair:
    def test_pair_both_active(self):
        result = evaluate_compliance([
            _policy("excl", "active", "ho6_wind_excluded"),
            _policy("wind", "active", "wind_only"),
        ])
        assert result["status"] == "active"
        assert result["current_ids"] == {"excl", "wind"}
        assert result["needs_wind_policy"] is False

    def test_pair_takes_worse_status(self):
        result = evaluate_compliance([
            _policy("excl", "active", "ho6_wind_excluded"),
            _policy("wind", "lapsed", "wind_only", exp_days=-10),
        ])
        assert result["status"] == "lapsed"
        assert result["current_ids"] == {"excl", "wind"}

    def test_excluded_without_wind_needs_wind(self):
        result = evaluate_compliance([_policy("excl", "active", "ho6_wind_excluded")])
        assert result["status"] == "active"
        assert result["needs_wind_policy"] is True

    def test_pending_review_propagates(self):
        result = evaluate_compliance([
            _policy("excl", "pending_review", "ho6_wind_excluded"),
            _policy("wind", "active", "wind_only"),
        ])
        assert result["status"] == "pending_review"


class TestWindOnlyAlone:
    def test_active_wind_alone_is_non_compliant(self):
        result = evaluate_compliance([_policy("wind", "active", "wind_only")])
        assert result["status"] == "non_compliant"
        assert result.get("needs_ho6_policy") is True

    def test_expiring_wind_alone_is_non_compliant(self):
        result = evaluate_compliance([_policy("wind", "expiring", "wind_only", exp_days=10)])
        assert result["status"] == "non_compliant"

    def test_lapsed_wind_alone_stays_lapsed(self):
        result = evaluate_compliance([_policy("wind", "lapsed", "wind_only", exp_days=-10)])
        assert result["status"] == "lapsed"


class TestSuperseded:
    def test_superseded_policy_ignored(self):
        old = _policy("old", "active", "ho6_with_wind", exp_days=20)
        old["superseded_by"] = "new"
        result = evaluate_compliance([old, _policy("new", "active", "ho6_with_wind", exp_days=365)])
        assert result["current_ids"] == {"new"}

    def test_all_superseded_is_missing(self):
        old = _policy("old", "active", "ho6_with_wind")
        old["superseded_by"] = "gone"
        result = evaluate_compliance([old])
        assert result["status"] == "missing"

    def test_policies_without_key_unaffected(self):
        # Callers may pass dicts without the superseded_by key — must not crash
        result = evaluate_compliance([_policy("a", "active", "ho6_with_wind")])
        assert result["current_ids"] == {"a"}


class TestFallback:
    def test_unknown_coverage_type_falls_back_to_best(self):
        result = evaluate_compliance([
            _policy("u1", "lapsed", "unknown", exp_days=-30),
            _policy("u2", "active", "unknown"),
        ])
        assert result["status"] == "active"
        assert result["current_ids"] == {"u2"}

    def test_missing_status_policy(self):
        result = evaluate_compliance([_policy("m", "missing", "unknown", exp_days=None)])
        assert result["status"] == "missing"
