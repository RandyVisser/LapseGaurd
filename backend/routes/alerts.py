from fastapi import APIRouter, Depends, HTTPException, Header
import asyncpg
import hmac
import logging
import os

import sentry_sdk

from models.db import get_conn

router = APIRouter()
logger = logging.getLogger(__name__)

INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")


@router.post("/alerts/run")
async def run_alerts(
    x_api_key: str | None = Header(default=None),
    conn: asyncpg.Connection = Depends(get_conn),
):
    if not INTERNAL_API_KEY or not x_api_key or not hmac.compare_digest(x_api_key, INTERNAL_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Delegate actual work to the alert script logic — this endpoint is a thin
    # wrapper so the scheduled GitHub Actions workflow can hit it via HTTP.
    # KEEP IN SYNC with scripts/run_alerts.py main(): a processor added only
    # there never runs in production (the script isn't what the cron executes).
    from scripts.run_alerts import (
        process_alerts, process_invite_reminders, process_noncompliant_reminders,
        process_lease_alerts, process_trial_reminders, process_billing_sync,
    )
    # Each processor is isolated: one blowing up (a bad row, a Resend outage,
    # a Stripe hiccup) must not silently skip every processor after it. The
    # failure is logged + sent to Sentry and reported in the response.
    errors: dict[str, str] = {}

    async def _isolated(name, coro, fallback=0):
        try:
            return await coro
        except Exception as e:  # noqa: BLE001 — deliberate: keep the run going
            logger.warning("alerts/run: processor %s failed: %s", name, e)
            sentry_sdk.capture_exception(e)
            errors[name] = f"{type(e).__name__}: {e}"
            return fallback

    count = await _isolated("alerts", process_alerts(conn))
    reminders = await _isolated("invite_reminders", process_invite_reminders(conn))
    noncompliant = await _isolated("noncompliant_reminders", process_noncompliant_reminders(conn))
    lease = await _isolated("lease_alerts", process_lease_alerts(conn))
    trials = await _isolated("trial_reminders", process_trial_reminders(conn))
    billing = await _isolated("billing_sync", process_billing_sync(conn), fallback={"error": "failed"})
    return {
        "alerts_sent": count,
        "invite_reminders_sent": reminders,
        "noncompliant_reminders_sent": noncompliant,
        "lease_reminders_sent": lease,
        "trial_reminders_sent": trials,
        "billing_sync": billing,
        "errors": errors,
    }


@router.post("/reports/board/run")
async def run_board_reports(
    x_api_key: str | None = Header(default=None),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Send the compliance board report to every HOA's admin email.
    Hit by Railway cron (monthly) with the internal API key."""
    if not INTERNAL_API_KEY or not x_api_key or not hmac.compare_digest(x_api_key, INTERNAL_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key")

    from routes.hoa import build_board_report
    from scripts.run_alerts import _bounced_emails
    from services.audit import log_audit
    from services.email import send_email

    hoas = await conn.fetch("SELECT id FROM hoas WHERE admin_email IS NOT NULL AND admin_email != ''")
    # Same guards as the firm-triggered send (pm_team.py): a re-run of the
    # monthly workflow must not double-mail boards, and bounced addresses are
    # never mailed again.
    recent = await conn.fetch(
        """SELECT DISTINCT hoa_id FROM admin_audit_log
           WHERE action = 'board_report_sent'
             AND created_at > now() - interval '20 hours'""",
    )
    recently_sent = {str(r["hoa_id"]) for r in recent}
    bounced = await _bounced_emails(conn)

    sent = skipped = 0
    inactive = 0
    for h in hoas:
        hoa_id = str(h["id"])
        if hoa_id in recently_sent:
            skipped += 1
            continue
        report = await build_board_report(conn, hoa_id)
        if not report or not report["to_email"]:
            continue
        if not report["has_activity"]:
            # No invites sent and no policies on file: a "0% compliant" report
            # tells the board the tool does nothing when it simply hasn't been
            # started. Skip (logged) until the association has activity.
            logger.info("board report skipped for hoa %s — no invites sent and no policies on file", hoa_id)
            await log_audit(conn, hoa_id, None, "system", "board_report_skipped",
                            {"reason": "no_activity", "trigger": "cron"})
            inactive += 1
            continue
        if report["to_email"].strip().lower() in bounced:
            skipped += 1
            continue
        if await send_email(report["to_email"], report["subject"], report["html"]):
            await log_audit(conn, hoa_id, None, "system", "board_report_sent",
                            {"to": report["to_email"], "trigger": "cron"})
            sent += 1
    return {"reports_sent": sent, "skipped": skipped, "skipped_no_activity": inactive}
