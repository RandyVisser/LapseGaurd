import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from typing import List
import asyncpg

from models.schemas import DocumentCreate, DocumentOut
from models.db import get_conn
from auth.jwt import AuthUser, get_current_user, require_hoa_admin
from routes.hoa import _assert_hoa_access
from services.storage import signed_url, object_path

HOA_BUCKET = "hoa-documents"

router = APIRouter()


async def _doc_out(row) -> DocumentOut:
    d = dict(row)
    if isinstance(d.get("metadata"), str):
        d["metadata"] = json.loads(d["metadata"])
    d["file_url"] = await signed_url(d.get("file_url"), HOA_BUCKET)
    return DocumentOut(**d)


async def _docs_out(rows) -> List[DocumentOut]:
    return list(await asyncio.gather(*(_doc_out(r) for r in rows)))


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

    return await _docs_out(rows)


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
    return await _docs_out(rows)


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
        INSERT INTO documents (hoa_id, name, file_url, uploaded_by, doc_type, metadata)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        RETURNING *
        """,
        hoa_id,
        body.name,
        object_path(body.file_url, HOA_BUCKET),  # store bare path; reads sign it
        user.sub,
        body.doc_type,
        json.dumps(body.metadata) if body.metadata else None,
    )

    return await _doc_out(row)


@router.delete("/hoa/{hoa_id}/documents/{doc_id}")
async def delete_hoa_document(
    hoa_id: str,
    doc_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    await _assert_hoa_access(user, hoa_id, conn)

    row = await conn.fetchrow(
        "DELETE FROM documents WHERE id = $1 AND hoa_id = $2 RETURNING id",
        doc_id, hoa_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True}
