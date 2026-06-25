"""
Subrental support. An admin flags a unit as rented; that spawns a linked
sub-unit ("{unit}-Renter") which will hold the renter + their HO-4 policy. The
sub-unit is excluded from unit_count / billing / board counts (same physical
unit — the owner already pays for the parent).

Gated by RENTALS_ENABLED so it stays dark in prod until the full flow (lease
upload, renter invite, HO-4 validation, endorsement check) is built + tested.
"""
import json
import os

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from auth.jwt import AuthUser, require_hoa_admin, get_current_user
from models.db import get_conn
from routes.hoa import _assert_hoa_access
from services.email import send_email, invite_email_html, format_address
from services.lease_parser import parse_lease_bytes
from services.storage import object_path, fetch_bytes

router = APIRouter()

RENTALS_ENABLED = os.environ.get("RENTALS_ENABLED", "").lower() == "true"
APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")
LEASE_BUCKET = "policy-documents"  # leases live in the private policy bucket (read via signed URLs)


class LeaseUpload(BaseModel):
    document_url: str


class RenterInvite(BaseModel):
    email: EmailStr
    name: str | None = None


async def _assert_unit_owner_or_admin(conn, user: AuthUser, unit_id: str):
    """Return the parent unit row; allow its owner (a tenant of the unit) or staff."""
    unit = await conn.fetchrow(
        "SELECT id, hoa_id, unit_number, is_rental, parent_unit_id FROM units WHERE id = $1", unit_id,
    )
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    if unit["parent_unit_id"] is not None:
        raise HTTPException(status_code=400, detail="This is a rental sub-unit.")
    tenant = await conn.fetchrow(
        "SELECT id FROM tenants WHERE unit_id = $1 AND (supabase_user_id = $2 OR email = $3)",
        unit_id, user.sub, user.email,
    )
    if tenant is None:
        if user.role not in ("hoa_admin", "super_user", "property_manager"):
            raise HTTPException(status_code=403, detail="Not your unit")
        await _assert_hoa_access(user, str(unit["hoa_id"]), conn)
    return unit


def _require_rentals():
    # 404 (not 403) so the feature is invisible, not just forbidden, while off.
    if not RENTALS_ENABLED:
        raise HTTPException(status_code=404, detail="Not found")


async def _delete_unit_cascade(conn: asyncpg.Connection, unit_id) -> None:
    """Remove a unit and everything under it (tenants, policies, invites)."""
    tenant_ids = [r["id"] for r in await conn.fetch("SELECT id FROM tenants WHERE unit_id = $1", unit_id)]
    if tenant_ids:
        await conn.execute("DELETE FROM alert_log WHERE tenant_id = ANY($1::uuid[])", tenant_ids)
        await conn.execute("DELETE FROM policies WHERE tenant_id = ANY($1::uuid[])", tenant_ids)
    await conn.execute("DELETE FROM unit_invites WHERE unit_id = $1", unit_id)
    await conn.execute("DELETE FROM tenants WHERE unit_id = $1", unit_id)
    await conn.execute("DELETE FROM units WHERE id = $1", unit_id)


