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
    is_owner), or None if they haven't been attached to one yet."""
    return await conn.fetchrow(
        """SELECT f.id, f.name, f.stripe_customer_id, m.is_owner
           FROM pm_firm_members m JOIN pm_firms f ON f.id = m.firm_id
           WHERE m.supabase_user_id = $1""",
        user_id,
    )


async def firm_manages_hoa(conn: asyncpg.Connection, user_id: str, hoa_id: str) -> bool:
    """Does this PM login's firm manage the given association?"""
    return bool(await conn.fetchval(
        """SELECT 1 FROM pm_firm_members m
           JOIN pm_firm_hoas fh ON fh.firm_id = m.firm_id
           WHERE m.supabase_user_id = $1 AND fh.hoa_id = $2""",
        user_id, hoa_id,
    ))


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
