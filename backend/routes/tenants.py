from fastapi import APIRouter, Depends, HTTPException
import asyncpg

from models.db import get_conn
from auth.jwt import AuthUser, get_current_user

router = APIRouter()


@router.get("/tenant/me")
async def get_my_tenant(
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    row = await conn.fetchrow(
        """
        SELECT t.id, t.unit_id, t.name, t.email, u.hoa_id
        FROM tenants t
        JOIN units u ON u.id = t.unit_id
        WHERE t.supabase_user_id = $1 OR t.email = $2
        ORDER BY t.supabase_user_id NULLS LAST
        LIMIT 1
        """,
        user.sub,
        user.email,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tenant profile not found")
    return {
        "tenant_id": str(row["id"]),
        "unit_id": str(row["unit_id"]),
        "hoa_id": str(row["hoa_id"]),
        "name": row["name"],
        "email": row["email"],
    }
