"""Tests for the unit-list importer: messy-data normalization, date parsing,
heuristic column mapping, CSV/XLSX parsing."""
import io

import pytest

from services.importer import (
    flexible_date, heuristic_mapping, normalize_row, build_preview, parse_upload,
)


class TestFlexibleDate:
    def test_iso(self):
        assert flexible_date("2024-01-15") == "2024-01-15"

    def test_us_slash(self):
        assert flexible_date("1/15/2024") == "2024-01-15"
        assert flexible_date("01/15/2024") == "2024-01-15"

    def test_two_digit_year(self):
        assert flexible_date("1/15/24") == "2024-01-15"

    def test_dash_us(self):
        assert flexible_date("01-15-2024") == "2024-01-15"

    def test_month_name(self):
        assert flexible_date("Jan 15, 2024") == "2024-01-15"
        assert flexible_date("January 15, 2024") == "2024-01-15"

    def test_datetime_suffix(self):
        assert flexible_date("01/15/2024 00:00:00") == "2024-01-15"

    def test_unparseable_returns_none(self):
        assert flexible_date("sometime in 2024") is None
        assert flexible_date("") is None
        assert flexible_date(None) is None

    def test_never_raises(self):
        for junk in ["13/45/9999", "abc", "  ", "0", "Q1 2024"]:
            flexible_date(junk)  # must not raise


class TestHeuristicMapping:
    def test_common_headers(self):
        m = heuristic_mapping(["Unit #", "Owner Name", "Email Address", "Street Address"])
        assert m["unit_number"] == "Unit #"
        assert m["owner_primary"] == "Owner Name"
        assert m["email_primary"] == "Email Address"
        assert m["street_address"] == "Street Address"

    def test_email_not_confused_with_owner(self):
        m = heuristic_mapping(["Owner", "Owner Email"])
        assert m["owner_primary"] == "Owner"
        assert m["email_primary"] == "Owner Email"

    def test_secondary_owner(self):
        m = heuristic_mapping(["Unit", "Primary Name", "Secondary Name", "Email 2"])
        assert m["owner_primary"] == "Primary Name"
        assert m["owner_secondary"] == "Secondary Name"
        assert m["email_secondary"] == "Email 2"

    def test_each_header_used_once(self):
        m = heuristic_mapping(["Name", "Unit"])
        assert len(set(m.values())) == len(m.values())


class TestNormalizeRow:
    MAP = {"unit_number": "Unit", "owner_primary": "Owner", "email_primary": "Email",
           "state": "State", "zip": "Zip", "purchase_date": "Purchased"}

    def test_basic(self):
        raw = {"Unit": "4B", "Owner": "Jane Smith", "Email": "jane@x.com",
               "State": "FL", "Zip": "33139", "Purchased": "1/15/2024"}
        norm, issues = normalize_row(raw, self.MAP)
        assert norm["unit_number"] == "4B"
        assert norm["owner_primary"] == "Jane Smith"
        assert norm["purchase_date"] == "2024-01-15"
        assert issues == []

    def test_missing_unit_flagged(self):
        norm, issues = normalize_row({"Owner": "Jane"}, self.MAP)
        assert norm["unit_number"] is None
        assert any("unit number" in i for i in issues)

    def test_invalid_email_flagged_but_kept(self):
        raw = {"Unit": "1", "Email": "not-an-email"}
        norm, issues = normalize_row(raw, self.MAP)
        assert norm["email_primary"] == "not-an-email"
        assert any("email" in i for i in issues)

    def test_full_state_name_abbreviated(self):
        norm, _ = normalize_row({"Unit": "1", "State": "Florida"}, self.MAP)
        assert norm["state"] == "FL"

    def test_zip_plus_four_trimmed(self):
        norm, _ = normalize_row({"Unit": "1", "Zip": "33139-1234"}, self.MAP)
        assert norm["zip"] == "33139"

    def test_unit_extracted_from_address(self):
        m = {"street_address": "Address"}
        norm, _ = normalize_row({"Address": "123 Ocean Dr Apt 5C"}, m)
        assert norm["unit_number"] == "5C"
        assert norm["street_address"] == "123 Ocean Dr"

    def test_bad_date_flagged_not_fatal(self):
        norm, issues = normalize_row({"Unit": "1", "Purchased": "whenever"}, self.MAP)
        assert norm["purchase_date"] is None
        assert any("date" in i for i in issues)


class TestBuildPreview:
    def test_counts_and_issues(self):
        mapping = {"unit_number": "Unit", "email_primary": "Email"}
        rows = [
            {"Unit": "1", "Email": "a@b.com"},
            {"Unit": "", "Email": "x@y.com"},     # missing unit → skipped
            {"Unit": "3", "Email": "bad"},          # invalid email
        ]
        result = build_preview(["Unit", "Email"], rows, mapping)
        assert result["total_rows"] == 3
        assert result["importable"] == 2
        assert any("no unit number" in s for s in result["issues"])
        assert any("invalid" in s for s in result["issues"])


class TestParseUpload:
    def test_csv(self):
        content = b"Unit,Owner\n4B,Jane\n5C,Bob\n"
        headers, rows = parse_upload("units.csv", content)
        assert headers == ["Unit", "Owner"]
        assert len(rows) == 2
        assert rows[0]["Unit"] == "4B"

    def test_csv_utf8_bom(self):
        content = "﻿Unit,Owner\n1,A\n".encode("utf-8")
        headers, rows = parse_upload("units.csv", content)
        assert headers == ["Unit", "Owner"]

    def test_empty_csv_raises(self):
        with pytest.raises(ValueError):
            parse_upload("e.csv", b"Unit,Owner\n")

    def test_xlsx_roundtrip(self):
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Unit", "Owner", "Zip"])
        ws.append(["4B", "Jane", 33139])  # numeric zip → must become "33139" not "33139.0"
        buf = io.BytesIO()
        wb.save(buf)
        headers, rows = parse_upload("units.xlsx", buf.getvalue())
        assert headers == ["Unit", "Owner", "Zip"]
        assert rows[0]["Unit"] == "4B"
        assert rows[0]["Zip"] == "33139"
