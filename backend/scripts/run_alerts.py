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

from services.email import send_email, renewal_notice_html, invite_email_html, admin_notify_html

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@db:5432/lapseguard")
APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")

# SQL expression (for a query joined on `hoas h`) resolving the email reply-to
# contact the association chose: a specific PM, the first PM, or the President.
# The chosen sender unit: a specifically selected PM/board member, else first PM
_SENDER_UNIT_SQL = """COALESCE(h.email_sender_unit_id,
   (SELECT id FROM units WHERE hoa_id = h.id
      AND lower(coalesce(assoc_title,'')) = 'property manager' LIMIT 1))"""

_SENDER_EMAIL_SQL = """(SELECT su.email_primary FROM units su WHERE su.id = """ + _SENDER_UNIT_SQL + """)"""


async def process_invite_reminders(conn: asyncpg.Connection) -> int:
    """Re-send pending invites to unit owners who haven't accepted yet, spaced by
    each association's invite_reminder_days (default 7). Runs every cron tick;
    an invite is re-sent only once its last send is older than that window."""
    rows = await conn.fetch(
        """
        SELECT i.token, i.email, u.unit_number, u.assoc_title,
               u.owner_primary, u.owner_secondary, u.email_primary, u.email_secondary,
               h.name AS hoa_name,
               """ + _SENDER_EMAIL_SQL + """ AS sender_email,
               (SELECT su.owner_primary FROM units su WHERE su.id = """ + _SENDER_UNIT_SQL + """) AS sender_name,
               (SELECT su.assoc_title FROM units su WHERE su.id = """ + _SENDER_UNIT_SQL + """) AS sender_title,
               COALESCE(h.corp_name,
                 (SELECT corp_name FROM units WHERE hoa_id = h.id AND corp_name IS NOT NULL LIMIT 1),
                 h.name) AS corp_name
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
        em = (row["email"] or "").strip().lower()
        recipient_name = row.get("owner_secondary") if em and em == (row.get("email_secondary") or "").strip().lower() else row.get("owner_primary")
        subject, html = invite_email_html(
            row["email"], row["unit_number"], row["hoa_name"], invite_url,
            is_property_manager=is_pm, sender_email=row.get("sender_email"),
            recipient_name=recipient_name,
            corp_name=row.get("corp_name"), sender_name=row.get("sender_name"),
            sender_title=row.get("sender_title"),
        )
        sent = await send_email(row["email"], subject, html, reply_to=row.get("sender_email"))
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
            COALESCE(h.alert_lead_days, 30) AS alert_lead_days,
            COALESCE(h.alert_days, '{30,7,1}') AS alert_days,
            COALESCE(h.alerts_enabled, TRUE) AS alerts_enabled,
            COALESCE(h.lapsed_reminders_enabled, TRUE) AS lapsed_reminders_enabled,
            COALESCE(h.lapsed_reminder_days, 7) AS lapsed_reminder_days,
            """ + _SENDER_EMAIL_SQL + """ AS sender_email
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
        days_until = (exp - today).days
        threshold = today + timedelta(days=row["alert_lead_days"])
        milestones = sorted({int(d) for d in (row["alert_days"] or [])}, reverse=True)

        # Lapsed always wins; "expiring" only upgrades an active policy so we
        # never stomp non_compliant / pending_review set by AI validation
        if exp < today:
            new_status = "lapsed"
        elif exp <= threshold:
            new_status = "expiring" if row["status"] == "active" else row["status"]
        else:
            new_status = row["status"]

        if new_status != row["status"]:
            await conn.execute(
                "UPDATE policies SET status = $1 WHERE id = $2",
                new_status, row["policy_id"],
            )

        # Pick which reminder/lapse milestone applies right now
        if days_until < 0:
            if not row["lapsed_reminders_enabled"]:
                continue
            # Repeat the lapse notice every N days until the owner responds; a
            # fresh policy upload supersedes this one, which ends the reminders
            alert_type, throttle_days = "lapsed", row["lapsed_reminder_days"]
        else:
            # Renewal reminders are independent of the lapsed/non-compliant toggles
            if not row["alerts_enabled"]:
                continue
            # smallest enabled milestone that the policy has crossed into
            applicable = min((m for m in milestones if m >= days_until), default=None)
            if applicable is None:
                continue
            alert_type, throttle_days = f"renewal_{applicable}", applicable + 1

        already_sent = await conn.fetchval(
            f"""
            SELECT 1 FROM alert_log
            WHERE tenant_id = $1 AND alert_type = $2
              AND sent_at > NOW() - INTERVAL '{throttle_days} days'
            LIMIT 1
            """,
            row["tenant_id"], alert_type,
        )
        if already_sent:
            continue

        # The email template distinguishes lapsed vs upcoming
        template_kind = "lapsed" if alert_type == "lapsed" else "expiring"
        subject, html = renewal_notice_html(
            row["tenant_name"], row["unit_number"], row["hoa_name"],
            row["expiration_date"], template_kind,
        )
        sent = await send_email(row["tenant_email"], subject, html, reply_to=row.get("sender_email"))
        if sent:
            await conn.execute(
                "INSERT INTO alert_log (tenant_id, alert_type) VALUES ($1, $2)",
                row["tenant_id"], alert_type,
            )
            count += 1
            print(f"[alerts] Sent {alert_type} alert to {row['tenant_email']}")

    return count


async def process_noncompliant_reminders(conn: asyncpg.Connection) -> int:
    """Remind owners whose policy is on file but doesn't meet the association's
    requirements (Active · Non-Compliant), spaced by noncompliant_reminder_days,
    until the policy is corrected (status changes off non_compliant)."""
    rows = await conn.fetch(
        """
        SELECT p.tenant_id, t.name AS tenant_name, t.email AS tenant_email,
               u.unit_number, h.name AS hoa_name,
               COALESCE(h.noncompliant_reminder_days, 7) AS days,
               """ + _SENDER_EMAIL_SQL + """ AS sender_email
        FROM policies p
        JOIN tenants t ON t.id = p.tenant_id
        JOIN units u ON u.id = t.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE p.status = 'non_compliant'
          AND p.superseded_by IS NULL
          AND COALESCE(h.noncompliant_reminders_enabled, TRUE) = TRUE
          AND t.email IS NOT NULL
        """,
    )
    count = 0
    for row in rows:
        already = await conn.fetchval(
            f"""SELECT 1 FROM alert_log
                WHERE tenant_id = $1 AND alert_type = 'non_compliant'
                  AND sent_at > NOW() - INTERVAL '{int(row['days'])} days' LIMIT 1""",
            row["tenant_id"],
        )
        if already:
            continue
        subject, html = admin_notify_html(
            row["tenant_name"], row["unit_number"], row["hoa_name"],
            "Your policy is on file but does not currently meet your association's "
            "insurance requirements. Please upload an updated policy so your unit "
            "shows as compliant.",
        )
        if await send_email(row["tenant_email"], subject, html, reply_to=row.get("sender_email")):
            await conn.execute(
                "INSERT INTO alert_log (tenant_id, alert_type) VALUES ($1, 'non_compliant')",
                row["tenant_id"],
            )
            count += 1
            print(f"[alerts] Sent non-compliant reminder to {row['tenant_email']}")
    return count


async def main():
    pool = await asyncpg.create_pool(DATABASE_URL)
    async with pool.acquire() as conn:
        count = await process_alerts(conn)
        reminders = await process_invite_reminders(conn)
        noncompliant = await process_noncompliant_reminders(conn)
    await pool.close()
    print(f"[alerts] Done. {count} alerts, {reminders} invite reminders, {noncompliant} non-compliant reminders sent.")


if __name__ == "__main__":
    asyncio.run(main())
