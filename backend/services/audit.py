import json
import asyncpg


async def log_audit(
    conn: asyncpg.Connection,
    hoa_id: str | None,
    user_sub: str | None,
    user_email: str | None,
    action: str,
    details: dict | None = None,
) -> None:
    try:
        await conn.execute(
            """INSERT INTO admin_audit_log (hoa_id, user_id, user_email, action, details)
               VALUES ($1, $2, $3, $4, $5)""",
            hoa_id,
            user_sub,
            user_email,
            action,
            json.dumps(details or {}),
        )
    except Exception:
        pass
