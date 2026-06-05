"""
Public onboarding routes — no auth required.
  POST /onboard/association  — association manager signup
  GET  /invite/{token}       — fetch invite info (for the join page)
  POST /invite/{token}       — tenant accepts invite, creates account
"""
import os
import uuid

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from models.db import get_conn
from services.email import send_email, invite_email_html

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

router = APIRouter()


# ── Pydantic models ────────────────────────────────────────────────────────────

class AssociationSignup(BaseModel):
    association_name: str
    address: str
    admin_name: str
    email: EmailStr
    password: str


class InviteAccept(BaseModel):
    name: str
    password: str


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _create_supabase_user(email: str, password: str, app_metadata: dict) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers={
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            },
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
                "app_metadata": app_metadata,
            },
        )
    if resp.status_code not in (200, 201):
        detail = resp.json().get("msg") or resp.json().get("message") or resp.text
        raise HTTPException(status_code=400, detail=detail)
    return resp.json()["id"]


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/onboard/association", status_code=201)
async def signup_association(
    body: AssociationSignup,
    conn: asyncpg.Connection = Depends(get_conn),
):
    # Check email not already used
    existing = await conn.fetchval(
        "SELECT id FROM auth.users WHERE email = $1", body.email
    ) if False else None  # handled by Supabase

    # Create HOA record
    hoa_id = str(uuid.uuid4())
    await conn.execute(
        "INSERT INTO hoas (id, name, address) VALUES ($1, $2, $3)",
        hoa_id, body.association_name, body.address,
    )

    # Create Supabase admin user
    try:
        user_id = await _create_supabase_user(
            body.email,
            body.password,
            {"role": "hoa_admin", "hoa_id": hoa_id},
        )
    except HTTPException:
        # Roll back HOA if user creation fails
        await conn.execute("DELETE FROM hoas WHERE id = $1", hoa_id)
        raise

    return {"hoa_id": hoa_id, "user_id": user_id}


@router.get("/invite/{token}")
async def get_invite(token: str, conn: asyncpg.Connection = Depends(get_conn)):
    row = await conn.fetchrow(
        """
        SELECT i.id, i.email, i.accepted_at,
               u.unit_number, u.hoa_id,
               h.name AS hoa_name
        FROM unit_invites i
        JOIN units u ON u.id = i.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE i.token = $1
        """,
        token,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invite not found")
    if row["accepted_at"]:
        raise HTTPException(status_code=410, detail="Invite already used")
    return {
        "email": row["email"],
        "unit_number": row["unit_number"],
        "hoa_name": row["hoa_name"],
    }


@router.post("/invite/{token}", status_code=201)
async def accept_invite(
    token: str,
    body: InviteAccept,
    conn: asyncpg.Connection = Depends(get_conn),
):
    row = await conn.fetchrow(
        """
        SELECT i.id, i.email, i.unit_id, i.accepted_at,
               u.unit_number, h.name AS hoa_name
        FROM unit_invites i
        JOIN units u ON u.id = i.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE i.token = $1
        """,
        token,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invite not found")
    if row["accepted_at"]:
        raise HTTPException(status_code=410, detail="Invite already used")

    # Create Supabase user
    user_id = await _create_supabase_user(
        row["email"],
        body.password,
        {"role": "tenant"},
    )

    # Create tenant record linked to unit
    await conn.execute(
        """
        INSERT INTO tenants (unit_id, supabase_user_id, name, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (supabase_user_id) DO NOTHING
        """,
        row["unit_id"], user_id, body.name, row["email"],
    )

    # Mark invite accepted
    await conn.execute(
        "UPDATE unit_invites SET accepted_at = NOW() WHERE token = $1", token
    )

    return {"ok": True}
