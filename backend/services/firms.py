"""PM firm resolution — the one place that answers "which firm is this
property-manager login part of, and which associations does that firm manage?"

A firm is the real customer for the PM business: members (logins) come and go,
associations get added over time, and the consolidated Stripe subscription
belongs to the firm, not to whichever employee clicked Subscribe. One firm per
login for now (pm_firm_members.supabase_user_id is UNIQUE).
"""
import asyncpg


async def user_firm(conn: asyncpg.Connection, user_id: str):
    """The firm this PM login belongs to (id, name, stripe_customer_id,
    open_visibility, cab_number, is_owner), or None if they haven't been
    attached to one yet."""
    return await conn.fetchrow(
        """SELECT f.id, f.name, f.stripe_customer_id, f.open_visibility,
                  f.cab_number, m.is_owner
           FROM pm_firm_members m JOIN pm_firms f ON f.id = m.firm_id
           WHERE m.supabase_user_id = $1""",
        user_id,
    )


async def firm_manages_hoa(conn: asyncpg.Connection, user_id: str, hoa_id: str) -> bool:
    """May this PM login access the given association? The firm must manage it,
    AND the member must be able to see it: in an open-visibility firm every
    member sees the whole portfolio; otherwise only owners and members
    assigned to the association (pm_member_hoas)."""
    return bool(await conn.fetchval(
        """SELECT 1 FROM pm_firm_members m
           JOIN pm_firms f ON f.id = m.firm_id
           JOIN pm_firm_hoas fh ON fh.firm_id = m.firm_id AND fh.hoa_id = $2
           WHERE m.supabase_user_id = $1
             AND (f.open_visibility OR m.is_owner
                  OR EXISTS (SELECT 1 FROM pm_member_hoas a
                             WHERE a.supabase_user_id = m.supabase_user_id
                               AND a.hoa_id = fh.hoa_id))""",
        user_id, hoa_id,
    ))


# SQL fragment for listing queries: which hoa ids this PM login may see.
# Mirrors firm_manages_hoa; parameter $1 (or the given index) is the user id.
def visible_hoas_sql(user_param: str = "$1") -> str:
    return f"""SELECT fh.hoa_id FROM pm_firm_members m
               JOIN pm_firms f ON f.id = m.firm_id
               JOIN pm_firm_hoas fh ON fh.firm_id = m.firm_id
               WHERE m.supabase_user_id = {user_param}
                 AND (f.open_visibility OR m.is_owner
                      OR EXISTS (SELECT 1 FROM pm_member_hoas a
                                 WHERE a.supabase_user_id = m.supabase_user_id
                                   AND a.hoa_id = fh.hoa_id))"""


async def ensure_firm(conn: asyncpg.Connection, user_id: str, fallback_name: str) -> str:
    """Return the user's firm id, creating a single-owner firm (named after
    their email until they rename it) if they don't have one yet."""
    row = await user_firm(conn, user_id)
    if row:
        return row["id"]
    firm_id = await conn.fetchval(
        "INSERT INTO pm_firms (name) VALUES ($1) RETURNING id", fallback_name,
    )
    await conn.execute(
        "INSERT INTO pm_firm_members (firm_id, supabase_user_id, is_owner) VALUES ($1, $2, true)",
        firm_id, user_id,
    )
    return firm_id


async def map_hoa_to_firm(conn: asyncpg.Connection, firm_id: str, hoa_id: str) -> None:
    await conn.execute(
        "INSERT INTO pm_firm_hoas (firm_id, hoa_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        firm_id, hoa_id,
    )


async def assign_member_hoa(conn: asyncpg.Connection, firm_id: str, user_id: str, hoa_id: str) -> None:
    """Assign a member to an association (no-op in open-visibility firms'
    behavior, but recorded regardless so flipping to assignment mode later
    starts from an accurate picture)."""
    await conn.execute(
        "INSERT INTO pm_member_hoas (firm_id, supabase_user_id, hoa_id) VALUES ($1, $2::uuid, $3) "
        "ON CONFLICT DO NOTHING",
        firm_id, user_id, hoa_id,
    )
