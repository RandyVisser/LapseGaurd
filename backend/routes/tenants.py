from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import json
import random
import re
from datetime import datetime, timezone
import asyncpg

from models.db import get_conn
from models.schemas import TenantDetailOut, PolicyOut, PolicyStatus
from auth.jwt import AuthUser, get_current_user, require_hoa_admin
from services.compliance import evaluate_compliance
import os
from services.email import send_email, admin_notify_html, invite_email_html

APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")


class InviteRequest(BaseModel):
    email: str


class NotifyRequest(BaseModel):
    message: str | None = None


REVIEW_CHECK_KEYS = {
    "named_insured_match",
    "property_address_match",
    "coverage_a_min",
    "coverage_e_min",
    "wind_coverage",
    "association_additional_interest",
}


class PolicyReviewUpdate(BaseModel):
    check_key: str
    value: str  # "pass" | "fail" | "override"

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
        SELECT t.id, t.unit_id, t.name, t.email, u.unit_number, u.hoa_id,
               u.street_address, u.city, u.state, u.zip,
               h.ho6_coverage_a_min, h.ho6_coverage_e_min, h.ho6_wind_required, h.ho6_additional_interest_required,
               h.ho6_policy_in_force_required, h.ho6_named_insured_match_required, h.ho6_property_address_match_required
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

    policy_rows = await conn.fetch(
        """SELECT * FROM policies WHERE tenant_id = $1
           ORDER BY
               CASE status WHEN 'active' THEN 0 WHEN 'expiring' THEN 1 WHEN 'lapsed' THEN 2 ELSE 3 END,
               expiration_date DESC NULLS LAST,
               uploaded_at DESC""",
        tenant_id,
    )

    evaluation = evaluate_compliance([dict(r) for r in policy_rows])
    current_ids = evaluation["current_ids"]

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
            extracted_data=json.loads(r["extracted_data"]) if r["extracted_data"] else None,
            parsed_at=r["parsed_at"],
            coverage_type=r["coverage_type"],
            is_current=r["id"] in current_ids,
            review_overrides=json.loads(r["review_overrides"]) if isinstance(r["review_overrides"], str) else (r["review_overrides"] or {}),
        )
        for r in policy_rows
    ]

    return TenantDetailOut(
        tenant_id=row["id"],
        unit_id=row["unit_id"],
        unit_number=row["unit_number"],
        name=row["name"],
        email=row["email"],
        street_address=row["street_address"],
        city=row["city"],
        state=row["state"],
        zip=row["zip"],
        policies=policies,
        needs_wind_policy=evaluation["needs_wind_policy"],
        ho6_coverage_a_min=row["ho6_coverage_a_min"],
        ho6_coverage_e_min=row["ho6_coverage_e_min"],
        ho6_wind_required=row["ho6_wind_required"],
        ho6_additional_interest_required=row["ho6_additional_interest_required"],
        ho6_policy_in_force_required=row["ho6_policy_in_force_required"],
        ho6_named_insured_match_required=row["ho6_named_insured_match_required"],
        ho6_property_address_match_required=row["ho6_property_address_match_required"],
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


@router.post("/policy/{policy_id}/review")
async def set_policy_review(
    policy_id: str,
    body: PolicyReviewUpdate,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    if body.check_key not in REVIEW_CHECK_KEYS:
        raise HTTPException(status_code=422, detail="Unknown check_key")
    if body.value not in ("pass", "fail", "override"):
        raise HTTPException(status_code=422, detail="value must be pass, fail, or override")

    row = await conn.fetchrow(
        """
        SELECT p.id, p.review_overrides, u.hoa_id
        FROM policies p
        JOIN tenants t ON t.id = p.tenant_id
        JOIN units u ON u.id = t.unit_id
        WHERE p.id = $1
        """,
        policy_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Policy not found")
    if user.hoa_id and str(row["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")

    overrides = row["review_overrides"]
    if isinstance(overrides, str):
        overrides = json.loads(overrides)
    overrides = dict(overrides or {})
    overrides[body.check_key] = {
        "value": body.value,
        "by": user.email,
        "at": datetime.now(timezone.utc).isoformat(),
    }

    updated = await conn.fetchrow(
        "UPDATE policies SET review_overrides = $1 WHERE id = $2 RETURNING review_overrides",
        json.dumps(overrides), policy_id,
    )
    result = updated["review_overrides"]
    return {"review_overrides": json.loads(result) if isinstance(result, str) else result}


@router.post("/unit/{unit_id}/tenant")
async def create_tenant_record(
    unit_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Create a bare unit-owner record (no Supabase login) so an admin can
    attach a dec page mailed/faxed in by an owner who has no email on file."""
    unit = await conn.fetchrow(
        "SELECT id, hoa_id, unit_number, owner_primary, email_primary FROM units WHERE id = $1",
        unit_id,
    )
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    if user.hoa_id and str(unit["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")

    existing = await conn.fetchrow("SELECT id FROM tenants WHERE unit_id = $1", unit_id)
    if existing:
        return {"id": str(existing["id"])}

    name = unit["owner_primary"] or f"Unit {unit['unit_number']} Owner"

    if unit["email_primary"]:
        email = unit["email_primary"]
    else:
        parts = (unit["owner_primary"] or "").strip().lower().split()
        if len(parts) >= 2:
            slug = f"{parts[0]}.{parts[-1]}"
        elif parts:
            slug = parts[0]
        else:
            slug = "owner"
        slug = re.sub(r"[^a-z0-9.]", "", slug)
        email = f"{slug}+{random.randint(1000, 9999)}@condo.insure"

    row = await conn.fetchrow(
        """
        INSERT INTO tenants (unit_id, supabase_user_id, name, email)
        VALUES ($1, NULL, $2, $3)
        RETURNING id
        """,
        unit_id, name, email,
    )
    return {"id": str(row["id"])}


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
