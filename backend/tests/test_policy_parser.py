"""
Regression tests for the pure-Python parts of the dec page parser:
party classification, validation flags, and Claude response parsing.
No API calls or PDFs needed — these guard the logic that decides
compliance from already-extracted fields.
"""
from datetime import date, timedelta

from services.policy_parser import _dedupe_insured_lists, _validate, _parse_response


def _future(days=180):
    return (date.today() + timedelta(days=days)).isoformat()


def _past(days=30):
    return (date.today() - timedelta(days=days)).isoformat()


# ---------------------------------------------------------------------------
# _dedupe_insured_lists — listed_parties -> additional_insureds / interests
# ---------------------------------------------------------------------------

class TestDedupeInsuredLists:
    def test_additional_insured_classified(self):
        result = _dedupe_insured_lists({
            "listed_parties": [{"name": "Oceanview Condo Assn", "designation": "Additional Insured"}]
        })
        assert result["additional_insureds"] == ["Oceanview Condo Assn"]
        assert result["additional_interests"] == []

    def test_interest_designations_classified(self):
        for label in ["Additional Interest", "Mortgagee", "Loss Payee", "Certificate Holder",
                      "ATIMA", "Lienholder", "Lender"]:
            result = _dedupe_insured_lists({
                "listed_parties": [{"name": "First Bank", "designation": label}]
            })
            assert result["additional_interests"] == ["First Bank"], f"failed for {label!r}"
            assert result["additional_insureds"] == []

    def test_designation_matching_is_case_insensitive(self):
        result = _dedupe_insured_lists({
            "listed_parties": [{"name": "HOA Inc", "designation": "ADDITIONAL INSURED"}]
        })
        assert result["additional_insureds"] == ["HOA Inc"]

    def test_agents_and_brokers_skipped(self):
        for label in ["Agent", "Agency", "Producer", "Broker", "Servicing Agent",
                      "Writing Agent", "Authorized Representative"]:
            result = _dedupe_insured_lists({
                "listed_parties": [{"name": "Bob's Insurance", "designation": label}]
            })
            assert result["additional_insureds"] == [], f"failed for {label!r}"
            assert result["additional_interests"] == [], f"failed for {label!r}"

    def test_unknown_designation_skipped(self):
        result = _dedupe_insured_lists({
            "listed_parties": [{"name": "Someone", "designation": "Premium Finance Company"}]
        })
        assert result["additional_insureds"] == []
        assert result["additional_interests"] == []

    def test_party_cannot_land_in_both_lists(self):
        # "additional insured" keyword wins over interest keywords
        result = _dedupe_insured_lists({
            "listed_parties": [{"name": "HOA", "designation": "Additional Insured / Mortgagee"}]
        })
        assert result["additional_insureds"] == ["HOA"]
        assert result["additional_interests"] == []

    def test_blank_names_and_non_dicts_skipped(self):
        result = _dedupe_insured_lists({
            "listed_parties": [
                {"name": "  ", "designation": "Additional Insured"},
                "not a dict",
                {"designation": "Mortgagee"},
            ]
        })
        assert result["additional_insureds"] == []
        assert result["additional_interests"] == []

    def test_fallback_to_existing_arrays_when_no_listed_parties(self):
        result = _dedupe_insured_lists({
            "listed_parties": [],
            "additional_insureds": ["HOA Inc"],
            "additional_interests": "First Bank",  # string gets coerced to list
        })
        assert result["additional_insureds"] == ["HOA Inc"]
        assert result["additional_interests"] == ["First Bank"]

    def test_missing_listed_parties_key(self):
        result = _dedupe_insured_lists({})
        assert result["additional_insureds"] == []
        assert result["additional_interests"] == []


# ---------------------------------------------------------------------------
# _validate — compliance flags
# ---------------------------------------------------------------------------

class TestValidateExpiration:
    def test_expired_policy_flagged(self):
        v = _validate({"expiration_date": _past()}, {})
        assert not v["passed"]
        assert any("expired" in f for f in v["flags"])

    def test_future_expiration_passes(self):
        v = _validate({"expiration_date": _future()}, {})
        assert v["passed"]

    def test_bad_date_string_ignored(self):
        v = _validate({"expiration_date": "not-a-date"}, {})
        assert v["passed"]

    def test_falls_back_to_submitted_expiration(self):
        v = _validate({}, {"expiration_date": _past()})
        assert any("expired" in f for f in v["flags"])


