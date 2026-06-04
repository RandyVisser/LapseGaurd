"""
Alert job: checks policies expiring within 30 days or already lapsed,
updates their status, and sends email via Resend.
Run standalone:  python scripts/run_alerts.py
Called by route: POST /alerts/run
"""
import asyncio
import os
import sys
from datetime import date, timedelta

import asyncpg

# Allow running as a standalone script from the backend/ directory
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.email import send_email, renewal_notice_html

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@db:5432/lapseguard")


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
            subject, html = renewal_notice_html(
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
