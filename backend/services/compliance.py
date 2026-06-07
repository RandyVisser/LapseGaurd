"""
Determines a unit's overall insurance compliance from its tenant's policies.

Florida HO6 condo coverage can be satisfied two ways:
  - a single HO6 policy that includes wind coverage, or
  - an HO6 policy that excludes wind PLUS a separate standalone wind-only policy

So "the current policy" isn't always a single row — it can be a pair that
must both be in force. This module picks the right policy (or pair) and
derives one overall status for display.
"""
from datetime import date

from models.schemas import PolicyStatus

_COVERAGE_STATUSES = (PolicyStatus.active.value, PolicyStatus.expiring.value, PolicyStatus.lapsed.value)
_STATUS_PRIORITY = {PolicyStatus.active.value: 0, PolicyStatus.expiring.value: 1, PolicyStatus.lapsed.value: 2}


def _sort_key(p):
    return (
        _STATUS_PRIORITY.get(p["status"], 3),
        date.min if p["expiration_date"] is None else p["expiration_date"],
        p["uploaded_at"],
    )


def _best_overall(policies):
    """Mirrors the legacy single-best-policy ordering (status, then newest expiration/upload)."""
    return min(policies, key=_sort_key)


def _pick_current(policies, coverage_type):
    """Among policies of one coverage_type, pick the one with the newest expiration date
    (ties broken by most recent upload) — i.e. the most current term for that coverage."""
    matches = [p for p in policies if p["coverage_type"] == coverage_type]
    if not matches:
        return None
    return max(matches, key=lambda p: (
        date.min if p["expiration_date"] is None else p["expiration_date"],
        p["uploaded_at"],
    ))


def _worse_status(a, b):
    return a if _STATUS_PRIORITY.get(a, 3) >= _STATUS_PRIORITY.get(b, 3) else b


def evaluate_compliance(policies: list[dict]) -> dict:
    """
    policies: list of dicts with keys: id, status, coverage_type, expiration_date, uploaded_at

    Returns: {
        "status": <PolicyStatus value>,
        "current_ids": set of policy ids that make up the current coverage,
        "needs_wind_policy": True if the HO6 on file excludes wind and no
                             standalone wind policy is on file
    }
    """
    if not policies:
        return {"status": PolicyStatus.missing.value, "current_ids": set(), "needs_wind_policy": False}

    full = _pick_current(policies, "ho6_with_wind")
    if full and full["status"] in _COVERAGE_STATUSES:
        return {"status": full["status"], "current_ids": {full["id"]}, "needs_wind_policy": False}

    excluded = _pick_current(policies, "ho6_wind_excluded")
    if excluded and excluded["status"] in _COVERAGE_STATUSES:
        wind = _pick_current(policies, "wind_only")
        if wind and wind["status"] in _COVERAGE_STATUSES:
            return {
                "status": _worse_status(excluded["status"], wind["status"]),
                "current_ids": {excluded["id"], wind["id"]},
                "needs_wind_policy": False,
            }
        return {"status": PolicyStatus.lapsed.value, "current_ids": {excluded["id"]}, "needs_wind_policy": True}

    best = _best_overall(policies)
    return {"status": best["status"], "current_ids": {best["id"]}, "needs_wind_policy": False}
