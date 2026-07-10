from fastapi import APIRouter, Depends, HTTPException, Header
import asyncpg
import hmac
import os

from models.db import get_conn

router = APIRouter()

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
    count = await process_alerts(conn)
    reminders = await process_invite_reminders(conn)
    noncompliant = await process_noncompliant_reminders(conn)
    lease = await process_lease_alerts(conn)
    trials = await process_trial_reminders(conn)
    billing = await process_billing_sync(conn)
    return {
        "alerts_sent": count,
        "invite_reminders_sent": reminders,
        "noncompliant_reminders_sent": noncompliant,
        "lease_reminders_sent": lease,
        "trial_reminders_sent": trials,
        "billing_sync": billing,
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
    from services.audit import log_audit
    from services.email import send_email

    hoas = await conn.fetch("SELECT id FROM hoas WHERE admin_email IS NOT NULL AND admin_email != ''")
    sent = 0
    for h in hoas:
        hoa_id = str(h["id"])
        report = await build_board_report(conn, hoa_id)
        if not report or not report["to_email"]:
            continue
        if await send_email(report["to_email"], report["subject"], report["html"]):
            await log_audit(conn, hoa_id, None, "system", "board_report_sent",
                            {"to": report["to_email"], "trigger": "cron"})
            sent += 1
    return {"reports_sent": sent}
