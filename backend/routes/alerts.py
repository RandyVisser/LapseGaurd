from fastapi import APIRouter, Depends, HTTPException, Header
import asyncpg
import os

from models.db import get_conn

router = APIRouter()

INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "dev-internal-key")


@router.post("/alerts/run")
async def run_alerts(
    x_api_key: str | None = Header(default=None),
    conn: asyncpg.Connection = Depends(get_conn),
):
    if x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Delegate actual work to the alert script logic — this endpoint is a thin wrapper
    # so Railway cron can hit it via HTTP instead of running a subprocess
    from scripts.run_alerts import process_alerts
    count = await process_alerts(conn)
    return {"alerts_sent": count}
