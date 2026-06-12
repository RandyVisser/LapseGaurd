from fastapi import APIRouter, Depends, HTTPException
from typing import List
import asyncpg

from models.schemas import DocumentCreate, DocumentOut
from models.db import get_conn
from auth.jwt import AuthUser, get_current_user, require_hoa_admin
from routes.hoa import _assert_hoa_access

router = APIRouter()


@router.get("/unit/{unit_id}/documents", response_model=List[DocumentOut])
async def list_unit_documents(
    unit_id: str,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    # Verify unit belongs to an HOA the user can access
    unit = await conn.fetchrow("SELECT hoa_id FROM units WHERE id = $1", unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")

    if user.role == "tenant":
        tenant = await conn.fetchrow(
            "SELECT id FROM tenants WHERE unit_id = $1 AND (supabase_user_id = $2 OR email = $3)",
            unit_id,
            user.sub,
            user.email,
        )
        if tenant is None:
            raise HTTPException(status_code=403, detail="Not your unit")

    rows = await conn.fetch(
        "SELECT * FROM documents WHERE hoa_id = $1 ORDER BY created_at DESC",
        unit["hoa_id"],
    )

    return [DocumentOut(**dict(r)) for r in rows]


@router.get("/hoa/{hoa_id}/documents", response_model=List[DocumentOut])
async def list_hoa_documents(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    await _assert_hoa_access(user, hoa_id, conn)

    rows = await conn.fetch(
        "SELECT * FROM documents WHERE hoa_id = $1 ORDER BY created_at DESC",
        hoa_id,
    )
    return [DocumentOut(**dict(r)) for r in rows]


@router.post("/hoa/{hoa_id}/documents", response_model=DocumentOut)
async def upload_hoa_document(
    hoa_id: str,
    body: DocumentCreate,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    await _assert_hoa_access(user, hoa_id, conn)

    row = await conn.fetchrow(
        """
        INSERT INTO documents (hoa_id, name, file_url, uploaded_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        """,
        hoa_id,
        body.name,
        body.file_url,
        user.sub,
    )

    return DocumentOut(**dict(row))
