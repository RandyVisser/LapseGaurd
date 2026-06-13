import csv
import io
import re
from datetime import date
from typing import List, Optional

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth.jwt import AuthUser, require_hoa_admin
from models.db import get_conn
from models.schemas import ComplianceSummary, PolicyStatus, UnitComplianceOut
from services.audit import log_audit
from services.compliance import evaluate_compliance
from services.email import board_report_html, send_email


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


async def _compliance_status_by_tenant(
    conn: asyncpg.Connection, tenant_ids: list, hoa_reqs: dict | None = None
) -> tuple[dict, dict]:
    """Evaluate each tenant's overall compliance status, accounting for the
    HO6-with-wind vs (HO6-wind-excluded + standalone wind) coverage combo.
    Returns (statuses_dict, expiration_dates_dict)."""
    if not tenant_ids:
        return {}, {}
    rows = await conn.fetch(
        """SELECT id, tenant_id, status, coverage_type, expiration_date, uploaded_at, extracted_data
           FROM policies WHERE tenant_id = ANY($1::uuid[])""",
        tenant_ids,
    )
    by_tenant: dict = {}
    for r in rows:
        by_tenant.setdefault(r["tenant_id"], []).append(dict(r))
    statuses = {}
    exp_dates = {}
    import json as _json
    for tid, policies in by_tenant.items():
        result = evaluate_compliance(policies)
        status = result["status"]
        # Override to non_compliant if any current policy fails validation
        if status in (PolicyStatus.active.value, PolicyStatus.expiring.value, PolicyStatus.pending_review.value, PolicyStatus.non_compliant.value):
            current_ids = result.get("current_ids", set())
            current_policies = [p for p in policies if p["id"] in current_ids]
            has_wind_policy = any(p.get("coverage_type") == "wind_only" for p in current_policies)
            found_non_compliant = False
            for p in current_policies:
                raw = p.get("extracted_data")
                ext = _json.loads(raw) if isinstance(raw, str) else (raw or {})
                if not ext:
                    continue
                # Check stored validation flags — but skip wind-only flags if wind is now covered
                validation = ext.get("validation") or {}
                if validation.get("passed") is False:
                    flags = validation.get("flags") or []
                    _WIND_PHRASES = ("wind coverage", "wind policy", "wind-only", "windstorm")
                    non_wind_flags = [f for f in flags if not any(w in f.lower() for w in _WIND_PHRASES)]
                    if non_wind_flags or (flags and not has_wind_policy):
                        found_non_compliant = True
                        break
                # Live coverage check against HOA requirements
                if hoa_reqs:
                    try:
                        a_min = hoa_reqs.get("ho6_coverage_a_min")
                        dwelling = ext.get("dwelling_coverage")
                        if a_min and dwelling and float(dwelling) < float(a_min):
                            found_non_compliant = True
                            break
                        e_min = hoa_reqs.get("ho6_coverage_e_min")
                        liability = ext.get("liability_coverage")
                        if e_min and liability and float(liability) < float(e_min):
                            found_non_compliant = True
                            break
                        if hoa_reqs.get("ho6_wind_required") and ext.get("coverage_type") == "ho6_wind_excluded" and not has_wind_policy:
                            found_non_compliant = True
                            break
                    except (TypeError, ValueError):
                        pass
            if found_non_compliant or result.get("needs_ho6_policy"):
                status = PolicyStatus.non_compliant.value
            elif status == PolicyStatus.non_compliant.value:
                # Was non-compliant but all issues are now resolved — revert to active/expiring from DB
                best = min(current_policies, key=lambda p: (p.get("expiration_date") or "9999"), default=None)
                if best:
                    status = best["status"] if best["status"] not in (PolicyStatus.non_compliant.value,) else PolicyStatus.active.value
        statuses[tid] = status
        # Pick expiration date from the current policy set
        current_ids = result.get("current_ids", set())
        current = [p for p in policies if p["id"] in current_ids]
        if current:
            best_exp = max((p["expiration_date"] for p in current if p["expiration_date"]), default=None)
            exp_dates[tid] = best_exp
    return statuses, exp_dates


