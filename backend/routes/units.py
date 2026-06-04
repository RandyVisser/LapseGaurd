from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from datetime import date, timedelta, timezone, datetime
import asyncpg

from models.schemas import PolicyCreate, PolicyOut, PolicyStatus
from models.db import get_conn, get_pool
from auth.jwt import AuthUser, get_current_user
from services.policy_parser import parse_dec_page

router = APIRouter()


def _compute_status(expiration_date: date | None) -> PolicyStatus:
    if expiration_date is None:
        return PolicyStatus.missing
    today = date.today()
    if expiration_date < today:
        return PolicyStatus.lapsed
    if expiration_date <= today + timedelta(days=30):
        return PolicyStatus.expiring
    return PolicyStatus.active


@router.get("/unit/{unit_id}/policy", response_model=PolicyOut | None)
async def get_policy(
    unit_id: str,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    tenant = await conn.fetchrow(
        "SELECT id FROM tenants WHERE unit_id = $1 AND (supabase_user_id = $2 OR $3 = 'hoa_admin')",
        unit_id, user.sub, user.role,
    )
    if tenant is None:
        raise HTTPException(status_code=403, detail="Not your unit")

    row = await conn.fetchrow(
        "SELECT * FROM policies WHERE tenant_id = $1 ORDER BY uploaded_at DESC LIMIT 1",
        tenant["id"],
    )
    if row is None:
        return None
    return PolicyOut(
        id=row["id"],
        tenant_id=row["tenant_id"],
        insurer=row["insurer"],
        policy_number=row["policy_number"],
        expiration_date=row["expiration_date"],
        status=row["status"],
        document_url=row["document_url"],
        uploaded_at=row["uploaded_at"],
        extracted_data=dict(row["extracted_data"]) if row["extracted_data"] else None,
        parsed_at=row["parsed_at"],
    )


async def _run_parsing(policy_id: str, document_url: str, submitted: dict):
    extracted = await parse_dec_page(document_url, submitted)
    if extracted:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE policies SET extracted_data = $1, parsed_at = $2 WHERE id = $3",
                extracted,
                datetime.now(timezone.utc),
                policy_id,
            )


@router.post("/unit/{unit_id}/policy", response_model=PolicyOut)
async def upload_policy(
    unit_id: str,
    body: PolicyCreate,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    # Verify tenant belongs to this unit
    tenant = await conn.fetchrow(
        "SELECT id FROM tenants WHERE unit_id = $1 AND supabase_user_id = $2",
        unit_id,
        user.sub,
    )
    if tenant is None and user.role != "hoa_admin":
        raise HTTPException(status_code=403, detail="Not your unit")

    # For admin posting on behalf of tenant, find tenant for unit
    if tenant is None:
        tenant = await conn.fetchrow("SELECT id FROM tenants WHERE unit_id = $1", unit_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="No tenant found for this unit")

    if body.expiration_date and body.expiration_date < date.today():
        raise HTTPException(
            status_code=422,
            detail=f"Policy is already expired — expiration date {body.expiration_date} is in the past. Please upload a current policy."
        )

    status = _compute_status(body.expiration_date)

    row = await conn.fetchrow(
        """
        INSERT INTO policies (tenant_id, insurer, policy_number, expiration_date, status, document_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        """,
        tenant["id"],
        body.insurer,
        body.policy_number,
        body.expiration_date,
        status.value,
        body.document_url,
    )

    policy = PolicyOut(
        id=row["id"],
        tenant_id=row["tenant_id"],
        insurer=row["insurer"],
        policy_number=row["policy_number"],
        expiration_date=row["expiration_date"],
        status=row["status"],
        document_url=row["document_url"],
        uploaded_at=row["uploaded_at"],
    )

    if body.document_url:
        submitted = {
            "insurer": body.insurer,
            "policy_number": body.policy_number,
            "expiration_date": str(body.expiration_date) if body.expiration_date else None,
        }
        background_tasks.add_task(_run_parsing, str(row["id"]), body.document_url, submitted)

    return policy
