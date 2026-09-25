"""Add-Emails wizard planner (services.importer.plan_email_fill): matches an
uploaded list onto EXISTING owner units on (street address, unit number), like
the importer's dedup key. Pure — no DB."""
from services.importer import plan_email_fill

MAP = {"unit_number": "Unit", "street_address": "Street", "email_primary": "Email"}
MAP_NO_ADDR = {"unit_number": "Unit", "email_primary": "Email"}


def _u(id, unit, street="100 Ocean Dr", email=None, **kw):
    return {"id": id, "unit_number": unit, "street_address": street,
            "email_primary": email, "email_secondary": None,
            "assoc_title": kw.get("assoc_title"), "parent_unit_id": kw.get("parent_unit_id")}


def _row(unit, email, street=None):
    r = {"Unit": unit, "Email": email}
    if street is not None:
        r["Street"] = street
    return r


def _status(plan):
    return [r["status"] for r in plan["rows"]]


class TestMatching:
    def test_same_unit_number_two_buildings_matched_by_address(self):
        units = [_u("a", "101", "100 Ocean Dr"), _u("b", "101", "200 Ocean Dr")]
        plan = plan_email_fill(units, [_row("101", "x@example.com", "200 Ocean Dr")], MAP)
        assert _status(plan) == ["fill"]
        assert plan["updates"] == [{"unit_id": "b", "email_primary": "x@example.com"}]

    def test_same_unit_number_no_address_is_ambiguous_and_refused(self):
        units = [_u("a", "101", "100 Ocean Dr"), _u("b", "101", "200 Ocean Dr")]
        plan = plan_email_fill(units, [_row("101", "x@example.com")], MAP_NO_ADDR)
        assert _status(plan) == ["ambiguous"]
        assert plan["updates"] == []
        assert set(plan["rows"][0]["candidates"]) == {"100 Ocean Dr", "200 Ocean Dr"}

    def test_old_bug_first_unit_no_longer_wins(self):
        # The previous by_norm.setdefault kept the FIRST unit "101" and wrote
        # every "101" row onto it.
        units = [_u("a", "101", "100 Ocean Dr"), _u("b", "101", "200 Ocean Dr")]
        rows = [_row("101", "one@example.com", "100 Ocean Dr"),
                _row("101", "two@example.com", "200 Ocean Dr")]
        plan = plan_email_fill(units, rows, MAP)
        assert {u["unit_id"]: u["email_primary"] for u in plan["updates"]} == {
            "a": "one@example.com", "b": "two@example.com"}

    def test_unique_unit_number_without_address_matches(self):
        plan = plan_email_fill([_u("a", "204")], [_row("Apt 204", "x@example.com")], MAP_NO_ADDR)
        assert _status(plan) == ["fill"]

    def test_single_building_tolerates_address_formatting(self):
        plan = plan_email_fill([_u("a", "204", "100 Ocean Dr")],
                               [_row("204", "x@example.com", "100 Ocean Drive")], MAP)
        assert _status(plan) == ["fill"]

    def test_multi_building_address_mismatch_refused(self):
        units = [_u("a", "204", "100 Ocean Dr"), _u("b", "305", "200 Ocean Dr")]
        plan = plan_email_fill(units, [_row("204", "x@example.com", "900 Other St")], MAP)
        assert _status(plan) == ["no_match"]
        assert plan["updates"] == []

    def test_address_whitespace_and_case_normalized(self):
        units = [_u("a", "101", "100 Ocean Dr"), _u("b", "101", "200 Ocean Dr")]
        plan = plan_email_fill(units, [_row("101", "x@example.com", " 200  ocean dr ")], MAP)
        assert plan["updates"][0]["unit_id"] == "b"


class TestExcludedRows:
    def test_pm_admin_contact_rows_never_matched(self):
        units = [_u("pm", "PM", assoc_title="Property Manager"),
                 _u("ad", "ADMIN", assoc_title="Admin")]
        plan = plan_email_fill(units, [_row("PM", "x@example.com"), _row("ADMIN", "y@example.com")],
                               MAP_NO_ADDR)
        assert _status(plan) == ["no_match", "no_match"]

    def test_renter_sub_unit_never_matched(self):
        units = [_u("owner", "101"), _u("renter", "101", parent_unit_id="owner")]
        plan = plan_email_fill(units, [_row("101", "x@example.com")], MAP_NO_ADDR)
        # Only the owner unit counts, so this is NOT ambiguous
        assert plan["updates"] == [{"unit_id": "owner", "email_primary": "x@example.com"}]


class TestFillInSemantics:
    def test_existing_different_email_kept_by_default(self):
        plan = plan_email_fill([_u("a", "101", email="old@example.com")],
                               [_row("101", "new@example.com")], MAP_NO_ADDR)
        assert _status(plan) == ["conflict"]
        assert plan["updates"] == []
        assert plan["rows"][0]["existing"] == {"email_primary": "old@example.com"}

    def test_overwrite_is_explicit(self):
        plan = plan_email_fill([_u("a", "101", email="old@example.com")],
                               [_row("101", "new@example.com")], MAP_NO_ADDR, overwrite=True)
        assert _status(plan) == ["replace"]
        assert plan["updates"] == [{"unit_id": "a", "email_primary": "new@example.com"}]

    def test_placeholder_counts_as_blank(self):
        plan = plan_email_fill([_u("a", "101", email="unit101@condo.insure")],
                               [_row("101", "real@example.com")], MAP_NO_ADDR)
        assert _status(plan) == ["fill"]

    def test_same_email_is_unchanged(self):
        plan = plan_email_fill([_u("a", "101", email="Same@Example.com")],
                               [_row("101", "same@example.com")], MAP_NO_ADDR)
        assert _status(plan) == ["unchanged"]
        assert plan["updates"] == []

    def test_duplicate_rows_for_same_unit_first_wins(self):
        plan = plan_email_fill([_u("a", "101")],
                               [_row("101", "one@example.com"), _row("#101", "two@example.com")],
                               MAP_NO_ADDR)
        assert _status(plan) == ["fill", "duplicate"]
        assert plan["updates"] == [{"unit_id": "a", "email_primary": "one@example.com"}]

    def test_invalid_and_missing_email_skipped(self):
        plan = plan_email_fill([_u("a", "101"), _u("b", "102")],
                               [_row("101", "not-an-email"), _row("102", "")], MAP_NO_ADDR)
        assert _status(plan) == ["invalid", "no_email"]
        assert plan["updates"] == []

    def test_counts(self):
        plan = plan_email_fill([_u("a", "101"), _u("b", "102", email="old@example.com")],
                               [_row("101", "x@example.com"), _row("102", "y@example.com"),
                                _row("999", "z@example.com")], MAP_NO_ADDR)
        c = plan["counts"]
        assert (c["fill"], c["conflict"], c["no_match"]) == (1, 1, 1)
