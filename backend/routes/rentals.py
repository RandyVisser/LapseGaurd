"""
Subrental support. An admin flags a unit as rented; that spawns a linked
sub-unit ("{unit}-Rntl") which will hold the renter + their HO-4 policy. The
sub-unit is excluded from unit_count / billing / board counts (same physical
unit — the owner already pays for the parent).

Gated by RENTALS_ENABLED so it stays dark in prod until the full flow (lease
upload, renter invite, HO-4 validation, endorsement check) is built + tested.
"""
import os

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from auth.jwt import AuthUser, require_hoa_admin
from models.db import get_conn
from routes.hoa import _assert_hoa_access

router = APIRouter()

RENTALS_ENABLED = os.environ.get("RENTALS_ENABLED", "").lower() == "true"


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
        unit["hoa_id"], f"{unit['unit_number']}-Rntl",
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
    await conn.execute("UPDATE units SET is_rental = false WHERE id = $1", unit_id)
    return {"is_rental": False}
