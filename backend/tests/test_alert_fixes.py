"""Regression tests for the alert/billing/email fixes — all run with no DB, no
env and no network (fake connection, monkeypatched send_email)."""
import asyncio
import inspect
import json
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser

import pytest

from services import email as email_mod
from services.email import deliverable_recipient, quote_link


# ── fake asyncpg connection ───────────────────────────────────────────────────

class FakeConn:
    def __init__(self, invites=(), reminder_counts=None, bounced=()):
        self.invites = list(invites)
        self.reminder_counts = reminder_counts or {}
        self.bounced = list(bounced)
        self.executed = []

    async def fetch(self, sql, *args):
        if "FROM unit_invites i" in sql:
            return self.invites
        if "invite_reminder_sent" in sql:
            return [{"token": t, "n": n} for t, n in self.reminder_counts.items()]
        if "email_bounces" in sql:
            return [{"email": e} for e in self.bounced]
        raise AssertionError(f"unexpected fetch: {sql[:80]}")

    async def execute(self, sql, *args):
        self.executed.append((sql, args))


def _invite(token, email="owner@example.com"):
    return {"token": token, "email": email, "hoa_id": "00000000-0000-0000-0000-000000000001",
            "unit_number": "101", "assoc_title": None, "owner_primary": "Pat", "owner_secondary": None,
            "email_primary": email, "email_secondary": None, "street_address": "1 Main St",
            "city": "Miami", "state": "FL", "zip": "33101", "hoa_name": "Sandbox Condo",
            "sender_email": None, "sender_name": None, "sender_title": None, "corp_name": "Sandbox Condo"}


@pytest.fixture
def sent(monkeypatch):
    import scripts.run_alerts as ra
    out = []

    async def fake_send(to, subject, html, **kw):
        out.append(to)
        return True
    monkeypatch.setattr(ra, "send_email", fake_send)
    return out


class TestInviteReminderCap:
    def test_stops_after_three(self, sent):
        from scripts.run_alerts import INVITE_REMINDER_CAP, process_invite_reminders
        assert INVITE_REMINDER_CAP == 3
        conn = FakeConn(invites=[_invite("t-new", "a@example.com"), _invite("t-2", "b@example.com"),
                                 _invite("t-capped", "c@example.com")],
                        reminder_counts={"t-2": 2, "t-capped": 3})
        n = asyncio.run(process_invite_reminders(conn))
        assert n == 2
        assert sent == ["a@example.com", "b@example.com"]

    def test_each_send_is_recorded_for_the_cap(self, sent):
        from scripts.run_alerts import process_invite_reminders
        conn = FakeConn(invites=[_invite("t-1")])
        asyncio.run(process_invite_reminders(conn))
        audits = [a for sql, a in conn.executed if "admin_audit_log" in sql]
        assert len(audits) == 1
        assert audits[0][3] == "invite_reminder_sent"
        assert json.loads(audits[0][4]) == {"token": "t-1"}

    def test_placeholder_and_bounced_still_skipped(self, sent):
        from scripts.run_alerts import process_invite_reminders
        conn = FakeConn(invites=[_invite("t-1", "unit1@condo.insure"), _invite("t-2", "gone@example.com")],
                        bounced=["gone@example.com"])
        assert asyncio.run(process_invite_reminders(conn)) == 0
        assert sent == []


class TestAlertsRunIsolation:
    def test_one_failing_processor_does_not_stop_the_rest(self, monkeypatch):
        import scripts.run_alerts as ra
        import routes.alerts as alerts
        ran = []

        def ok(name, value=0):
            async def f(conn):
                ran.append(name)
                return value
            return f

        async def boom(conn):
            ran.append("alerts")
            raise RuntimeError("bad row")

        monkeypatch.setattr(ra, "process_alerts", boom)
        monkeypatch.setattr(ra, "process_invite_reminders", ok("invite", 4))
        monkeypatch.setattr(ra, "process_noncompliant_reminders", ok("noncompliant"))
        monkeypatch.setattr(ra, "process_lease_alerts", ok("lease"))
        monkeypatch.setattr(ra, "process_trial_reminders", ok("trial"))
        monkeypatch.setattr(ra, "process_billing_sync", ok("billing", {"ok": True}))
        monkeypatch.setattr(alerts, "INTERNAL_API_KEY", "k")
        captured = []
        monkeypatch.setattr(alerts.sentry_sdk, "capture_exception", lambda e: captured.append(e))

        res = asyncio.run(alerts.run_alerts(x_api_key="k", conn=object()))
        assert ran == ["alerts", "invite", "noncompliant", "lease", "trial", "billing"]
        assert res["alerts_sent"] == 0 and res["invite_reminders_sent"] == 4
        assert "alerts" in res["errors"] and len(captured) == 1


