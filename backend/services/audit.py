import json
import logging

import asyncpg

logger = logging.getLogger(__name__)


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
        # Best-effort by design (an audit hiccup must never fail the action),
        # but NOT silent: the board-report cooldown reads these rows, so a
        # quietly failing INSERT would fail that guard open. Sentry captures
        # logger.exception.
        logger.exception("audit write failed: %s hoa=%s", action, hoa_id)