class HoaOut(BaseModel):
    id: str
    name: str
    address: Optional[str] = None
    subdivision: Optional[str] = None
    corp_name: Optional[str] = None
    sunbiz_doc_number: Optional[str] = None
    alert_lead_days: int = 30
    ho6_coverage_a_min: Optional[float] = None
    ho6_coverage_e_min: Optional[float] = None
    ho6_wind_required: bool = False
    ho6_additional_interest_required: bool = False
    ho6_policy_in_force_required: bool = True
    ho6_named_insured_match_required: bool = True
    ho6_property_address_match_required: bool = True


class HoaUpdate(BaseModel):
    name: str
    alert_lead_days: int = 30
    ho6_coverage_a_min: Optional[float] = None
    ho6_coverage_e_min: Optional[float] = None
    ho6_wind_required: bool = False
    ho6_additional_interest_required: bool = False
    ho6_policy_in_force_required: bool = True
    ho6_named_insured_match_required: bool = True
    ho6_property_address_match_required: bool = True


_HOA_SEARCH_FIELDS = """
    h.id,
    h.name,
    h.address,
    h.alert_lead_days,
    h.ho6_coverage_a_min,
    h.ho6_coverage_e_min,
    h.ho6_wind_required,
    h.ho6_additional_interest_required,
    h.ho6_policy_in_force_required,
    h.ho6_named_insured_match_required,
    h.ho6_property_address_match_required,
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
            address=r["address"],
            subdivision=r["subdivision"],
            corp_name=r["corp_name"],
            sunbiz_doc_number=r["sunbiz_doc_number"],
            alert_lead_days=r["alert_lead_days"] if r["alert_lead_days"] is not None else 30,
            ho6_coverage_a_min=r["ho6_coverage_a_min"],
            ho6_coverage_e_min=r["ho6_coverage_e_min"],
            ho6_wind_required=r["ho6_wind_required"],
            ho6_additional_interest_required=r["ho6_additional_interest_required"],
            ho6_policy_in_force_required=r["ho6_policy_in_force_required"],
            ho6_named_insured_match_required=r["ho6_named_insured_match_required"],
            ho6_property_address_match_required=r["ho6_property_address_match_required"],
        )
        for r in rows
    ]


class HoaRequirementsUpdate(BaseModel):
    ho6_coverage_a_min: Optional[float] = None
    ho6_coverage_e_min: Optional[float] = None
    ho6_wind_required: Optional[bool] = None
    ho6_additional_interest_required: Optional[bool] = None
    ho6_policy_in_force_required: Optional[bool] = None
    ho6_named_insured_match_required: Optional[bool] = None
    ho6_property_address_match_required: Optional[bool] = None


@router.patch("/hoa/{hoa_id}/requirements")
async def update_hoa_requirements(
    hoa_id: str,
    body: HoaRequirementsUpdate,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    await _assert_hoa_access(user, hoa_id, conn)
    fields = {k: v for k, v in body.dict().items() if v is not None}
    if fields:
        set_clause = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(fields))
        await conn.execute(
            f"UPDATE hoas SET {set_clause} WHERE id = $1",
            hoa_id, *fields.values(),
        )
    return {"ok": True}


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
            t.id AS tenant_id,
            EXISTS(SELECT 1 FROM unit_invites i WHERE i.unit_id = u.id) AS has_invite
        FROM units u
        LEFT JOIN LATERAL (
            SELECT id, name, email FROM tenants WHERE unit_id = u.id ORDER BY id LIMIT 1
        ) t ON true
        WHERE u.hoa_id = $1
        ORDER BY u.unit_number
        """,
        hoa_id,
    )

    tenant_ids = [r["tenant_id"] for r in rows if r["tenant_id"] is not None]
    hoa_reqs = dict(await conn.fetchrow("SELECT ho6_coverage_a_min, ho6_coverage_e_min, ho6_wind_required FROM hoas WHERE id = $1", hoa_id) or {})
    statuses, exp_dates = await _compliance_status_by_tenant(conn, tenant_ids, hoa_reqs)

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
            expiration_date=exp_dates.get(r["tenant_id"]),
            invite_sent=r["has_invite"],
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
        """SELECT DISTINCT ON (u.id) u.id AS unit_id, u.assoc_title, t.id AS tenant_id,
                  EXISTS(SELECT 1 FROM unit_invites i WHERE i.unit_id = u.id) AS has_invite
           FROM units u LEFT JOIN tenants t ON t.unit_id = u.id
           WHERE u.hoa_id = $1
           ORDER BY u.id, t.id""",
        hoa_id,
    )

    tenant_ids = [r["tenant_id"] for r in rows if r["tenant_id"] is not None]
    hoa_reqs = dict(await conn.fetchrow("SELECT ho6_coverage_a_min, ho6_coverage_e_min, ho6_wind_required FROM hoas WHERE id = $1", hoa_id) or {})
    statuses, exp_dates = await _compliance_status_by_tenant(conn, tenant_ids, hoa_reqs)

    total_units = board_members = 0
    compliant = expiring = lapsed = non_compliant = pending_review = missing = property_managers = 0
    invite_sent = not_invited = 0
    for r in rows:
        if (r["assoc_title"] or "").strip().lower() == "property manager":
            property_managers += 1
            continue
        total_units += 1
        if r["assoc_title"] and (r["assoc_title"] or "").strip().lower() != "property manager":
            board_members += 1
        status = statuses.get(r["tenant_id"], PolicyStatus.missing.value)
        if status in (PolicyStatus.active.value, PolicyStatus.expiring.value):
            compliant += 1  # expiring = still meets requirements, sub-indicator only
            if status == PolicyStatus.expiring.value:
                expiring += 1  # tracked separately for the sub-badge count
        elif status == PolicyStatus.non_compliant.value:
            non_compliant += 1
        elif status == PolicyStatus.lapsed.value:
            lapsed += 1
        elif status == PolicyStatus.pending_review.value:
            pending_review += 1
        else:
            missing += 1
            # No policy on file — split by whether an invite has been sent
            if r["has_invite"]:
                invite_sent += 1
            else:
                not_invited += 1

    invites_sent = await conn.fetchval(
        "SELECT COUNT(*) FROM unit_invites i JOIN units u ON u.id = i.unit_id WHERE u.hoa_id = $1",
        hoa_id,
    ) or 0

    return ComplianceSummary(
        total_units=total_units,
        board_members=board_members,
        property_managers=property_managers,
        compliant=compliant,
        expiring=expiring,
        lapsed=lapsed,
        non_compliant=non_compliant,
        pending_review=pending_review,
        missing=missing,
        invites_sent=invites_sent,
        invite_sent=invite_sent,
        not_invited=not_invited,
    )


