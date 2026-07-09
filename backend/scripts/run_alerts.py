"""
Alert job: checks policies expiring within each HOA's configured lead window or already lapsed,
updates their status, and sends email via Resend.
Run standalone:  python scripts/run_alerts.py
Called by route: POST /alerts/run
"""
import asyncio
import json
import os
import sys
from datetime import date, timedelta

import asyncpg

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.email import send_email, renewal_notice_html, renewal_reminder_html, expired_email_html, invite_email_html, admin_notify_html, noncompliant_email_html, lease_expiration_html, trial_ending_html, format_address

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@db:5432/lapseguard")
APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")

# SQL expression (for a query joined on `hoas h`) resolving the email reply-to
# contact the association chose: a specific PM, the first PM, or the President.
# The chosen sender unit: a specifically selected PM/board member, else first PM
_SENDER_UNIT_SQL = """COALESCE(h.email_sender_unit_id,
   (SELECT id FROM units WHERE hoa_id = h.id
      AND lower(coalesce(assoc_title,'')) = 'property manager' LIMIT 1))"""

_SENDER_EMAIL_SQL = """(SELECT su.email_primary FROM units su WHERE su.id = """ + _SENDER_UNIT_SQL + """)"""


def _alert_recipient(row) -> str | None:
    """Send to the owner at the email the admin manages on the dashboard
    (units.email_primary), falling back to the tenant record's email. Skips
    placeholder @condo.insure addresses (no real inbox)."""
    for addr in (row.get("email_primary"), row.get("tenant_email")):
        a = (addr or "").strip()
        if a and not a.lower().endswith("@condo.insure"):
            return a
    return None


