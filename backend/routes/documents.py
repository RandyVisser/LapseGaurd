import asyncio
import json
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from typing import List
import asyncpg

from models.schemas import DocumentCreate, DocumentOut
from models.db import get_conn
from auth.jwt import AuthUser, get_current_user, require_hoa_admin
from routes.hoa import _assert_hoa_access
from services.storage import signed_url, object_path, fetch_bytes
from services.pdf_fill import is_fillable, fill_form

HOA_BUCKET = "hoa-documents"


def _city_state_zip(city, state, zipc) -> str:
    city = (city or "").strip()
    right = " ".join(p for p in [(state or "").strip(), (zipc or "").strip()] if p)
    if city and right:
        return f"{city}, {right}"
    return city or right

router = APIRouter()


async def _doc_out(row) -> DocumentOut:
    d = dict(row)
    if isinstance(d.get("metadata"), str):
        d["metadata"] = json.loads(d["metadata"])
    d["fillable"] = is_fillable(d.get("doc_type"))
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
    # Reject malformed ids before they reach a UUID-typed query (would 500)
    try:
        uuid.UUID(str(unit_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Unit not found")

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


@router.get("/unit/{unit_id}/documents/{doc_id}/prefilled")
async def prefilled_document(
    unit_id: str,
    doc_id: str,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Return a copy of an association form pre-filled with this unit owner's
    details (name, address, unit #, city/state/zip, date)."""
    try:
        uuid.UUID(str(unit_id))
        uuid.UUID(str(doc_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Not found")

    unit = await conn.fetchrow(
        "SELECT id, hoa_id, unit_number, owner_primary, street_address, city, state, zip "
        "FROM units WHERE id = $1",
        unit_id,
    )
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")

    # Access: a tenant must own the unit; admins/PMs/super-users need HOA access.
    if user.role == "tenant":
        tenant = await conn.fetchrow(
            "SELECT id FROM tenants WHERE unit_id = $1 AND (supabase_user_id = $2 OR email = $3)",
            unit_id, user.sub, user.email,
        )
        if tenant is None:
            raise HTTPException(status_code=403, detail="Not your unit")
    else:
        await _assert_hoa_access(user, str(unit["hoa_id"]), conn)

    doc = await conn.fetchrow(
        "SELECT id, hoa_id, name, file_url, doc_type FROM documents WHERE id = $1",
        doc_id,
    )
    if doc is None or str(doc["hoa_id"]) != str(unit["hoa_id"]):
        raise HTTPException(status_code=404, detail="Document not found")
    if not is_fillable(doc["doc_type"]):
        raise HTTPException(status_code=400, detail="This document isn't a fillable form.")

    fetched = await fetch_bytes(doc["file_url"], HOA_BUCKET)
    if not fetched:
        raise HTTPException(status_code=502, detail="Could not load the form template.")
    template_bytes, _ = fetched

    data = {
        "date": date.today().strftime("%m/%d/%Y"),
        "name": unit["owner_primary"] or "",
        "address": unit["street_address"] or "",
        "unit_number": unit["unit_number"] or "",
        "city_state_zip": _city_state_zip(unit["city"], unit["state"], unit["zip"]),
    }
    filled = fill_form(template_bytes, doc["doc_type"], data)
    if filled is None:
        raise HTTPException(status_code=400, detail="This document isn't a fillable form.")

    unit_no = (unit["unit_number"] or "").strip()
    suffix = f" - Unit {unit_no}" if unit_no else ""
    filename = f"{doc['doc_type']}{suffix}.pdf"
    return Response(
        content=filled,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/hoa/{hoa_id}/documents", response_model=List[DocumentOut])
async def list_hoa_documents(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    # Super-user "All Associations" view sends hoa_id='__all__' — no single HOA's
    # documents to show, so return empty rather than erroring on a non-UUID id
    try:
        uuid.UUID(str(hoa_id))
    except (ValueError, TypeError):
        return []
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