@router.get("/hoa/{hoa_id}/compliance/trend")
async def compliance_trend(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Return monthly compliance counts for the last 6 months."""
    await _assert_hoa_access(user, hoa_id, conn)

    rows = await conn.fetch(
        """
        WITH months AS (
          SELECT
            to_char(gs, 'Mon ''YY') AS label,
            gs AS month_start,
            (gs + interval '1 month' - interval '1 second') AS month_end
          FROM generate_series(
            date_trunc('month', CURRENT_DATE - interval '5 months'),
            date_trunc('month', CURRENT_DATE),
            '1 month'::interval
          ) gs
        ),
        hoa_tenants AS (
          SELECT t.id AS tenant_id
          FROM tenants t
          JOIN units u ON u.id = t.unit_id
          WHERE u.hoa_id = $1
        )
        SELECT
          m.label,
          m.month_start::date AS month,
          COUNT(DISTINCT ht.tenant_id) AS total,
          COUNT(DISTINCT CASE
            WHEN best.expiration_date IS NOT NULL
              AND best.expiration_date > m.month_end::date
            THEN ht.tenant_id
          END) AS compliant,
          COUNT(DISTINCT CASE
            WHEN best.expiration_date IS NOT NULL
              AND best.expiration_date > m.month_end::date - interval '30 days'
              AND best.expiration_date <= m.month_end::date
            THEN ht.tenant_id
          END) AS expiring
        FROM months m
        CROSS JOIN hoa_tenants ht
        LEFT JOIN LATERAL (
          SELECT p.expiration_date
          FROM policies p
          WHERE p.tenant_id = ht.tenant_id
            AND p.uploaded_at <= m.month_end
          ORDER BY p.uploaded_at DESC
          LIMIT 1
        ) best ON true
        GROUP BY m.label, m.month_start, m.month_end
        ORDER BY m.month_start
        """,
        hoa_id,
    )

    return [
        {
            "label": r["label"],
            "total": r["total"],
            "compliant": r["compliant"],
            "expiring": r["expiring"],
            "lapsed": max(0, r["total"] - r["compliant"] - r["expiring"]),
        }
        for r in rows
    ]


class PropertyManagerCreate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    source_unit_id: Optional[str] = None  # copy subdivision/corp details from this unit


@router.post("/hoa/{hoa_id}/property-manager", status_code=201)
async def add_property_manager(
    hoa_id: str,
    body: PropertyManagerCreate,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Create a new Property Manager position in the same subdivision/association."""
    await _assert_hoa_access(user, hoa_id, conn)

    subdivision = corp_name = sunbiz = None
    if body.source_unit_id:
        src = await conn.fetchrow(
            "SELECT subdivision, corp_name, sunbiz_doc_number FROM units WHERE id = $1 AND hoa_id = $2",
            body.source_unit_id, hoa_id,
        )
        if src:
            subdivision, corp_name, sunbiz = src["subdivision"], src["corp_name"], src["sunbiz_doc_number"]

    row = await conn.fetchrow(
        """INSERT INTO units (hoa_id, unit_number, assoc_title, subdivision, corp_name,
                              sunbiz_doc_number, owner_primary, email_primary)
           VALUES ($1, 'PM', 'Property Manager', $2, $3, $4, $5, $6)
           RETURNING id""",
        hoa_id, subdivision, corp_name, sunbiz,
        (body.name or "").strip() or None,
        (body.email or "").strip() or None,
    )
    return {"unit_id": str(row["id"])}


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


@router.put("/hoa/{hoa_id}", response_model=HoaOut)
async def update_hoa(
    hoa_id: str,
    body: HoaUpdate,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    await _assert_hoa_access(user, hoa_id, conn)
    updated = await conn.fetchrow(
        """UPDATE hoas SET
            name = $1,
            alert_lead_days = $2,
            ho6_coverage_a_min = $3,
            ho6_coverage_e_min = $4,
            ho6_wind_required = $5,
            ho6_additional_interest_required = $6,
            ho6_policy_in_force_required = $7,
            ho6_named_insured_match_required = $8,
            ho6_property_address_match_required = $9
           WHERE id = $10
           RETURNING id, name, address, alert_lead_days, ho6_coverage_a_min, ho6_coverage_e_min, ho6_wind_required,
                     ho6_additional_interest_required, ho6_policy_in_force_required,
                     ho6_named_insured_match_required, ho6_property_address_match_required""",
        body.name,
        body.alert_lead_days,
        body.ho6_coverage_a_min,
        body.ho6_coverage_e_min,
        body.ho6_wind_required,
        body.ho6_additional_interest_required,
        body.ho6_policy_in_force_required,
        body.ho6_named_insured_match_required,
        body.ho6_property_address_match_required,
        hoa_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="HOA not found")
    await log_audit(conn, hoa_id, user.sub, user.email, "settings_updated", {
        "name": body.name,
        "alert_lead_days": body.alert_lead_days,
    })
    return HoaOut(
        id=str(updated["id"]),
        name=updated["name"],
        address=updated["address"],
        alert_lead_days=updated["alert_lead_days"] if updated["alert_lead_days"] is not None else 30,
        ho6_coverage_a_min=updated["ho6_coverage_a_min"],
        ho6_coverage_e_min=updated["ho6_coverage_e_min"],
        ho6_wind_required=updated["ho6_wind_required"],
        ho6_additional_interest_required=updated["ho6_additional_interest_required"],
        ho6_policy_in_force_required=updated["ho6_policy_in_force_required"],
        ho6_named_insured_match_required=updated["ho6_named_insured_match_required"],
        ho6_property_address_match_required=updated["ho6_property_address_match_required"],
    )


async def build_board_report(conn: asyncpg.Connection, hoa_id: str) -> dict | None:
    """Build the compliance board report for one HOA. Returns
    {"to_email", "subject", "html"} or None if the HOA doesn't exist.
    Shared by the manual send route and the scheduled cron run."""
    hoa_row = await conn.fetchrow("SELECT name, admin_email FROM hoas WHERE id = $1", hoa_id)
    if not hoa_row:
        return None

    rows = await conn.fetch(
        """SELECT DISTINCT ON (u.id) u.id AS unit_id, u.assoc_title, t.id AS tenant_id,
                  u.unit_number, COALESCE(t.name, u.owner_primary, 'No owner') AS display_name
           FROM units u LEFT JOIN tenants t ON t.unit_id = u.id
           WHERE u.hoa_id = $1
           ORDER BY u.id, t.id""",
        hoa_id,
    )

    tenant_ids = [r["tenant_id"] for r in rows if r["tenant_id"] is not None]
    hoa_reqs = dict(await conn.fetchrow("SELECT ho6_coverage_a_min, ho6_coverage_e_min, ho6_wind_required FROM hoas WHERE id = $1", hoa_id) or {})
    statuses, exp_dates = await _compliance_status_by_tenant(conn, tenant_ids, hoa_reqs)

    total_units = compliant = expiring = lapsed = missing = 0
    lapsed_units = []
    for r in rows:
        if (r["assoc_title"] or "").strip().lower() == "property manager":
            continue
        total_units += 1
        status = statuses.get(r["tenant_id"], PolicyStatus.missing.value)
        if status == PolicyStatus.active.value:
            compliant += 1
        elif status == PolicyStatus.expiring.value:
            expiring += 1
        elif status in (PolicyStatus.lapsed.value, PolicyStatus.non_compliant.value, PolicyStatus.pending_review.value):
            lapsed += 1
            lapsed_units.append({"unit_number": r["unit_number"], "tenant_name": r["display_name"]})
        else:
            missing += 1
            lapsed_units.append({"unit_number": r["unit_number"], "tenant_name": r["display_name"]})

    subject, html = board_report_html(
        hoa_name=hoa_row["name"],
        total_units=total_units,
        compliant=compliant,
        expiring=expiring,
        lapsed=lapsed,
        missing=missing,
        lapsed_unit_list=lapsed_units,
    )

    return {"to_email": hoa_row["admin_email"], "subject": subject, "html": html}


@router.post("/hoa/{hoa_id}/report/send")
async def send_board_report(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
    background_tasks: BackgroundTasks = None,
):
    await _assert_hoa_access(user, hoa_id, conn)

    report = await build_board_report(conn, hoa_id)
    if report is None:
        raise HTTPException(status_code=404, detail="HOA not found")

    to_email = report["to_email"] or user.email
    if not to_email:
        raise HTTPException(status_code=422, detail="No admin email on file for this HOA")

    async def _send():
        await send_email(to_email, report["subject"], report["html"])
        await log_audit(conn, hoa_id, user.sub, user.email, "board_report_sent", {"to": to_email})

    if background_tasks:
        background_tasks.add_task(_send)
    else:
        await _send()

    return {"sent": True, "to": to_email}


@router.delete("/unit/{unit_id}")
async def delete_unit(
    unit_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    row = await conn.fetchrow("SELECT hoa_id FROM units WHERE id = $1", unit_id)
    if not row:
        raise HTTPException(status_code=404, detail="Unit not found")
    await _assert_hoa_access(user, str(row["hoa_id"]), conn)

    tenant_ids = [r["id"] for r in await conn.fetch("SELECT id FROM tenants WHERE unit_id = $1", unit_id)]
    if tenant_ids:
        await conn.execute("DELETE FROM alert_log WHERE tenant_id = ANY($1::uuid[])", tenant_ids)
        await conn.execute("DELETE FROM policies WHERE tenant_id = ANY($1::uuid[])", tenant_ids)
    await conn.execute("DELETE FROM unit_invites WHERE unit_id = $1", unit_id)
    await conn.execute("DELETE FROM tenants WHERE unit_id = $1", unit_id)
    await conn.execute("DELETE FROM units WHERE id = $1", unit_id)
    return {"deleted": True}


@router.get("/hoa/{hoa_id}/export")
async def export_compliance_csv(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    await _assert_hoa_access(user, hoa_id, conn)

    unit_rows = await conn.fetch(
        """SELECT u.id AS unit_id, u.unit_number, u.street_address, u.city, u.state, u.zip,
                  u.owner_primary, u.email_primary, u.owner_secondary, u.email_secondary,
                  u.purchase_date, u.type, u.subdivision, u.corp_name, u.sunbiz_doc_number, u.fein,
                  u.radar_id, u.assessor_parcel_number,
                  t.id AS tenant_id, t.name AS tenant_name, t.email AS tenant_email
           FROM units u LEFT JOIN LATERAL (
               SELECT id, name, email FROM tenants WHERE unit_id = u.id ORDER BY id LIMIT 1
           ) t ON true
           WHERE u.hoa_id = $1 ORDER BY u.unit_number""",
        hoa_id,
    )

    tenant_ids = [r["tenant_id"] for r in unit_rows if r["tenant_id"]]
    policy_rows = await conn.fetch(
        "SELECT * FROM policies WHERE tenant_id = ANY($1::uuid[])", tenant_ids
    ) if tenant_ids else []

    by_tenant: dict = {}
    for r in policy_rows:
        by_tenant.setdefault(r["tenant_id"], []).append(dict(r))
    best_policy: dict = {}
    for tid, policies in by_tenant.items():
        evaluation = evaluate_compliance(policies)
        for p in policies:
            if p["id"] in evaluation["current_ids"]:
                best_policy[tid] = p
                break

    statuses = {tid: evaluate_compliance(ps)["status"] for tid, ps in by_tenant.items()}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Unit", "Street Address", "City", "State", "Zip",
        "Primary Owner", "Primary Email", "Secondary Owner", "Secondary Email",
        "Purchase Date", "Type", "Subdivision", "Corp Name", "SunBiz DOC #", "FEIN",
        "Radar ID", "APN",
        "Tenant Name", "Tenant Email",
        "Compliance Status", "Policy Expiration", "Insurer", "Policy Number", "Last Uploaded",
    ])
    for r in unit_rows:
        tid = r["tenant_id"]
        status = statuses.get(tid, "missing") if tid else "missing"
        bp = best_policy.get(tid) if tid else None
        writer.writerow([
            r["unit_number"], r["street_address"] or "", r["city"] or "",
            r["state"] or "", r["zip"] or "",
            r["owner_primary"] or "", r["email_primary"] or "",
            r["owner_secondary"] or "", r["email_secondary"] or "",
            r["purchase_date"].isoformat() if r["purchase_date"] else "",
            r["type"] or "", r["subdivision"] or "", r["corp_name"] or "",
            r["sunbiz_doc_number"] or "", r["fein"] or "",
            r["radar_id"] or "", r["assessor_parcel_number"] or "",
            r["tenant_name"] or "", r["tenant_email"] or "",
            status,
            bp["expiration_date"].isoformat() if bp and bp["expiration_date"] else "",
            bp["insurer"] or "" if bp else "",
            bp["policy_number"] or "" if bp else "",
            bp["uploaded_at"].isoformat() if bp else "",
        ])

    hoa_row = await conn.fetchrow("SELECT name FROM hoas WHERE id = $1", hoa_id)
    hoa_slug = re.sub(r"[^a-z0-9]+", "-", (hoa_row["name"] if hoa_row else "hoa").lower()).strip("-")
    filename = f"{hoa_slug}-compliance.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _parse_csv_address(raw: str):
    raw = (raw or "").strip()
    match = re.search(r"\b(APT|UNIT|STE|PH)\s*(\S+)", raw, re.IGNORECASE)
    if match:
        prefix = match.group(1).upper()
        identifier = match.group(2)
        unit = identifier if prefix != "PH" else f"PH{identifier}"
        street = raw[: match.start()].strip().rstrip(",")
    else:
        unit, street = "", raw
    return street or None, unit or None


@router.post("/hoa/{hoa_id}/units/import", status_code=201)
async def import_units_csv(
    hoa_id: str,
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    await _assert_hoa_access(user, hoa_id, conn)

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=422, detail="CSV is empty or has no data rows")

    headers = {h.strip() for h in (reader.fieldnames or [])}
    propradar_format = "Radar ID" in headers

    inserted = skipped = 0
    for row in rows:
        def v(key): return (row.get(key) or "").strip() or None

        if propradar_format:
            radar = v("Radar ID")
            if not radar or not re.match(r"^P[A-Z0-9]+$", radar):
                skipped += 1
                continue
            street, unit_number = _parse_csv_address(v("Address") or "")
            pd_str = v("Purchase Date")
            purchase_date = date.fromisoformat(pd_str) if pd_str else None
            await conn.execute(
                """INSERT INTO units (hoa_id, unit_number, street_address, city, state, zip,
                       radar_id, assessor_parcel_number, type, subdivision,
                       owner_primary, email_primary, owner_secondary, email_secondary, purchase_date)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                   ON CONFLICT DO NOTHING""",
                hoa_id, unit_number or v("Address"), street, v("City"), "FL", v("ZIP"),
                radar, v("APN"), v("Type"), v("Subdivision"),
                v("Primary Name"), v("Primary Email1"),
                v("Secondary Name"), v("Secondary Email1"), purchase_date,
            )
        else:
            unit_number = v("unit_number") or v("Unit") or v("Unit Number")
            if not unit_number:
                skipped += 1
                continue
            pd_str = v("purchase_date") or v("Purchase Date")
            purchase_date = date.fromisoformat(pd_str) if pd_str else None
            await conn.execute(
                """INSERT INTO units (hoa_id, unit_number, street_address, city, state, zip,
                       owner_primary, email_primary, owner_secondary, email_secondary, purchase_date)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                   ON CONFLICT DO NOTHING""",
                hoa_id, unit_number,
                v("street_address") or v("Street Address"),
                v("city") or v("City"),
                v("state") or v("State"),
                v("zip") or v("Zip") or v("ZIP"),
                v("owner_primary") or v("Primary Name"),
                v("email_primary") or v("Primary Email") or v("Primary Email1"),
                v("owner_secondary") or v("Secondary Name"),
                v("email_secondary") or v("Secondary Email") or v("Secondary Email1"),
                purchase_date,
            )
        inserted += 1

    return {"inserted": inserted, "skipped": skipped}