async def process_invite_reminders(conn: asyncpg.Connection) -> int:
    """Re-send pending invites to unit owners who haven't accepted yet, spaced by
    each association's invite_reminder_days (default 7). Runs every cron tick;
    an invite is re-sent only once its last send is older than that window."""
    rows = await conn.fetch(
        """
        SELECT i.token, i.email, u.unit_number, u.assoc_title,
               u.owner_primary, u.owner_secondary, u.email_primary, u.email_secondary,
               u.street_address, u.city, u.state, u.zip,
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
            unit_address=format_address(row.get("street_address"), row.get("city"), row.get("state"), row.get("zip")),
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
            (u.parent_unit_id IS NOT NULL) AS is_renter,
            t.name AS tenant_name,
            t.email AS tenant_email,
            u.unit_number, u.owner_primary, u.owner_secondary, u.email_primary, u.email_secondary,
            u.street_address, u.city, u.state, u.zip,
            h.name AS hoa_name,
            COALESCE(h.alert_lead_days, 30) AS alert_lead_days,
            COALESCE(h.alert_days, '{30,7,1}') AS alert_days,
            COALESCE(h.alerts_enabled, TRUE) AS alerts_enabled,
            COALESCE(h.lapsed_reminders_enabled, TRUE) AS lapsed_reminders_enabled,
            COALESCE(h.lapsed_reminder_days, 7) AS lapsed_reminder_days,
            """ + _SENDER_EMAIL_SQL + """ AS sender_email,
            (SELECT su.owner_primary FROM units su WHERE su.id = """ + _SENDER_UNIT_SQL + """) AS sender_name,
            (SELECT su.assoc_title FROM units su WHERE su.id = """ + _SENDER_UNIT_SQL + """) AS sender_title,
            COALESCE(h.corp_name,
              (SELECT corp_name FROM units WHERE hoa_id = h.id AND corp_name IS NOT NULL LIMIT 1),
              h.name) AS corp_name
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

        recipient = _alert_recipient(row)
        if not recipient:
            continue
        em = recipient.lower()
        recipient_name = row.get("owner_secondary") if em and em == (row.get("email_secondary") or "").strip().lower() else (row.get("owner_primary") or row["tenant_name"])
        if alert_type == "lapsed":
            subject, html = expired_email_html(
                row["unit_number"], row["hoa_name"], f"{APP_URL}/tenant/dashboard",
                row["expiration_date"], reminder_days=row["lapsed_reminder_days"],
                recipient_name=recipient_name, sender_email=row.get("sender_email"),
                corp_name=row.get("corp_name"), sender_name=row.get("sender_name"),
                sender_title=row.get("sender_title"),
                unit_address=format_address(row.get("street_address"), row.get("city"), row.get("state"), row.get("zip")),
                is_renter=row.get("is_renter") or False,
            )
        else:
            subject, html = renewal_reminder_html(
                row["unit_number"], row["hoa_name"], f"{APP_URL}/tenant/dashboard",
                row["expiration_date"], days_until,
                recipient_name=recipient_name, sender_email=row.get("sender_email"),
                corp_name=row.get("corp_name"), sender_name=row.get("sender_name"),
                sender_title=row.get("sender_title"),
                unit_address=format_address(row.get("street_address"), row.get("city"), row.get("state"), row.get("zip")),
                is_renter=row.get("is_renter") or False,
            )
        sent = await send_email(recipient, subject, html, reply_to=row.get("sender_email"))
        if sent:
            await conn.execute(
                "INSERT INTO alert_log (tenant_id, alert_type) VALUES ($1, $2)",
                row["tenant_id"], alert_type,
            )
            count += 1
            print(f"[alerts] Sent {alert_type} alert to {recipient}")

    return count


async def process_lease_alerts(conn: asyncpg.Connection) -> int:
    """Remind the OWNER of a rented unit that the lease on file is expiring (using
    the association's 30/7/1 milestones) or has expired, so they upload a renewal.
    Throttled per owner-tenant/type via alert_log, like the policy reminders."""
    today = date.today()
    rows = await conn.fetch(
        r"""
        SELECT u.id AS unit_id, u.unit_number, u.email_primary, u.email_secondary,
               u.owner_primary, u.owner_secondary,
               u.street_address, u.city, u.state, u.zip,
               (u.lease_extracted->>'lease_end')::date AS lease_end,
               ot.id AS owner_tenant_id, ot.email AS owner_tenant_email, ot.name AS owner_tenant_name,
               h.name AS hoa_name,
               COALESCE(h.alert_lead_days, 30) AS alert_lead_days,
               COALESCE(h.alert_days, '{30,7,1}') AS alert_days,
               COALESCE(h.alerts_enabled, TRUE) AS alerts_enabled,
               COALESCE(h.lapsed_reminder_days, 7) AS lapsed_reminder_days,
               """ + _SENDER_EMAIL_SQL + """ AS sender_email,
               (SELECT su.owner_primary FROM units su WHERE su.id = """ + _SENDER_UNIT_SQL + """) AS sender_name,
               (SELECT su.assoc_title FROM units su WHERE su.id = """ + _SENDER_UNIT_SQL + """) AS sender_title,
               COALESCE(h.corp_name,
                 (SELECT corp_name FROM units WHERE hoa_id = h.id AND corp_name IS NOT NULL LIMIT 1),
                 h.name) AS corp_name
        FROM units u
        JOIN hoas h ON h.id = u.hoa_id
        LEFT JOIN tenants ot ON ot.unit_id = u.id
        WHERE u.is_rental AND u.parent_unit_id IS NULL
          AND u.lease_extracted->>'lease_end' ~ '^\d{4}-\d{2}-\d{2}$'
          AND (u.lease_extracted->>'lease_end')::date
              <= CURRENT_DATE + (COALESCE(h.alert_lead_days, 30) * INTERVAL '1 day')
        """,
    )
    count = 0
    for row in rows:
        if not row["alerts_enabled"] or not row["owner_tenant_id"]:
            continue  # need a tenant_id to throttle via alert_log

        # Notify the owner at a real address (skip placeholder @condo.insure)
        def _real(addr):
            a = (addr or "").strip()
            return a if a and not a.lower().endswith("@condo.insure") else ""
        recipient = _real(row["email_primary"]) or _real(row["owner_tenant_email"])
        if not recipient:
            continue

        lease_end = row["lease_end"]
        days_until = (lease_end - today).days
        milestones = sorted({int(d) for d in (row["alert_days"] or [])}, reverse=True)
        if days_until < 0:
            alert_type, throttle_days, expired = "lease_expired", row["lapsed_reminder_days"], True
        else:
            applicable = min((m for m in milestones if m >= days_until), default=None)
            if applicable is None:
                continue
            alert_type, throttle_days, expired = f"lease_renewal_{applicable}", applicable + 1, False

        already = await conn.fetchval(
            f"""SELECT 1 FROM alert_log WHERE tenant_id = $1 AND alert_type = $2
                AND sent_at > NOW() - INTERVAL '{throttle_days} days' LIMIT 1""",
            row["owner_tenant_id"], alert_type,
        )
        if already:
            continue

        recipient_name = row["owner_primary"] or row["owner_tenant_name"]
        subject, html = lease_expiration_html(
            row["unit_number"], row["hoa_name"], f"{APP_URL}/tenant/dashboard",
            lease_end, days_until, recipient_name=recipient_name,
            sender_email=row.get("sender_email"), corp_name=row.get("corp_name"),
            sender_name=row.get("sender_name"), sender_title=row.get("sender_title"),
            unit_address=format_address(row.get("street_address"), row.get("city"), row.get("state"), row.get("zip")),
            expired=expired,
        )
        if await send_email(recipient, subject, html, reply_to=row.get("sender_email")):
            await conn.execute(
                "INSERT INTO alert_log (tenant_id, alert_type) VALUES ($1, $2)",
                row["owner_tenant_id"], alert_type,
            )
            count += 1
            print(f"[alerts] Sent {alert_type} to {recipient}")
    return count


async def process_noncompliant_reminders(conn: asyncpg.Connection) -> int:
    """Remind owners whose policy is on file but doesn't meet the association's
    requirements (Active · Non-Compliant), spaced by noncompliant_reminder_days,
    until the policy is corrected (status changes off non_compliant)."""
    rows = await conn.fetch(
        """
        SELECT p.tenant_id, p.extracted_data, (u.parent_unit_id IS NOT NULL) AS is_renter,
               t.name AS tenant_name, t.email AS tenant_email,
               u.unit_number, u.owner_primary, u.owner_secondary, u.email_primary, u.email_secondary,
               u.street_address, u.city, u.state, u.zip, h.name AS hoa_name,
               COALESCE(h.noncompliant_reminder_days, 7) AS days,
               """ + _SENDER_EMAIL_SQL + """ AS sender_email,
               (SELECT su.owner_primary FROM units su WHERE su.id = """ + _SENDER_UNIT_SQL + """) AS sender_name,
               (SELECT su.assoc_title FROM units su WHERE su.id = """ + _SENDER_UNIT_SQL + """) AS sender_title,
               COALESCE(h.corp_name,
                 (SELECT corp_name FROM units WHERE hoa_id = h.id AND corp_name IS NOT NULL LIMIT 1),
                 h.name) AS corp_name
        FROM policies p
        JOIN tenants t ON t.id = p.tenant_id
        JOIN units u ON u.id = t.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE p.status = 'non_compliant'
          AND p.superseded_by IS NULL
          AND COALESCE(h.noncompliant_reminders_enabled, TRUE) = TRUE
          AND (t.email IS NOT NULL OR u.email_primary IS NOT NULL)
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
        recipient = _alert_recipient(row)
        if not recipient:
            continue
        em = recipient.lower()
        recipient_name = row.get("owner_secondary") if em and em == (row.get("email_secondary") or "").strip().lower() else (row.get("owner_primary") or row["tenant_name"])
        # Pull the specific failing items from the policy's stored validation
        raw = row.get("extracted_data")
        ext = json.loads(raw) if isinstance(raw, str) else (raw or {})
        items = (ext.get("validation") or {}).get("flags") or []
        subject, html = noncompliant_email_html(
            row["unit_number"], row["hoa_name"], f"{APP_URL}/tenant/dashboard",
            recipient_name=recipient_name, sender_email=row.get("sender_email"),
            corp_name=row.get("corp_name"), sender_name=row.get("sender_name"),
            sender_title=row.get("sender_title"),
            unit_address=format_address(row.get("street_address"), row.get("city"), row.get("state"), row.get("zip")),
            items=items,
            is_renter=row.get("is_renter") or False,
        )
        if await send_email(recipient, subject, html, reply_to=row.get("sender_email")):
            await conn.execute(
                "INSERT INTO alert_log (tenant_id, alert_type) VALUES ($1, 'non_compliant')",
                row["tenant_id"],
            )
            count += 1
            print(f"[alerts] Sent non-compliant reminder to {recipient}")
    return count


async def process_trial_reminders(conn) -> int:
    """Email the association admin as their free trial runs out (14/3/1 days
    before, plus the day it ends). Runs only when BILLING_ENABLED=true in the
    cron service env. Fires on exact day marks, so the daily cadence sends each
    reminder exactly once; associations with a subscription are skipped."""
    if os.environ.get("BILLING_ENABLED", "").lower() != "true":
        return 0
    rows = await conn.fetch(
        """SELECT id, name, admin_email, trial_ends_at,
                  (trial_ends_at::date - CURRENT_DATE) AS days_left
           FROM hoas
           WHERE trial_ends_at IS NOT NULL
             AND stripe_subscription_id IS NULL
             AND coalesce(admin_email, '') <> ''
             AND (trial_ends_at::date - CURRENT_DATE) IN (14, 3, 1, 0)"""
    )
    count = 0
    for row in rows:
        subject, html = trial_ending_html(
            row["name"], int(row["days_left"]), row["trial_ends_at"],
            f"{APP_URL}/admin/settings",
        )
        if await send_email(row["admin_email"], subject, html):
            count += 1
            print(f"[alerts] Sent trial reminder ({row['days_left']}d) to {row['admin_email']} for {row['name']}")
    return count


async def main():
    pool = await asyncpg.create_pool(DATABASE_URL)
    async with pool.acquire() as conn:
        count = await process_alerts(conn)
        reminders = await process_invite_reminders(conn)
        noncompliant = await process_noncompliant_reminders(conn)
        lease = await process_lease_alerts(conn)
        trials = await process_trial_reminders(conn)
    await pool.close()
    print(f"[alerts] Done. {count} alerts, {reminders} invite reminders, "
          f"{noncompliant} non-compliant reminders, {lease} lease reminders, "
          f"{trials} trial reminders sent.")


if __name__ == "__main__":
    asyncio.run(main())
