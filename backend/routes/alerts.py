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

    # Delegate actual work to the alert script logic — this endpoint is a thin wrapper
    # so Railway cron can hit it via HTTP instead of running a subprocess
    from scripts.run_alerts import process_alerts
    count = await process_alerts(conn)
    return {"alerts_sent": count}


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
