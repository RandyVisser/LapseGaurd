from fastapi import APIRouter, Depends, HTTPException
from typing import List
import asyncpg

from models.schemas import UnitComplianceOut, ComplianceSummary, PolicyStatus
from models.db import get_conn
from auth.jwt import AuthUser, require_hoa_admin

router = APIRouter()


def _assert_hoa_access(user: AuthUser, hoa_id: str):
    if user.hoa_id and user.hoa_id != hoa_id:
        raise HTTPException(status_code=403, detail="Access denied to this HOA")


@router.get("/hoa/{hoa_id}/units", response_model=List[UnitComplianceOut])
async def list_units(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    _assert_hoa_access(user, hoa_id)

    rows = await conn.fetch(
        """
        SELECT
            u.id AS unit_id,
            u.unit_number,
            t.name AS tenant_name,
            t.email AS tenant_email,
            t.id AS tenant_id,
            COALESCE(p.status, 'missing') AS status
        FROM units u
        LEFT JOIN tenants t ON t.unit_id = u.id
        LEFT JOIN LATERAL (
            SELECT status FROM policies
            WHERE tenant_id = t.id
            ORDER BY uploaded_at DESC
            LIMIT 1
        ) p ON true
        WHERE u.hoa_id = $1
        ORDER BY u.unit_number
        """,
        hoa_id,
    )

    return [
        UnitComplianceOut(
            unit_id=r["unit_id"],
            unit_number=r["unit_number"],
            tenant_name=r["tenant_name"],
            tenant_email=r["tenant_email"],
            tenant_id=r["tenant_id"],
            status=r["status"] or PolicyStatus.missing,
        )
        for r in rows
    ]


@router.get("/hoa/{hoa_id}/compliance", response_model=ComplianceSummary)
async def compliance_summary(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    _assert_hoa_access(user, hoa_id)

    row = await conn.fetchrow(
        """
        SELECT
            COUNT(DISTINCT u.id) AS total_units,
            COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(p.status, 'missing') = 'active') AS compliant,
            COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(p.status, 'missing') = 'expiring') AS expiring,
            COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(p.status, 'missing') = 'lapsed') AS lapsed,
            COUNT(DISTINCT u.id) FILTER (WHERE COALESCE(p.status, 'missing') = 'missing') AS missing
        FROM units u
        LEFT JOIN tenants t ON t.unit_id = u.id
        LEFT JOIN LATERAL (
            SELECT status FROM policies
            WHERE tenant_id = t.id
            ORDER BY uploaded_at DESC
            LIMIT 1
        ) p ON true
        WHERE u.hoa_id = $1
        """,
        hoa_id,
    )

    return ComplianceSummary(
        total_units=row["total_units"],
        compliant=row["compliant"],
        expiring=row["expiring"],
        lapsed=row["lapsed"],
        missing=row["missing"],
    )
