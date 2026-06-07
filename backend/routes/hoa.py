from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
import asyncpg
from pydantic import BaseModel

from models.schemas import UnitComplianceOut, ComplianceSummary, PolicyStatus
from models.db import get_conn
from auth.jwt import AuthUser, require_hoa_admin
from services.compliance import evaluate_compliance


class UnitCreate(BaseModel):
    unit_number: str

router = APIRouter()


async def _assert_hoa_access(user: AuthUser, hoa_id: str, conn: asyncpg.Connection):
    if user.role == "super_user":
        return
    if user.role == "property_manager":
        row = await conn.fetchrow(
            "SELECT 1 FROM property_manager_hoas WHERE supabase_user_id = $1 AND hoa_id = $2",
            user.sub, hoa_id,
        )
        if row is None:
            raise HTTPException(status_code=403, detail="Access denied to this HOA")
        return
    if user.hoa_id and user.hoa_id != hoa_id:
        raise HTTPException(status_code=403, detail="Access denied to this HOA")


async def _compliance_status_by_tenant(conn: asyncpg.Connection, tenant_ids: list) -> dict:
    """Evaluate each tenant's overall compliance status, accounting for the
    HO6-with-wind vs (HO6-wind-excluded + standalone wind) coverage combo."""
    if not tenant_ids:
        return {}
    rows = await conn.fetch(
        """SELECT id, tenant_id, status, coverage_type, expiration_date, uploaded_at
           FROM policies WHERE tenant_id = ANY($1::uuid[])""",
        tenant_ids,
    )
    by_tenant: dict = {}
    for r in rows:
        by_tenant.setdefault(r["tenant_id"], []).append(dict(r))
    return {tid: evaluate_compliance(policies)["status"] for tid, policies in by_tenant.items()}


class HoaOut(BaseModel):
    id: str
    name: str
    subdivision: Optional[str] = None
    corp_name: Optional[str] = None
    sunbiz_doc_number: Optional[str] = None
    ho6_coverage_a_min: Optional[float] = None
    ho6_coverage_e_min: Optional[float] = None
    ho6_wind_required: bool = False


_HOA_SEARCH_FIELDS = """
    h.id,
    h.name,
    h.ho6_coverage_a_min,
    h.ho6_coverage_e_min,
    h.ho6_wind_required,
    (SELECT u.subdivision FROM units u WHERE u.hoa_id = h.id AND u.subdivision IS NOT NULL LIMIT 1) AS subdivision,
    (SELECT u.corp_name FROM units u WHERE u.hoa_id = h.id AND u.corp_name IS NOT NULL LIMIT 1) AS corp_name,
    (SELECT u.sunbiz_doc_number FROM units u WHERE u.hoa_id = h.id AND u.sunbiz_doc_number IS NOT NULL LIMIT 1) AS sunbiz_doc_number
"""