class TestValidateCrossChecks:
    def test_insurer_substring_match_passes(self):
        v = _validate({"insurer": "State Farm Fire and Casualty Company",
                       "expiration_date": _future()},
                      {"insurer": "State Farm"})
        assert v["passed"]

    def test_insurer_mismatch_flagged(self):
        v = _validate({"insurer": "Citizens Property Insurance"},
                      {"insurer": "State Farm"})
        assert any("Insurer mismatch" in f for f in v["flags"])

    def test_policy_number_mismatch_flagged(self):
        v = _validate({"policy_number": "ABC-123"}, {"policy_number": "XYZ-999"})
        assert any("Policy number mismatch" in f for f in v["flags"])

    def test_policy_number_case_insensitive(self):
        v = _validate({"policy_number": "abc-123", "expiration_date": _future()},
                      {"policy_number": "ABC-123"})
        assert v["passed"]

    def test_expiration_date_mismatch_flagged(self):
        v = _validate({"expiration_date": _future(100)},
                      {"expiration_date": _future(200)})
        assert any("Expiration date mismatch" in f for f in v["flags"])


class TestValidateNamedInsured:
    def test_owner_matches_named_insured(self):
        v = _validate({"named_insured": "Jane Q. Smith", "expiration_date": _future()},
                      {"named_insured": "Jane Smith"})
        assert v["passed"]

    def test_owner_matches_via_additional_insured(self):
        # Unit owned by an LLC; individual listed as additional insured
        v = _validate({"named_insured": "Seaside Holdings LLC",
                       "additional_insureds": ["Jane Smith"],
                       "expiration_date": _future()},
                      {"named_insured": "Jane Smith"})
        assert v["passed"]

    def test_owner_not_on_policy_flagged(self):
        v = _validate({"named_insured": "Bob Jones",
                       "additional_insureds": ["First Bank"]},
                      {"named_insured": "Jane Smith"})
        assert any("Named insured mismatch" in f for f in v["flags"])

    def test_additional_insureds_string_coerced(self):
        v = _validate({"named_insured": "Seaside Holdings LLC",
                       "additional_insureds": "Jane Smith",
                       "expiration_date": _future()},
                      {"named_insured": "Jane Smith"})
        assert v["passed"]


class TestValidateAddress:
    def test_same_address_passes(self):
        v = _validate({"property_address": "123 Ocean Blvd Unit 204, Naples, FL 34102",
                       "expiration_date": _future()},
                      {"address": "123 Ocean Blvd, Unit 204, Naples FL"})
        assert v["passed"]

    def test_different_address_flagged(self):
        v = _validate({"property_address": "456 Palm Ave Unit 1, Tampa, FL"},
                      {"address": "123 Ocean Blvd Unit 1, Naples, FL"})
        assert any("address mismatch" in f.lower() for f in v["flags"])

    def test_stopwords_alone_do_not_match(self):
        # Shared "unit"/"st"/state tokens must not count as overlap
        v = _validate({"property_address": "9 Main St Unit 2 FL"},
                      {"address": "77 Oak St Unit 5 FL"})
        assert any("address mismatch" in f.lower() for f in v["flags"])


class TestValidateHoaRequirements:
    def test_dwelling_below_minimum_flagged(self):
        v = _validate({"dwelling_coverage": 50000},
                      {"ho6_coverage_a_min": 150000})
        assert any("Coverage A" in f for f in v["flags"])

    def test_dwelling_meets_minimum(self):
        v = _validate({"dwelling_coverage": 150000, "expiration_date": _future()},
                      {"ho6_coverage_a_min": 150000})
        assert v["passed"]

    def test_liability_below_minimum_flagged(self):
        v = _validate({"liability_coverage": 100000},
                      {"ho6_coverage_e_min": 300000})
        assert any("Coverage E" in f for f in v["flags"])

    def test_missing_coverage_value_not_flagged(self):
        v = _validate({"dwelling_coverage": None, "expiration_date": _future()},
                      {"ho6_coverage_a_min": 150000})
        assert v["passed"]

    def test_wind_required_but_excluded_flagged(self):
        v = _validate({"coverage_type": "ho6_wind_excluded"},
                      {"ho6_wind_required": True})
        assert any("wind" in f.lower() for f in v["flags"])

    def test_wind_required_with_wind_passes(self):
        v = _validate({"coverage_type": "ho6_with_wind", "expiration_date": _future()},
                      {"ho6_wind_required": True})
        assert v["passed"]

    def test_wind_not_required_excluded_ok(self):
        v = _validate({"coverage_type": "ho6_wind_excluded", "expiration_date": _future()},
                      {"ho6_wind_required": False})
        assert v["passed"]


# ---------------------------------------------------------------------------
# _parse_response — Claude output handling
# ---------------------------------------------------------------------------

class TestParseResponse:
    def test_plain_json(self):
        assert _parse_response('{"insurer": "State Farm"}') == {"insurer": "State Farm"}

    def test_fenced_json(self):
        text = '```json\n{"insurer": "State Farm"}\n```'
        assert _parse_response(text) == {"insurer": "State Farm"}

    def test_fenced_json_no_language_tag(self):
        text = '```\n{"policy_number": "ABC-123"}\n```'
        assert _parse_response(text) == {"policy_number": "ABC-123"}

    def test_invalid_json_returns_none(self):
        assert _parse_response("Sorry, I can't read this document.") is None
