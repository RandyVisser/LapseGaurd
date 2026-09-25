"""Board report and dashboard share one tally (routes.hoa.tally_compliance)."""
from routes.hoa import tally_compliance
from services.email import board_report_html


def _r(tid, title=None, invite=False, unit="1"):
    return {"tenant_id": tid, "assoc_title": title, "is_rental": False,
            "has_invite": invite, "unit_number": unit, "display_name": f"Owner {unit}"}


ROWS = [
    _r("a", unit="1"), _r("b", unit="2"), _r("c", unit="3"), _r("d", unit="4"),
    _r("e", unit="5"), _r(None, unit="6", invite=True), _r("m", unit="7"),
    _r("pm", title="Property Manager", unit="PM"), _r("ad", title="Admin", unit="ADMIN"),
]
STATUSES = {"a": "active", "b": "expiring", "c": "lapsed", "d": "non_compliant",
            "e": "pending_review", "m": "non_compliant"}
APPROVED = {"m": True}


def test_counts_match_dashboard_rules():
    t = tally_compliance(ROWS, STATUSES, APPROVED)
    assert t["total_units"] == 7            # PM + ADMIN contact rows excluded
    assert (t["property_managers"], t["admins"]) == (1, 1)
    assert t["compliant"] == 2              # active + expiring
    assert t["expiring"] == 1
    assert t["manually_approved"] == 1      # overrides its failing status
    assert (t["lapsed"], t["non_compliant"], t["pending_review"], t["missing"]) == (1, 1, 1, 1)
    assert t["invite_sent"] == 1


def test_attention_list_is_the_failing_units():
    t = tally_compliance(ROWS, STATUSES, APPROVED)
    assert [(a["unit_number"], a["status"]) for a in t["attention"]] == [
        ("3", "Lapsed"), ("4", "Needs attention"), ("5", "Pending review"), ("6", "Missing policy")]


def test_board_report_percentage_matches_hero_gauge():
    t = tally_compliance(ROWS, STATUSES, APPROVED)
    headline = t["compliant"] + t["manually_approved"]           # dashboard compliantTotal
    gauge_pct = round(headline / t["total_units"] * 100)         # dashboard Math.round
    _, html = board_report_html("H", t["total_units"], headline, t["expiring"], t["lapsed"],
                                t["missing"], t["attention"], non_compliant=t["non_compliant"],
                                pending_review=t["pending_review"],
                                manually_approved=t["manually_approved"])
    assert f"{headline} ({gauge_pct}%)" in html