@router.get("/hoas", response_model=List[HoaOut])
async def list_hoas(
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """List HOAs the current user can access (for the HOA switcher)."""
    if user.role == "super_user":
        rows = await conn.fetch(f"SELECT {_HOA_SEARCH_FIELDS} FROM hoas h ORDER BY h.name")
    elif user.role == "property_manager":
        rows = await conn.fetch(
            f"""SELECT {_HOA_SEARCH_FIELDS} FROM hoas h
               JOIN property_manager_hoas pmh ON pmh.hoa_id = h.id
               WHERE pmh.supabase_user_id = $1
               ORDER BY h.name""",
            user.sub,
        )
    else:
        rows = await conn.fetch(f"SELECT {_HOA_SEARCH_FIELDS} FROM hoas h WHERE h.id = $1", user.hoa_id)
    return [
        HoaOut(
            id=str(r["id"]),
            name=r["name"],
            subdivision=r["subdivision"],
            corp_name=r["corp_name"],
            sunbiz_doc_number=r["sunbiz_doc_number"],
            ho6_coverage_a_min=r["ho6_coverage_a_min"],
            ho6_coverage_e_min=r["ho6_coverage_e_min"],
            ho6_wind_required=r["ho6_wind_required"],
        )
        for r in rows
    ]


@router.get("/hoa/{hoa_id}/units", response_model=List[UnitComplianceOut])
async def list_units(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    await _assert_hoa_access(user, hoa_id, conn)

    rows = await conn.fetch(
        """
        SELECT
            u.id AS unit_id,
            u.unit_number,
            u.street_address,
            u.city,
            u.state,
            u.zip,
            u.radar_id,
            u.assessor_parcel_number,
            u.type,
            u.subdivision,
            u.corp_name,
            u.assoc_title,
            u.sunbiz_doc_number,
            u.fein,
            u.owner_primary,
            u.email_primary,
            u.owner_secondary,
            u.email_secondary,
            u.purchase_date,
            t.name AS tenant_name,
            t.email AS tenant_email,
            t.id AS tenant_id
        FROM units u
        LEFT JOIN tenants t ON t.unit_id = u.id
        WHERE u.hoa_id = $1
        ORDER BY u.unit_number
        """,
        hoa_id,
    )

    tenant_ids = [r["tenant_id"] for r in rows if r["tenant_id"] is not None]
    statuses = await _compliance_status_by_tenant(conn, tenant_ids)

    return [
        UnitComplianceOut(
            unit_id=r["unit_id"],
            unit_number=r["unit_number"],
            street_address=r["street_address"],
            city=r["city"],
            state=r["state"],
            zip=r["zip"],
            radar_id=r["radar_id"],
            assessor_parcel_number=r["assessor_parcel_number"],
            type=r["type"],
            subdivision=r["subdivision"],
            corp_name=r["corp_name"],
            assoc_title=r["assoc_title"],
            sunbiz_doc_number=r["sunbiz_doc_number"],
            fein=r["fein"],
            tenant_name=r["tenant_name"],
            tenant_email=r["tenant_email"],
            owner_primary=r["owner_primary"],
            email_primary=r["email_primary"],
            owner_secondary=r["owner_secondary"],
            email_secondary=r["email_secondary"],
            purchase_date=r["purchase_date"],
            tenant_id=r["tenant_id"],
            status=statuses.get(r["tenant_id"], PolicyStatus.missing.value),
        )
        for r in rows
    ]


@router.get("/hoa/{hoa_id}/compliance", response_model=ComplianceSummary)
async def compliance_summary(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    await _assert_hoa_access(user, hoa_id, conn)

    rows = await conn.fetch(
        """SELECT u.id AS unit_id, u.assoc_title, t.id AS tenant_id
           FROM units u LEFT JOIN tenants t ON t.unit_id = u.id
           WHERE u.hoa_id = $1""",
        hoa_id,
    )

    tenant_ids = [r["tenant_id"] for r in rows if r["tenant_id"] is not None]
    statuses = await _compliance_status_by_tenant(conn, tenant_ids)

    total_units = board_members = property_managers = 0
    compliant = expiring = lapsed = missing = 0
    for r in rows:
        is_pm = r["assoc_title"] == "Property Manager"
        if not is_pm:
            total_units += 1
        if is_pm:
            property_managers += 1
        elif r["assoc_title"]:
            board_members += 1

        status = statuses.get(r["tenant_id"], PolicyStatus.missing.value)
        if status == PolicyStatus.active.value:
            compliant += 1
        elif status == PolicyStatus.expiring.value:
            expiring += 1
        elif status == PolicyStatus.lapsed.value:
            lapsed += 1
        elif status == PolicyStatus.missing.value:
            missing += 1

    return ComplianceSummary(
        total_units=total_units,
        board_members=board_members,
        property_managers=property_managers,
        compliant=compliant,
        expiring=expiring,
        lapsed=lapsed,
        missing=missing,
    )


@router.post("/hoa/{hoa_id}/units", status_code=201)
async def add_unit(
    hoa_id: str,
    body: UnitCreate,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    await _assert_hoa_access(user, hoa_id, conn)
    row = await conn.fetchrow(
        "INSERT INTO units (hoa_id, unit_number) VALUES ($1, $2) RETURNING id, unit_number",
        hoa_id, body.unit_number,
    )
    return {"unit_id": str(row["id"]), "unit_number": row["unit_number"]}