class TestRecipientRule:
    def test_primary_first(self):
        assert deliverable_recipient("unit@example.com", "tenant@example.com") == "unit@example.com"

    def test_placeholder_falls_back(self):
        assert deliverable_recipient("u101@condo.insure", "tenant@example.com") == "tenant@example.com"

    def test_bounced_falls_back(self):
        assert deliverable_recipient("Bad@Example.com", "t@example.com",
                                     bounced={"bad@example.com"}) == "t@example.com"

    def test_nobody(self):
        assert deliverable_recipient(None, "  ", "x@condo.insure") is None

    def test_alert_recipient_delegates(self):
        from scripts.run_alerts import _alert_recipient
        row = {"email_primary": "p@condo.insure", "tenant_email": "t@example.com"}
        assert _alert_recipient(row) == "t@example.com"


class TestTrialCountdown:
    ENDS = datetime(2026, 10, 6, 15, 0, tzinfo=timezone.utc)

    def _cd(self, now):
        from routes.billing import trial_countdown
        return trial_countdown(self.ENDS, now=now)

    def test_last_day_is_active_with_zero_days(self):
        # Old floored .days read 0 → "trial ended" all of the final day
        assert self._cd(datetime(2026, 10, 6, 9, 0, tzinfo=timezone.utc)) == (0, True)

    def test_calendar_days_match_email_arithmetic(self):
        # trial_ends_at::date - CURRENT_DATE = 1 the day before, even late in the day
        assert self._cd(datetime(2026, 10, 5, 20, 0, tzinfo=timezone.utc)) == (1, True)
        assert self._cd(datetime(2026, 9, 22, 20, 0, tzinfo=timezone.utc)) == (14, True)

    def test_after_end(self):
        assert self._cd(datetime(2026, 10, 6, 16, 0, tzinfo=timezone.utc)) == (0, False)
        assert self._cd(datetime(2026, 10, 9, tzinfo=timezone.utc)) == (0, False)

    def test_no_trial(self):
        from routes.billing import trial_countdown
        assert trial_countdown(None) == (None, False)

    def test_trial_email_day_zero_says_today(self):
        subject, _ = email_mod.trial_ending_html("X", 0, date(2026, 10, 6), "u")
        assert "ends today" in subject


class TestQuoteLinks:
    def test_utm_tags(self):
        url = quote_link("lapsed")
        assert url.startswith(email_mod.QUOTE_FORM_URL + "?")
        assert "utm_source=condo.insure" in url and "utm_medium=email" in url
        assert "utm_campaign=lapsed" in url

    def test_renter_uses_ho4_page(self):
        assert quote_link("invite", is_renter=True).startswith(email_mod.HO4_QUOTE_URL)

    @pytest.mark.parametrize("fn,args,campaign", [
        ("renewal_reminder_html", ("101", "H", "p", date(2026, 1, 1), 30), "renewal_30"),
        ("renewal_reminder_html", ("101", "H", "p", date(2026, 1, 1), 7), "renewal_7"),
        ("expired_email_html", ("101", "H", "p", date(2026, 1, 1)), "lapsed"),
        ("noncompliant_email_html", ("101", "H", "p"), "non_compliant"),
        ("invite_email_html", ("e@x.com", "101", "H", "u"), "invite"),
        ("admin_notify_html", ("Pat", "101", "H"), "admin_notify"),
    ])
    def test_every_quote_link_is_tagged(self, fn, args, campaign):
        _, html = getattr(email_mod, fn)(*args)
        assert f"utm_campaign={campaign}" in html
        # no untagged agency links left in the template
        for chunk in html.split('href="')[1:]:
            href = chunk.split('"', 1)[0]
            if "universalcondo.com" in href:
                assert "utm_source=condo.insure" in href, href


class _Balance(HTMLParser):
    VOID = {"br", "hr", "img", "meta", "input"}

    def __init__(self):
        super().__init__()
        self.stack, self.errors = [], []

    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.errors.append(tag)


def _sample_args(fn):
    kw = {}
    for name, p in inspect.signature(fn).parameters.items():
        if p.default is not inspect.Parameter.empty:
            continue
        if any(k in name for k in ("date", "ends_at", "lease_end")):
            kw[name] = date(2026, 1, 1)
        elif "days" in name or name in ("total_units", "compliant", "expiring", "lapsed", "missing"):
            kw[name] = 3
        elif "list" in name:
            kw[name] = [{"unit_number": "1", "tenant_name": "A", "status": "Lapsed"}]
        else:
            kw[name] = "x"
    return kw


@pytest.mark.parametrize("name", sorted(
    n for n, f in inspect.getmembers(email_mod, inspect.isfunction)
    if n.endswith("_html") and not n.startswith("_")))
def test_email_template_tags_balance(name):
    fn = getattr(email_mod, name)
    out = fn(**_sample_args(fn))
    html = out[1] if isinstance(out, tuple) else out
    p = _Balance()
    p.feed(html)
    assert not p.errors and not p.stack, (p.errors, p.stack)
