from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
import json
import random
import re
from datetime import datetime, timezone
from typing import List, Optional
import asyncpg

from models.db import get_conn
from models.schemas import TenantDetailOut, PolicyOut, PolicyStatus, ActivityLogEntry
from auth.jwt import AuthUser, get_current_user, require_hoa_admin
from services.audit import log_audit
from services.compliance import evaluate_compliance
from services.storage import signed_url
import asyncio
import os
from services.email import send_email, admin_notify_html, invite_email_html

APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")


class InviteRequest(BaseModel):
    email: str


class NotifyRequest(BaseModel):
    message: str | None = None


REVIEW_CHECK_KEYS = {
    "policy_in_force",
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


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    street_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None

router = APIRouter()


@router.get("/tenant/me")
async def get_my_tenant(
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    # An owner may hold multiple units — in one association or across several.
    # Return them all; the first row keeps the legacy single-unit fields populated.
    rows = await conn.fetch(
        """
        SELECT t.id, t.unit_id, t.name, t.email,
               u.hoa_id, u.unit_number, u.street_address, u.city, u.state, u.zip,
               u.owner_primary, u.owner_secondary,
               h.name AS hoa_name
        FROM tenants t
        JOIN units u ON u.id = t.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE t.supabase_user_id = $1 OR t.email = $2
        ORDER BY t.supabase_user_id NULLS LAST, h.name, u.unit_number
        """,
        user.sub,
        user.email,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Tenant profile not found")
    first = rows[0]
    return {
        "tenant_id": str(first["id"]),
        "unit_id": str(first["unit_id"]),
        "hoa_id": str(first["hoa_id"]),
        "name": first["name"],
        "email": first["email"],
        "units": [
            {
                "tenant_id": str(r["id"]),
                "unit_id": str(r["unit_id"]),
                "hoa_id": str(r["hoa_id"]),
                "hoa_name": r["hoa_name"],
                "unit_number": r["unit_number"],
                "street_address": r["street_address"],
                "city": r["city"],
                "state": r["state"],
                "zip": r["zip"],
                "owner_primary": r["owner_primary"],
                "owner_secondary": r["owner_secondary"],
            }
            for r in rows
        ],
    }


@router.get("/tenant/{tenant_id}", response_model=TenantDetailOut)
async def get_tenant_detail(
    tenant_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    row = await conn.fetchrow(
        """
        SELECT t.id, t.unit_id, t.name, t.email,
               COALESCE(t.phone, '') AS phone,
               u.unit_number, u.hoa_id,
               u.street_address, u.city, u.state, u.zip,
               u.owner_primary, u.owner_secondary, u.email_primary, u.email_secondary,
               h.name AS hoa_name,
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

    alert_rows = await conn.fetch(
        "SELECT id, alert_type, sent_at FROM alert_log WHERE tenant_id = $1 ORDER BY sent_at DESC LIMIT 50",
        tenant_id,
    )

    evaluation = evaluate_compliance([dict(r) for r in policy_rows])
    current_ids = evaluation["current_ids"]

    # Build activity log from alerts + policy events
    _COVERAGE_LABELS = {
        "ho6_with_wind": "HO-6",
        "ho6_wind_excluded": "HO-6 excl wind",
        "wind_only": "Wind-only",
    }
    _ALERT_LABELS = {
        "admin_notify": "Admin notification sent to",
        "expiry": "Expiry notification sent to",
        "lapse": "Lapse notification sent to",
    }
    activity: list[ActivityLogEntry] = []
    for a in alert_rows:
        label = _ALERT_LABELS.get(a["alert_type"], f"Alert ({a['alert_type']}) sent to")
        activity.append(ActivityLogEntry(
            id=str(a["id"]),
            description=f"{label} {row['email']}",
            timestamp=a["sent_at"],
            actor=None,
        ))
    for p in policy_rows:
        cov = _COVERAGE_LABELS.get(p["coverage_type"] or "", "Policy")
        pnum = p["policy_number"] or ""
        activity.append(ActivityLogEntry(
            id=f"upload-{p['id']}",
            description=f"{cov} {pnum} uploaded".strip(),
            timestamp=p["uploaded_at"],
            actor=row["name"],
        ))
        if p["parsed_at"]:
            extracted = json.loads(p["extracted_data"]) if isinstance(p["extracted_data"], str) else (p["extracted_data"] or {})
            field_count = sum(1 for v in extracted.values() if v is not None and v != "" and not isinstance(v, dict))
            activity.append(ActivityLogEntry(
                id=f"parse-{p['id']}",
                description=f"AI extracted {field_count} fields from {cov} {pnum}".strip(),
                timestamp=p["parsed_at"],
                actor="AI",
            ))
        overrides = json.loads(p["review_overrides"]) if isinstance(p["review_overrides"], str) else (p["review_overrides"] or {})
        for check_key, check_val in overrides.items():
            if isinstance(check_val, dict) and check_val.get("by") and check_val.get("at"):
                try:
                    ts = datetime.fromisoformat(check_val["at"])
                except Exception:
                    continue
                activity.append(ActivityLogEntry(
                    id=f"review-{p['id']}-{check_key}",
                    description=f"{cov} {pnum} — {check_key.replace('_', ' ')} marked {check_val['value']}".strip(),
                    timestamp=ts,
                    actor=check_val["by"],
                ))
    activity.sort(key=lambda x: x.timestamp, reverse=True)

    # Check what coverage types are in the current coverage set
    has_wind_policy = any(
        r["coverage_type"] == "wind_only" and r["id"] in current_ids
        for r in policy_rows
    )
    has_ho6_policy = any(
        r["coverage_type"] in ("ho6_with_wind", "ho6_wind_excluded") and r["id"] in current_ids
        for r in policy_rows
    )

    _WIND_PHRASES = ("wind coverage", "wind policy", "wind-only", "windstorm")

    def _effective_status(r) -> str:
        """Override DB status with non_compliant if the policy fails any HOA requirement check."""
        db_status = r["status"]
        if db_status in (PolicyStatus.lapsed.value, PolicyStatus.missing.value):
            return db_status
        if db_status not in (PolicyStatus.active.value, PolicyStatus.expiring.value, PolicyStatus.pending_review.value, PolicyStatus.non_compliant.value):
            return db_status

        # A wind-only policy with no HO-6 on file never satisfies the HO6 requirement
        if r["coverage_type"] == "wind_only" and not has_ho6_policy:
            return PolicyStatus.non_compliant.value

        ext = json.loads(r["extracted_data"]) if isinstance(r["extracted_data"], str) else (r["extracted_data"] or {})
        if not ext:
            return db_status

        # 1. Stored validation flags — skip wind-only flags if a wind policy is now present
        validation = ext.get("validation") or {}
        if validation.get("passed") is False:
            flags = validation.get("flags") or []
            non_wind_flags = [f for f in flags if not any(w in f.lower() for w in _WIND_PHRASES)]
            if non_wind_flags or (flags and not has_wind_policy):
                return PolicyStatus.non_compliant.value

        # 2. Live check against current HOA requirements (catches stale extractions)
        try:
            a_min = row["ho6_coverage_a_min"]
            dwelling = ext.get("dwelling_coverage")
            if a_min is not None and dwelling is not None and float(dwelling) < float(a_min):
                return PolicyStatus.non_compliant.value

            e_min = row["ho6_coverage_e_min"]
            liability = ext.get("liability_coverage")
            if e_min is not None and liability is not None and float(liability) < float(e_min):
                return PolicyStatus.non_compliant.value

            if row["ho6_wind_required"] and ext.get("coverage_type") == "ho6_wind_excluded" and not has_wind_policy:
                return PolicyStatus.non_compliant.value
        except (TypeError, ValueError):
            pass

        return db_status if db_status != PolicyStatus.non_compliant.value else PolicyStatus.active.value

    # Mint short-lived signed URLs for each policy's document (private bucket)
    signed_docs = await asyncio.gather(
        *(signed_url(r["document_url"], "policy-documents") for r in policy_rows)
    )

    policies = [
        PolicyOut(
            id=r["id"],
            tenant_id=r["tenant_id"],
            insurer=r["insurer"],
            policy_number=r["policy_number"],
            expiration_date=r["expiration_date"],
            status=_effective_status(r),
            document_url=signed,
            uploaded_at=r["uploaded_at"],
            extracted_data=json.loads(r["extracted_data"]) if r["extracted_data"] else None,
            parsed_at=r["parsed_at"],
            coverage_type=r["coverage_type"],
            is_current=r["id"] in current_ids,
            review_overrides=json.loads(r["review_overrides"]) if isinstance(r["review_overrides"], str) else (r["review_overrides"] or {}),
            superseded_by=r["superseded_by"],
        )
        for r, signed in zip(policy_rows, signed_docs)
    ]

    return TenantDetailOut(
        tenant_id=row["id"],
        unit_id=row["unit_id"],
        unit_number=row["unit_number"],
        name=row["name"],
        email=row["email"],
        phone=row["phone"] or None,
        hoa_id=row["hoa_id"],
        hoa_name=row["hoa_name"],
        street_address=row["street_address"],
        city=row["city"],
        state=row["state"],
        zip=row["zip"],
        owner_primary=row["owner_primary"],
        owner_secondary=row["owner_secondary"],
        email_primary=row["email_primary"],
        email_secondary=row["email_secondary"],
        policies=policies,
        needs_wind_policy=evaluation["needs_wind_policy"],
        ho6_coverage_a_min=row["ho6_coverage_a_min"],
        ho6_coverage_e_min=row["ho6_coverage_e_min"],
        ho6_wind_required=row["ho6_wind_required"],
        ho6_additional_interest_required=row["ho6_additional_interest_required"],
        ho6_policy_in_force_required=row["ho6_policy_in_force_required"],
        ho6_named_insured_match_required=row["ho6_named_insured_match_required"],
        ho6_property_address_match_required=row["ho6_property_address_match_required"],
        activity_log=activity,
    )


@router.patch("/tenant/{tenant_id}")
async def update_tenant(
    tenant_id: str,
    body: TenantUpdate,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    # Verify access
    access = await conn.fetchrow(
        "SELECT t.id, u.hoa_id, u.id AS unit_id FROM tenants t JOIN units u ON u.id = t.unit_id WHERE t.id = $1",
        tenant_id,
    )
    if not access:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if user.hoa_id and str(access["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Update tenants table
    tenant_fields = {k: v for k, v in {"name": body.name, "email": body.email, "phone": body.phone}.items() if v is not None}
    if tenant_fields:
        set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(tenant_fields))
        await conn.execute(
            f"UPDATE tenants SET {set_clause} WHERE id = $1",
            tenant_id, *tenant_fields.values(),
        )

    # Update units table
    unit_fields = {k: v for k, v in {
        "street_address": body.street_address,
        "city": body.city,
        "state": body.state,
        "zip": body.zip,
    }.items() if v is not None}
    if unit_fields:
        set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(unit_fields))
        await conn.execute(
            f"UPDATE units SET {set_clause} WHERE id = $1",
            str(access["unit_id"]), *unit_fields.values(),
        )

    return {"ok": True}


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
    await log_audit(conn, str(row["hoa_id"]), user.sub, user.email, "notify_tenant", {
        "tenant_id": tenant_id,
        "unit_number": row["unit_number"],
    })
    return {"sent": True}


class BulkNotifyRequest(BaseModel):
    tenant_ids: List[str]
    message: Optional[str] = None


@router.post("/hoa/{hoa_id}/notify-bulk")
async def bulk_notify_tenants(
    hoa_id: str,
    body: BulkNotifyRequest,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    if not body.tenant_ids:
        return {"queued": 0}

    if len(body.tenant_ids) > 200:
        raise HTTPException(status_code=422, detail="Maximum 200 tenants per bulk notify")

    rows = await conn.fetch(
        """
        SELECT t.id, t.name, t.email, u.unit_number, u.hoa_id, h.name AS hoa_name
        FROM tenants t
        JOIN units u ON u.id = t.unit_id
        JOIN hoas h ON h.id = u.hoa_id
        WHERE t.id = ANY($1::uuid[]) AND u.hoa_id = $2
        """,
        body.tenant_ids, hoa_id,
    )

    if not rows:
        raise HTTPException(status_code=404, detail="No matching tenants found in this HOA")

    async def _send_all():
        for row in rows:
            subject, html = admin_notify_html(
                row["name"], row["unit_number"], row["hoa_name"], body.message
            )
            sent = await send_email(row["email"], subject, html)
            if sent:
                await conn.execute(
                    "INSERT INTO alert_log (tenant_id, alert_type) VALUES ($1, 'admin_notify')",
                    row["id"],
                )
        await log_audit(conn, hoa_id, user.sub, user.email, "notify_bulk", {
            "count": len(rows),
            "tenant_ids": [str(r["id"]) for r in rows],
        })

    background_tasks.add_task(_send_all)
    return {"queued": len(rows)}


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


@router.get("/tenant/me/policies")
async def get_my_policies(
    unit_id: str | None = None,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    # Optional ?unit_id= scopes to one of the owner's units (multi-unit owners);
    # without it, falls back to the owner's first unit as before
    if unit_id:
        tenant = await conn.fetchrow(
            "SELECT id FROM tenants WHERE unit_id = $1 AND (supabase_user_id = $2 OR email = $3)",
            unit_id, user.sub, user.email,
        )
    else:
        tenant = await conn.fetchrow(
            "SELECT id FROM tenants WHERE supabase_user_id = $1 OR email = $2 ORDER BY supabase_user_id NULLS LAST LIMIT 1",
            user.sub, user.email,
        )
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant profile not found")
    rows = await conn.fetch(
        "SELECT * FROM policies WHERE tenant_id = $1 ORDER BY uploaded_at DESC",
        tenant["id"],
    )
    signed_docs = await asyncio.gather(
        *(signed_url(r["document_url"], "policy-documents") for r in rows)
    )
    return [
        {
            "id": str(r["id"]),
            "insurer": r["insurer"],
            "policy_number": r["policy_number"],
            "expiration_date": r["expiration_date"].isoformat() if r["expiration_date"] else None,
            "status": r["status"],
            "document_url": signed,
            "uploaded_at": r["uploaded_at"].isoformat(),
            "coverage_type": r["coverage_type"],
        }
        for r, signed in zip(rows, signed_docs)
    ]


@router.delete("/tenant/{tenant_id}")
async def delete_tenant(
    tenant_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    row = await conn.fetchrow(
        """SELECT t.id, u.hoa_id FROM tenants t JOIN units u ON u.id = t.unit_id WHERE t.id = $1""",
        tenant_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if user.hoa_id and str(row["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")

    await conn.execute("DELETE FROM alert_log WHERE tenant_id = $1", tenant_id)
    await conn.execute("DELETE FROM policies WHERE tenant_id = $1", tenant_id)
    await conn.execute("DELETE FROM tenants WHERE id = $1", tenant_id)
    return {"deleted": True}


@router.post("/unit/{unit_id}/invite")
async def invite_tenant(
    unit_id: str,
    body: InviteRequest,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    row = await conn.fetchrow(
        """
        SELECT u.unit_number, u.assoc_title, u.hoa_id, h.name AS hoa_name
        FROM units u JOIN hoas h ON h.id = u.hoa_id
        WHERE u.id = $1
        """,
        unit_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Unit not found")
    is_pm = (row["assoc_title"] or "").strip().lower() == "property manager"
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
    if invite:
        await conn.execute("UPDATE unit_invites SET last_sent_at = NOW() WHERE token = $1", invite["token"])
    else:
        invite = await conn.fetchrow(
            """
            INSERT INTO unit_invites (unit_id, email, last_sent_at)
            VALUES ($1, $2, NOW())
            RETURNING token
            """,
            unit_id, body.email,
        )

    invite_url = f"{APP_URL}/join/{invite['token']}"
    subject, html = invite_email_html(
        body.email, row["unit_number"], row["hoa_name"], invite_url, is_property_manager=is_pm
    )
    sent = await send_email(body.email, subject, html)
    if not sent:
        raise HTTPException(status_code=502, detail="Failed to send invite email")

    return {"sent": True, "invite_url": invite_url}
