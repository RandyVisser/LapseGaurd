from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import asyncpg

from models.db import get_conn
from models.schemas import TenantDetailOut, PolicyOut, PolicyStatus
from auth.jwt import AuthUser, get_current_user, require_hoa_admin
import os
from services.email import send_email, admin_notify_html, invite_email_html

APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")


class InviteRequest(BaseModel):
    email: str


class NotifyRequest(BaseModel):
    message: str | None = None

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


@router.post("/tenant/{tenant_id}/notify")
async def notify_tenant(
    tenant_id: str,
    body: NotifyRequest,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    row = await conn.fetchrow(
        """
        SELECT t.id, t.name, t.email, u.unit_number, u.hoa_id, h.name AS hoa_name
        FROM tenants t
        JOIN units u ON u.id = t.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE t.id = $1
        """,
        tenant_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if user.hoa_id and str(row["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")

    subject, html = admin_notify_html(
        row["name"], row["unit_number"], row["hoa_name"], body.message
    )
    sent = await send_email(row["email"], subject, html)
    if not sent:
        raise HTTPException(status_code=502, detail="Failed to send email")

    await conn.execute(
        "INSERT INTO alert_log (tenant_id, alert_type) VALUES ($1, 'admin_notify')",
        tenant_id,
    )
    return {"sent": True}


@router.post("/unit/{unit_id}/invite")
async def invite_tenant(
    unit_id: str,
    body: InviteRequest,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    row = await conn.fetchrow(
        """
        SELECT u.unit_number, u.hoa_id, h.name AS hoa_name
        FROM units u JOIN hoas h ON h.id = u.hoa_id
        WHERE u.id = $1
        """,
        unit_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Unit not found")
    if user.hoa_id and str(row["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Reuse an existing pending invite for the same email+unit, or create a new one
    invite = await conn.fetchrow(
        """
        SELECT token FROM unit_invites
        WHERE unit_id = $1 AND email = $2 AND accepted_at IS NULL
        ORDER BY created_at DESC LIMIT 1
        """,
        unit_id, body.email,
    )
    if not invite:
        invite = await conn.fetchrow(
            """
            INSERT INTO unit_invites (unit_id, email)
            VALUES ($1, $2)
            RETURNING token
            """,
            unit_id, body.email,
        )

    invite_url = f"{APP_URL}/join/{invite['token']}"
    subject, html = invite_email_html(
        body.email, row["unit_number"], row["hoa_name"], invite_url
    )
    sent = await send_email(body.email, subject, html)
    if not sent:
        raise HTTPException(status_code=502, detail="Failed to send invite email")

    return {"sent": True, "invite_url": invite_url}
