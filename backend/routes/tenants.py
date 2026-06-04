from fastapi import APIRouter, Depends, HTTPException
import asyncpg

from models.db import get_conn
from models.schemas import TenantDetailOut, PolicyOut, PolicyStatus
from auth.jwt import AuthUser, get_current_user, require_hoa_admin

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


@router.get("/tenant/{tenant_id}", response_model=TenantDetailOut)
async def get_tenant_detail(
    tenant_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    row = await conn.fetchrow(
        """
        SELECT t.id, t.unit_id, t.name, t.email, u.unit_number, u.hoa_id
        FROM tenants t
        JOIN units u ON u.id = t.unit_id
        WHERE t.id = $1
        """,
        tenant_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if user.hoa_id and str(row["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")

    policy_rows = await conn.fetch(
        """SELECT * FROM policies WHERE tenant_id = $1
           ORDER BY
               CASE status WHEN 'active' THEN 0 WHEN 'expiring' THEN 1 WHEN 'lapsed' THEN 2 ELSE 3 END,
               expiration_date DESC NULLS LAST,
               uploaded_at DESC""",
        tenant_id,
    )

    policies = [
        PolicyOut(
            id=r["id"],
            tenant_id=r["tenant_id"],
            insurer=r["insurer"],
            policy_number=r["policy_number"],
            expiration_date=r["expiration_date"],
            status=r["status"],
            document_url=r["document_url"],
            uploaded_at=r["uploaded_at"],
            extracted_data=dict(r["extracted_data"]) if r["extracted_data"] else None,
            parsed_at=r["parsed_at"],
        )
        for r in policy_rows
    ]

    return TenantDetailOut(
        tenant_id=row["id"],
        unit_id=row["unit_id"],
        unit_number=row["unit_number"],
        name=row["name"],
        email=row["email"],
        policies=policies,
    )
