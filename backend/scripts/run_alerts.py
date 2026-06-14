"""
Alert job: checks policies expiring within each HOA's configured lead window or already lapsed,
updates their status, and sends email via Resend.
Run standalone:  python scripts/run_alerts.py
Called by route: POST /alerts/run
"""
import asyncio
import os
import sys
from datetime import date, timedelta

import asyncpg

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.email import send_email, renewal_notice_html, invite_email_html

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@db:5432/lapseguard")
APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")


async def process_invite_reminders(conn: asyncpg.Connection) -> int:
    """Re-send pending invites to unit owners who haven't accepted yet, spaced by
    each association's invite_reminder_days (default 7). Runs every cron tick;
    an invite is re-sent only once its last send is older than that window."""
    rows = await conn.fetch(
        """
        SELECT i.token, i.email, u.unit_number, u.assoc_title, h.name AS hoa_name
        FROM unit_invites i
        JOIN units u ON u.id = i.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE i.accepted_at IS NULL
          AND i.email IS NOT NULL
          AND COALESCE(h.invite_reminders_enabled, TRUE) = TRUE
          AND COALESCE(i.last_sent_at, i.created_at)
              < NOW() - (COALESCE(h.invite_reminder_days, 7) * INTERVAL '1 day')
        """,
    )
    count = 0
    for row in rows:
        is_pm = (row["assoc_title"] or "").strip().lower() == "property manager"
        invite_url = f"{APP_URL}/join/{row['token']}"
        subject, html = invite_email_html(
            row["email"], row["unit_number"], row["hoa_name"], invite_url, is_property_manager=is_pm
        )
        sent = await send_email(row["email"], subject, html)
        if sent:
            await conn.execute(
                "UPDATE unit_invites SET last_sent_at = NOW() WHERE token = $1", row["token"]
            )
            count += 1
            print(f"[alerts] Re-sent invite to {row['email']} (Unit {row['unit_number']})")
    return count


async def process_alerts(conn: asyncpg.Connection) -> int:
    today = date.today()

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
            h.name AS hoa_name,
            COALESCE(h.alert_lead_days, 30) AS alert_lead_days
        FROM policies p
        JOIN tenants t ON t.id = p.tenant_id
        JOIN units u ON u.id = t.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE p.expiration_date IS NOT NULL
          AND p.superseded_by IS NULL
          AND p.expiration_date <= CURRENT_DATE + (COALESCE(h.alert_lead_days, 30) * INTERVAL '1 day')
        """,
    )

    count = 0
    for row in rows:
        exp = row["expiration_date"]
        threshold = today + timedelta(days=row["alert_lead_days"])

        # Lapsed always wins; "expiring" only upgrades an active policy so we
        # never stomp non_compliant / pending_review set by AI validation
        if exp < today:
            new_status = "lapsed"
            alert_type = "lapsed"
        elif exp <= threshold:
            new_status = "expiring" if row["status"] == "active" else row["status"]
            alert_type = "expiring"
        else:
            new_status = row["status"]
            alert_type = None

        if new_status != row["status"]:
            await conn.execute(
                "UPDATE policies SET status = $1 WHERE id = $2",
                new_status,
                row["policy_id"],
            )

        if alert_type is None:
            continue

        already_sent = await conn.fetchval(
            """
            SELECT 1 FROM alert_log
            WHERE tenant_id = $1 AND alert_type = $2
              AND sent_at > NOW() - INTERVAL '7 days'
            LIMIT 1
            """,
            row["tenant_id"],
            alert_type,
        )
        if already_sent:
            continue

        subject, html = renewal_notice_html(
            row["tenant_name"],
            row["unit_number"],
            row["hoa_name"],
            row["expiration_date"],
            alert_type,
        )
        sent = await send_email(row["tenant_email"], subject, html)
        if sent:
            await conn.execute(
                "INSERT INTO alert_log (tenant_id, alert_type) VALUES ($1, $2)",
                row["tenant_id"],
                alert_type,
            )
            count += 1
            print(f"[alerts] Sent {alert_type} alert to {row['tenant_email']}")

    return count


async def main():
    pool = await asyncpg.create_pool(DATABASE_URL)
    async with pool.acquire() as conn:
        count = await process_alerts(conn)
        reminders = await process_invite_reminders(conn)
    await pool.close()
    print(f"[alerts] Done. {count} alerts sent, {reminders} invite reminders sent.")


if __name__ == "__main__":
    asyncio.run(main())