@router.post("/unit/{unit_id}/rental")
async def flag_rental(
    unit_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Flag a unit as rented and create its renter sub-unit. Idempotent."""
    _require_rentals()
    unit = await conn.fetchrow(
        "SELECT id, hoa_id, unit_number, street_address, city, state, zip, parent_unit_id FROM units WHERE id = $1",
        unit_id,
    )
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    await _assert_hoa_access(user, str(unit["hoa_id"]), conn)
    if unit["parent_unit_id"] is not None:
        raise HTTPException(status_code=400, detail="This is already a rental sub-unit.")

    existing = await conn.fetchrow(
        "SELECT id, unit_number FROM units WHERE parent_unit_id = $1", unit_id,
    )
    if existing:
        await conn.execute("UPDATE units SET is_rental = true WHERE id = $1", unit_id)
        return {"is_rental": True, "rental_unit_id": str(existing["id"]), "rental_unit_number": existing["unit_number"]}

    sub = await conn.fetchrow(
        """INSERT INTO units (hoa_id, unit_number, street_address, city, state, zip, parent_unit_id, is_rental)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id, unit_number""",
        unit["hoa_id"], f"{unit['unit_number']}-Renter",
        unit["street_address"], unit["city"], unit["state"], unit["zip"], unit_id,
    )
    await conn.execute("UPDATE units SET is_rental = true WHERE id = $1", unit_id)
    return {"is_rental": True, "rental_unit_id": str(sub["id"]), "rental_unit_number": sub["unit_number"]}


@router.delete("/unit/{unit_id}/rental")
async def unflag_rental(
    unit_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Remove the rental flag and delete the renter sub-unit (and its renter)."""
    _require_rentals()
    unit = await conn.fetchrow("SELECT id, hoa_id, parent_unit_id FROM units WHERE id = $1", unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    await _assert_hoa_access(user, str(unit["hoa_id"]), conn)

    sub = await conn.fetchrow("SELECT id FROM units WHERE parent_unit_id = $1", unit_id)
    if sub:
        await _delete_unit_cascade(conn, sub["id"])
    await conn.execute(
        "UPDATE units SET is_rental = false, lease_document_url = NULL, lease_extracted = NULL, "
        "lease_uploaded_at = NULL WHERE id = $1",
        unit_id,
    )
    return {"is_rental": False}


@router.post("/unit/{unit_id}/lease")
async def upload_lease(
    unit_id: str,
    body: LeaseUpload,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Owner uploads the lease for a rented unit. Store it, AI-parse the renter
    name(s), and prefill the linked sub-unit. The frontend uploads the file to the
    bucket first and passes the object path here."""
    _require_rentals()
    unit = await _assert_unit_owner_or_admin(conn, user, unit_id)
    if not unit["is_rental"]:
        raise HTTPException(status_code=400, detail="Flag this unit as a rental first.")
    sub = await conn.fetchrow("SELECT id, owner_primary FROM units WHERE parent_unit_id = $1", unit_id)
    if not sub:
        raise HTTPException(status_code=400, detail="No rental sub-unit found — re-flag the unit.")

    doc_ref = object_path(body.document_url, LEASE_BUCKET)
    await conn.execute(
        "UPDATE units SET lease_document_url = $1, lease_uploaded_at = NOW() WHERE id = $2",
        doc_ref, unit_id,
    )

    extracted = None
    fetched = await fetch_bytes(doc_ref, LEASE_BUCKET)
    if fetched is not None:
        content, content_type = fetched
        if doc_ref.lower().endswith(".pdf") and "pdf" not in (content_type or ""):
            content_type = "application/pdf"
        extracted = await parse_lease_bytes(content, content_type)
        await conn.execute(
            "UPDATE units SET lease_extracted = $1 WHERE id = $2",
            json.dumps(extracted) if extracted else None, unit_id,
        )

    names = [n for n in ((extracted or {}).get("tenant_names") or []) if (n or "").strip()]
    # Prefill the sub-unit's owner name from the first renter if not already set
    if names and not (sub["owner_primary"] or "").strip():
        await conn.execute("UPDATE units SET owner_primary = $1 WHERE id = $2", names[0], sub["id"])

    return {
        "lease_uploaded": True,
        "rental_unit_id": str(sub["id"]),
        "renter_names": names,
        "lease_start": (extracted or {}).get("lease_start"),
        "lease_end": (extracted or {}).get("lease_end"),
        "parsed": extracted is not None,
    }


@router.post("/unit/{unit_id}/rental/invite")
async def invite_renter(
    unit_id: str,
    body: RenterInvite,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Owner supplies the renter's email; set it on the sub-unit and send the
    renter an invite to create an account + upload their HO-4."""
    _require_rentals()
    await _assert_unit_owner_or_admin(conn, user, unit_id)
    sub = await conn.fetchrow(
        """SELECT s.id, s.unit_number, s.owner_primary, h.name AS hoa_name,
                  s.street_address, s.city, s.state, s.zip
           FROM units s JOIN hoas h ON h.id = s.hoa_id WHERE s.parent_unit_id = $1""",
        unit_id,
    )
    if not sub:
        raise HTTPException(status_code=400, detail="No rental sub-unit found — re-flag the unit.")

    name = (body.name or sub["owner_primary"] or "").strip() or None
    await conn.execute(
        "UPDATE units SET email_primary = $1, owner_primary = COALESCE($2, owner_primary) WHERE id = $3",
        str(body.email), name, sub["id"],
    )

    invite = await conn.fetchrow(
        "SELECT token FROM unit_invites WHERE unit_id = $1 AND email = $2 AND accepted_at IS NULL "
        "ORDER BY created_at DESC LIMIT 1",
        sub["id"], str(body.email),
    )
    if invite:
        await conn.execute("UPDATE unit_invites SET last_sent_at = NOW() WHERE token = $1", invite["token"])
    else:
        invite = await conn.fetchrow(
            "INSERT INTO unit_invites (unit_id, email, last_sent_at) VALUES ($1, $2, NOW()) RETURNING token",
            sub["id"], str(body.email),
        )

    invite_url = f"{APP_URL}/join/{invite['token']}"
    subject, html = invite_email_html(
        str(body.email), sub["unit_number"], sub["hoa_name"], invite_url,
        recipient_name=name,
        unit_address=format_address(sub["street_address"], sub["city"], sub["state"], sub["zip"]),
    )
    sent = await send_email(str(body.email), subject, html)
    if not sent:
        raise HTTPException(status_code=502, detail="Failed to send invite email")
    return {"sent": True, "invite_url": invite_url}
