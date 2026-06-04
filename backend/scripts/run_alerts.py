"""
Alert job: checks policies expiring within 30 days or already lapsed,
updates their status, and sends email via Resend.
Run standalone:  python scripts/run_alerts.py
Called by route: POST /alerts/run
"""
import asyncio
import os
from datetime import date, timedelta

import asyncpg
import httpx

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@db:5432/lapseguard")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "alerts@lapseguard.io")


def _email_html(tenant_name: str, unit_number: str, hoa_name: str, expiration_date, status: str) -> str:
    exp_str = expiration_date.isoformat() if expiration_date else "N/A"
    if status == "lapsed":
        subject_line = "Your insurance policy has lapsed"
        body_line = f"Your policy expired on <strong>{exp_str}</strong>. Please upload a current policy immediately."
    else:
        subject_line = "Your insurance policy is expiring soon"
        body_line = f"Your policy expires on <strong>{exp_str}</strong>. Please renew and upload your updated policy."

    return f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1e40af">LapseGuard Insurance Alert</h2>
      <p>Hi {tenant_name},</p>
      <p>{body_line}</p>
      <p><strong>Unit:</strong> {unit_number}<br>
         <strong>HOA:</strong> {hoa_name}</p>
      <p>Log in to your LapseGuard tenant dashboard to upload your proof of insurance.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="color:#6b7280;font-size:12px">LapseGuard — HOA Insurance Compliance</p>
    </body></html>
    """


async def send_email(to_email: str, subject: str, html: str) -> bool:
    if not RESEND_API_KEY:
        print(f"[alerts] RESEND_API_KEY not set — skipping email to {to_email}")
        return False
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={"from": FROM_EMAIL, "to": [to_email], "subject": subject, "html": html},
        )
        return resp.status_code == 200


async def process_alerts(conn: asyncpg.Connection) -> int:
    today = date.today()
    threshold = today + timedelta(days=30)

    rows = await conn.fetch(
        """
        SELECT
            p.id AS policy_id,
            p.tenant_id,
            p.expiration_date,
            p.status,
            t.name AS tenant_name,
            t.email AS tenant_email,
            u.unit_number,
            h.name AS hoa_name
        FROM policies p
        JOIN tenants t ON t.id = p.tenant_id
        JOIN units u ON u.id = t.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE p.expiration_date <= $1 OR p.status = 'missing'
        """,
        threshold,
    )

    count = 0
    for row in rows:
        exp = row["expiration_date"]
        if exp is not None and exp < today:
            new_status = "lapsed"
        elif exp is not None and exp <= threshold:
            new_status = "expiring"
        else:
            new_status = row["status"]

        await conn.execute(
            "UPDATE policies SET status = $1 WHERE id = $2",
            new_status,
            row["policy_id"],
        )

        if new_status in ("lapsed", "expiring"):
            subject = (
                "Your insurance policy has lapsed"
                if new_status == "lapsed"
                else "Your insurance policy is expiring soon"
            )
            html = _email_html(
                row["tenant_name"],
                row["unit_number"],
                row["hoa_name"],
                row["expiration_date"],
                new_status,
            )
            sent = await send_email(row["tenant_email"], subject, html)
            if sent:
                await conn.execute(
                    "INSERT INTO alert_log (tenant_id, alert_type) VALUES ($1, $2)",
                    row["tenant_id"],
                    new_status,
                )
                count += 1
                print(f"[alerts] Sent {new_status} alert to {row['tenant_email']}")

    return count


async def main():
    pool = await asyncpg.create_pool(DATABASE_URL)
    async with pool.acquire() as conn:
        count = await process_alerts(conn)
    await pool.close()
    print(f"[alerts] Done. {count} alerts sent.")


if __name__ == "__main__":
    asyncio.run(main())
