from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from datetime import date, timedelta, timezone, datetime
from typing import Optional
import hashlib
import json
import logging
import os
import asyncpg
import httpx

from models.schemas import PolicyCreate, PolicyOut, PolicyStatus
from models.db import get_conn, get_pool
from auth.jwt import AuthUser, get_current_user, require_hoa_admin
from services.policy_parser import parse_dec_page
from services.email import send_email, policy_upload_notification_html
from services.storage import signed_url, fetch_bytes, object_path
from routes.hoa import _assert_hoa_access

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
APP_URL = os.environ.get("APP_URL", "https://condo.insure")
POLICY_BUCKET = "policy-documents"

router = APIRouter()

logger = logging.getLogger(__name__)


def _require_storage_url(url: str | None):
    """Reject document references the backend can't resolve to our own storage.
    Accepts a bare object path or a legacy full Supabase storage URL; anything
    that still carries a scheme after normalization (a foreign URL) is rejected.
    The actual fetch is structurally safe regardless — it always targets our
    bucket — but this gives a clean 422 for bad input."""
    if url is None:
        return
    path = object_path(url, POLICY_BUCKET)
    if path is None or "://" in path:
        raise HTTPException(status_code=422, detail="document_url must point to Supabase storage")


async def _policy_out(row, *, sign: bool = True) -> PolicyOut:
    """Build a PolicyOut, replacing the stored document path with a short-lived
    signed URL so the frontend can open it from a private bucket."""
    d = dict(row)
    doc = await signed_url(d.get("document_url"), POLICY_BUCKET) if sign else d.get("document_url")
    extracted = d.get("extracted_data")
    if isinstance(extracted, str):
        extracted = json.loads(extracted)
    overrides = d.get("review_overrides")
    if isinstance(overrides, str):
        overrides = json.loads(overrides)
    return PolicyOut(
        id=d["id"],
        tenant_id=d["tenant_id"],
        insurer=d.get("insurer"),
        policy_number=d.get("policy_number"),
        expiration_date=d.get("expiration_date"),
        status=d["status"],
        document_url=doc,
        uploaded_at=d["uploaded_at"],
        extracted_data=extracted or None,
        parsed_at=d.get("parsed_at"),
        coverage_type=d.get("coverage_type"),
        review_overrides=overrides or {},
    )


def _compute_status(expiration_date: date | None) -> PolicyStatus:
    if expiration_date is None:
        return PolicyStatus.missing
    today = date.today()
    if expiration_date < today:
        return PolicyStatus.lapsed
    if expiration_date <= today + timedelta(days=30):
        return PolicyStatus.expiring
    return PolicyStatus.active


class UnitOwnerUpdate(BaseModel):
    owner_primary: Optional[str] = None
    owner_secondary: Optional[str] = None
    email_primary: Optional[str] = None
    email_secondary: Optional[str] = None
    assoc_title: Optional[str] = None  # board role (President, VP, etc.); "" clears it


@router.patch("/unit/{unit_id}/owner")
async def update_unit_owner(
    unit_id: str,
    body: UnitOwnerUpdate,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Correct unit-owner names/emails and the board title (typo fixes, new owner,
    or amending who sits on the board)."""
    unit = await conn.fetchrow("SELECT hoa_id, assoc_title FROM units WHERE id = $1", unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    await _assert_hoa_access(user, str(unit["hoa_id"]), conn)

    # Board title edits never convert a unit to/from a Property Manager position
    new_title = (body.assoc_title or "").strip() or None
    if (new_title or "").lower() == "property manager" or (unit["assoc_title"] or "").strip().lower() == "property manager":
        new_title = unit["assoc_title"]

    email_primary = (body.email_primary or "").strip() or None
    email_secondary = (body.email_secondary or "").strip() or None

    await conn.execute(
        """UPDATE units SET
               owner_primary = $2,
               owner_secondary = $3,
               email_primary = $4,
               email_secondary = $5,
               assoc_title = $6
           WHERE id = $1""",
        unit_id,
        (body.owner_primary or "").strip() or None,
        (body.owner_secondary or "").strip() or None,
        email_primary,
        email_secondary,
        new_title,
    )

    # If the owner was replaced (email no longer matches), a still-pending invite
    # to the prior owner is stale — drop it so the unit stops showing "Invite
    # Sent" for someone who's no longer the owner. A plain typo fix (same email)
    # keeps its invite, and accepted invites are always left intact.
    current_emails = [e.lower() for e in (email_primary, email_secondary) if e]
    await conn.execute(
        """DELETE FROM unit_invites
           WHERE unit_id = $1 AND accepted_at IS NULL
             AND lower(email) <> ALL($2::text[])""",
        unit_id,
        current_emails,
    )
    return {"updated": True}


class NewOwnerUpdate(BaseModel):
    owner_primary: Optional[str] = None
    email_primary: Optional[str] = None
    owner_secondary: Optional[str] = None
    email_secondary: Optional[str] = None


@router.post("/unit/{unit_id}/new-owner")
async def replace_unit_owner(
    unit_id: str,
    body: NewOwnerUpdate,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Unit sold / new owner. Replaces the owner details, and clears the prior
    owner's login account, policies, and any pending invites so the unit starts
    fresh — the new owner must be invited and upload their own policy."""
    unit = await conn.fetchrow("SELECT hoa_id FROM units WHERE id = $1", unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    await _assert_hoa_access(user, str(unit["hoa_id"]), conn)

    # Removing the tenant cascades to that owner's policies; invites are keyed
    # to the unit, so clear them too (resets the unit to "Not Invited Yet").
    await conn.execute("DELETE FROM tenants WHERE unit_id = $1", unit_id)
    await conn.execute("DELETE FROM unit_invites WHERE unit_id = $1", unit_id)
    await conn.execute(
        """UPDATE units SET
               owner_primary = $2,
               email_primary = $3,
               owner_secondary = $4,
               email_secondary = $5
           WHERE id = $1""",
        unit_id,
        (body.owner_primary or "").strip() or None,
        (body.email_primary or "").strip() or None,
        (body.owner_secondary or "").strip() or None,
        (body.email_secondary or "").strip() or None,
    )
    return {"updated": True}


@router.get("/unit/{unit_id}/policy", response_model=PolicyOut | None)
async def get_policy(
    unit_id: str,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    if user.role in ("hoa_admin", "super_user", "property_manager"):
        unit = await conn.fetchrow("SELECT hoa_id FROM units WHERE id = $1", unit_id)
        if unit is None:
            raise HTTPException(status_code=404, detail="Unit not found")
        await _assert_hoa_access(user, str(unit["hoa_id"]), conn)
        tenant = await conn.fetchrow("SELECT id FROM tenants WHERE unit_id = $1", unit_id)
    else:
        tenant = await conn.fetchrow(
            "SELECT id FROM tenants WHERE unit_id = $1 AND (supabase_user_id = $2 OR email = $3)",
            unit_id, user.sub, user.email,
        )
    if tenant is None:
        raise HTTPException(status_code=403, detail="Not your unit")

    row = await conn.fetchrow(
        """SELECT * FROM policies WHERE tenant_id = $1 AND superseded_by IS NULL
           ORDER BY
               CASE status WHEN 'active' THEN 0 WHEN 'expiring' THEN 1 WHEN 'pending_review' THEN 2 WHEN 'lapsed' THEN 3 ELSE 4 END,
               expiration_date DESC NULLS LAST,
               uploaded_at DESC
           LIMIT 1""",
        tenant["id"],
    )
    if row is None:
        return None
    return await _policy_out(row)


async def _hash_document(document_url: str) -> str | None:
    """Fetch the uploaded document and return a SHA-256 hex digest of its bytes,
    used to detect accidental re-uploads of the same file. Fetches via the
    service role so it works on private buckets."""
    fetched = await fetch_bytes(document_url, POLICY_BUCKET)
    if fetched is None:
        return None
    content, _ = fetched
    return hashlib.sha256(content).hexdigest()


def _auto_review_overrides(extracted: dict, submitted: dict, coverage_type: str, has_wind_only_companion: bool) -> dict:
    """Automatically evaluate each HO-6 requirement against the parsed dec page
    and association settings, returning a dict of {check_key: 'pass'|'fail'}.
    Only includes keys that can be confidently determined from extracted data."""
    flags = (extracted.get("validation") or {}).get("flags") or []
    flags_text = " | ".join(flags)
    result = {}

    # Policy In-Force — based on expiration date
    exp = extracted.get("expiration_date") or submitted.get("expiration_date")
    if exp:
        try:
            exp_date = date.fromisoformat(str(exp)[:10])
            result["policy_in_force"] = "pass" if exp_date >= date.today() else "fail"
        except (TypeError, ValueError):
            pass

    # Named Insured Matches — owner must appear as named insured OR any additional insured
    if submitted.get("named_insured") and (extracted.get("named_insured") or extracted.get("additional_insureds")):
        result["named_insured_match"] = "fail" if "Named insured mismatch" in flags_text else "pass"

    # Property Address Matches
    if submitted.get("address") and extracted.get("property_address"):
        result["property_address_match"] = "fail" if "Property address mismatch" in flags_text else "pass"

    # Coverage A (Dwelling) min
    a_min = submitted.get("ho6_coverage_a_min")
    dwelling = extracted.get("dwelling_coverage")
    if a_min is not None:
        if dwelling is not None:
            try:
                result["coverage_a_min"] = "pass" if float(dwelling) >= float(a_min) else "fail"
            except (TypeError, ValueError):
                pass
        else:
            result["coverage_a_min"] = "fail"
    elif dwelling is not None:
        result["coverage_a_min"] = "pass"

    # Coverage E (Liability) min
    e_min = submitted.get("ho6_coverage_e_min")
    liability = extracted.get("liability_coverage")
    if e_min is not None:
        if liability is not None:
            try:
                result["coverage_e_min"] = "pass" if float(liability) >= float(e_min) else "fail"
            except (TypeError, ValueError):
                pass
        else:
            result["coverage_e_min"] = "fail"
    elif liability is not None:
        result["coverage_e_min"] = "pass"

    # Wind Coverage
    if coverage_type in ("ho6_with_wind", "wind_only"):
        result["wind_coverage"] = "pass"
    elif coverage_type == "ho6_wind_excluded":
        result["wind_coverage"] = "pass" if has_wind_only_companion else "fail"

    return result


async def _run_parsing(policy_id: str, document_url: str, submitted: dict):
    try:
        extracted = await parse_dec_page(document_url, submitted)
        if extracted:
            coverage_type = extracted.get("coverage_type")
            if coverage_type not in ("ho6_with_wind", "ho6_wind_excluded", "wind_only", "unknown"):
                coverage_type = "unknown"

            pool = await get_pool()
            async with pool.acquire() as conn:
                has_wind_only_companion = True
                if coverage_type == "ho6_wind_excluded":
                    policy_row = await conn.fetchrow(
                        "SELECT tenant_id FROM policies WHERE id = $1", policy_id
                    )
                    if policy_row:
                        wind_policy = await conn.fetchrow(
                            "SELECT id FROM policies WHERE tenant_id = $1 AND coverage_type = 'wind_only' AND id != $2",
                            policy_row["tenant_id"], policy_id,
                        )
                        has_wind_only_companion = wind_policy is not None
                        if not wind_policy:
                            validation = extracted.get("validation") or {"passed": True, "flags": []}
                            validation.setdefault("flags", [])
                            validation["flags"].append(
                                "Wind coverage excluded — no separate Wind-Only policy on file for this unit-owner"
                            )
                            validation["passed"] = False
                            extracted["validation"] = validation

                auto_results = _auto_review_overrides(extracted, submitted, coverage_type, has_wind_only_companion)
                now_iso = datetime.now(timezone.utc).isoformat()

                existing_row = await conn.fetchrow(
                    "SELECT review_overrides, insurer, policy_number FROM policies WHERE id = $1", policy_id
                )
                overrides = existing_row["review_overrides"] if existing_row else None
                if isinstance(overrides, str):
                    overrides = json.loads(overrides)
                overrides = dict(overrides or {})
                for key, value in auto_results.items():
                    overrides[key] = {"value": value, "by": "AI (Run AI on Document)", "at": now_iso}

                # Promote extracted fields to top-level policy columns
                extra_updates = {}
                # Always write expiration_date + recompute status from AI extraction
                exp_str = extracted.get("expiration_date")
                validation = extracted.get("validation") or {}
                validation_passed = validation.get("passed", True)
                validation_flags = validation.get("flags", [])
                if exp_str:
                    try:
                        exp_date = date.fromisoformat(str(exp_str)[:10])
                        extra_updates["expiration_date"] = exp_date
                        computed = _compute_status(exp_date)
                        # If policy isn't already lapsed/expired but validation failed, mark non_compliant
                        if not validation_passed and computed.value in (
                            PolicyStatus.active.value, PolicyStatus.expiring.value
                        ):
                            extra_updates["status"] = PolicyStatus.non_compliant.value
                        else:
                            extra_updates["status"] = computed.value
                    except (ValueError, TypeError):
                        pass
                elif not validation_passed:
                    # No expiration date extracted but validation still failed
                    extra_updates["status"] = PolicyStatus.non_compliant.value
                # Fill insurer / policy_number only if the column is currently blank
                if extracted.get("insurer") and not existing_row["insurer"]:
                    extra_updates["insurer"] = extracted["insurer"]
                if extracted.get("policy_number") and not existing_row["policy_number"]:
                    extra_updates["policy_number"] = extracted["policy_number"]

                set_parts = "extracted_data = $1, parsed_at = $2, coverage_type = $3, review_overrides = $4"
                params = [json.dumps(extracted), datetime.now(timezone.utc), coverage_type, json.dumps(overrides)]
                for col, val in extra_updates.items():
                    params.append(val)
                    set_parts += f", {col} = ${len(params)}"
                params.append(policy_id)
                await conn.execute(
                    f"UPDATE policies SET {set_parts} WHERE id = ${len(params)}",
                    *params,
                )

                await _resolve_superseded(conn, policy_id)
    except Exception as e:
        logger.error(f"Failed to parse dec page for policy {policy_id}: {e}")


async def _resolve_superseded(conn, policy_id: str):
    """After a document parses, work out which policy is authoritative for its
    coverage type. Owners upload renewals, endorsements, and duplicates — the
    doc with the latest expiration date wins; the rest become history."""
    new_row = await conn.fetchrow(
        "SELECT tenant_id, coverage_type, policy_number, expiration_date FROM policies WHERE id = $1",
        policy_id,
    )
    if not new_row or not new_row["expiration_date"] or new_row["coverage_type"] in (None, "unknown"):
        return

    # Mark older docs for the same coverage (or same policy number) as superseded
    await conn.execute(
        """UPDATE policies SET superseded_by = $1
           WHERE tenant_id = $2 AND id != $1 AND superseded_by IS NULL
             AND (coverage_type = $3 OR (policy_number IS NOT NULL AND policy_number = $4))
             AND expiration_date IS NOT NULL AND expiration_date < $5""",
        policy_id, new_row["tenant_id"], new_row["coverage_type"],
        new_row["policy_number"], new_row["expiration_date"],
    )

    # If a newer doc already exists for this coverage, this upload is the superseded one
    newer = await conn.fetchrow(
        """SELECT id FROM policies
           WHERE tenant_id = $2 AND id != $1 AND superseded_by IS NULL
             AND coverage_type = $3 AND expiration_date > $4
           ORDER BY expiration_date DESC LIMIT 1""",
        policy_id, new_row["tenant_id"], new_row["coverage_type"], new_row["expiration_date"],
    )
    if newer:
        await conn.execute(
            "UPDATE policies SET superseded_by = $1 WHERE id = $2", newer["id"], policy_id
        )


@router.post("/unit/{unit_id}/policy", response_model=PolicyOut)
async def upload_policy(
    unit_id: str,
    body: PolicyCreate,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    _require_storage_url(body.document_url)
    # Store a bare object path (not a public URL) so reads go through signed URLs
    doc_ref = object_path(body.document_url, POLICY_BUCKET)

    # Verify tenant belongs to this unit (match by user id or email, like /tenant/me)
    tenant = await conn.fetchrow(
        "SELECT id FROM tenants WHERE unit_id = $1 AND (supabase_user_id = $2 OR email = $3)",
        unit_id,
        user.sub,
        user.email,
    )
    if tenant is None and user.role not in ("hoa_admin", "super_user", "property_manager"):
        raise HTTPException(status_code=403, detail="Not your unit")

    # For admin posting on behalf of tenant, verify the unit is in their HOA first
    if tenant is None:
        unit_scope = await conn.fetchrow("SELECT hoa_id FROM units WHERE id = $1", unit_id)
        if unit_scope is None:
            raise HTTPException(status_code=404, detail="Unit not found")
        await _assert_hoa_access(user, str(unit_scope["hoa_id"]), conn)
        tenant = await conn.fetchrow("SELECT id FROM tenants WHERE unit_id = $1", unit_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="No tenant found for this unit")

    if body.expiration_date and body.expiration_date < date.today():
        raise HTTPException(
            status_code=422,
            detail=f"Policy is already expired — expiration date {body.expiration_date} is in the past. Please upload a current policy."
        )

    # Look up unit details for AI cross-checking (named insured + address)
    unit_row = await conn.fetchrow(
        "SELECT owner_primary, owner_secondary, street_address, unit_number, city, state, zip, hoa_id FROM units WHERE id = $1",
        unit_id,
    )

    hoa_row = None
    if unit_row:
        hoa_row = await conn.fetchrow(
            "SELECT ho6_coverage_a_min, ho6_coverage_e_min, ho6_wind_required FROM hoas WHERE id = $1",
            unit_row["hoa_id"],
        )

    # Uploaded proof of insurance always goes to pending review for admin sign-off
    status = PolicyStatus.pending_review if doc_ref else _compute_status(body.expiration_date)

    # Detect accidental re-uploads of the exact same file for this tenant
    document_hash = None
    if doc_ref:
        document_hash = await _hash_document(doc_ref)
        if document_hash:
            dupe = await conn.fetchrow(
                "SELECT id FROM policies WHERE tenant_id = $1 AND document_hash = $2",
                tenant["id"], document_hash,
            )
            if dupe:
                raise HTTPException(
                    status_code=409,
                    detail="This document has already been uploaded for this unit-owner — no need to upload it again."
                )

    row = await conn.fetchrow(
        """
        INSERT INTO policies (tenant_id, insurer, policy_number, expiration_date, status, document_url, document_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        """,
        tenant["id"],
        body.insurer,
        body.policy_number,
        body.expiration_date,
        status.value,
        doc_ref,
        document_hash,
    )

    policy = await _policy_out(row)

    if doc_ref:
        unit_address = None
        if unit_row and unit_row["street_address"]:
            parts = [unit_row["street_address"]]
            if unit_row["unit_number"]:
                parts.append(f"Unit {unit_row['unit_number']}")
            addr = ", ".join(parts)
            cs = " ".join(filter(None, [unit_row["city"], unit_row["state"]]))
            if cs:
                addr += f", {cs}"
            if unit_row["zip"]:
                addr += f" {unit_row['zip']}"
            unit_address = addr

        submitted = {
            "insurer": body.insurer,
            "policy_number": body.policy_number,
            "expiration_date": str(body.expiration_date) if body.expiration_date else None,
            "named_insured": (unit_row["owner_primary"] or unit_row["owner_secondary"]) if unit_row else None,
            "address": unit_address,
            "ho6_coverage_a_min": hoa_row["ho6_coverage_a_min"] if hoa_row else None,
            "ho6_coverage_e_min": hoa_row["ho6_coverage_e_min"] if hoa_row else None,
            "ho6_wind_required": hoa_row["ho6_wind_required"] if hoa_row else False,
        }
        background_tasks.add_task(_run_parsing, str(row["id"]), doc_ref, submitted)

        # Notify admin when a tenant uploads (not when admin uploads on behalf of tenant)
        if user.role == "tenant" and unit_row:
            hoa_row_full = await conn.fetchrow(
                "SELECT admin_email, name FROM hoas WHERE id = $1", unit_row["hoa_id"]
            )
            if hoa_row_full and hoa_row_full["admin_email"]:
                tenant_row = await conn.fetchrow("SELECT name FROM tenants WHERE id = $1", tenant["id"])
                tenant_name = tenant_row["name"] if tenant_row else user.email
                tenant_url = f"{APP_URL}/admin/tenant/{tenant['id']}"
                subject, html = policy_upload_notification_html(
                    tenant_name,
                    unit_row["unit_number"] or unit_id,
                    hoa_row_full["name"],
                    tenant_url,
                )
                background_tasks.add_task(send_email, hoa_row_full["admin_email"], subject, html)

    return policy


class PolicyEdit(BaseModel):
    insurer: Optional[str] = None
    policy_number: Optional[str] = None
    expiration_date: Optional[date] = None
    effective_date: Optional[str] = None
    coverage_type: Optional[str] = None
    document_url: Optional[str] = None
    # extracted_data fields
    named_insured: Optional[str] = None
    additional_insured: Optional[str] = None
    additional_interests: Optional[str] = None
    dwelling_coverage: Optional[float] = None
    liability_coverage: Optional[float] = None
    # review override shortcut
    association_listed: Optional[bool] = None


@router.patch("/policy/{policy_id}", response_model=PolicyOut)
async def edit_policy(
    policy_id: str,
    body: PolicyEdit,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Admin edits policy fields directly (carrier, dates, coverage amounts, etc.)."""
    _require_storage_url(body.document_url)
    row = await conn.fetchrow(
        """SELECT p.*, u.hoa_id FROM policies p
           JOIN tenants t ON t.id = p.tenant_id
           JOIN units u ON u.id = t.unit_id
           WHERE p.id = $1""",
        policy_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Policy not found")
    if user.hoa_id and str(row["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")

    updates: dict = {}

    # Direct policy fields
    if body.insurer is not None:
        updates["insurer"] = body.insurer
    if body.policy_number is not None:
        updates["policy_number"] = body.policy_number
    if body.coverage_type is not None:
        updates["coverage_type"] = body.coverage_type
    if body.document_url is not None:
        updates["document_url"] = object_path(body.document_url, POLICY_BUCKET)

    # Expiration date — also recompute status
    exp = body.expiration_date if body.expiration_date is not None else row["expiration_date"]
    if body.expiration_date is not None:
        updates["expiration_date"] = body.expiration_date
    if exp is not None:
        updates["status"] = _compute_status(exp).value

    # Merge extracted_data with new values
    extracted_patch = {k: v for k, v in {
        "named_insured": body.named_insured,
        "additional_insured": body.additional_insured,
        "additional_interests": body.additional_interests,
        "effective_date": body.effective_date,
        "dwelling_coverage": body.dwelling_coverage,
        "liability_coverage": body.liability_coverage,
    }.items() if v is not None}

    if extracted_patch:
        existing = {}
        if row["extracted_data"]:
            existing = json.loads(row["extracted_data"]) if isinstance(row["extracted_data"], str) else dict(row["extracted_data"] or {})
        existing.update(extracted_patch)
        updates["extracted_data"] = json.dumps(existing)

    # Association listed → review_overrides shortcut
    if body.association_listed is not None:
        overrides = row["review_overrides"]
        if isinstance(overrides, str):
            overrides = json.loads(overrides)
        overrides = dict(overrides or {})
        overrides["association_additional_interest"] = {
            "value": "pass" if body.association_listed else "fail",
            "by": user.email,
            "at": datetime.now(timezone.utc).isoformat(),
        }
        updates["review_overrides"] = json.dumps(overrides)

    if updates:
        set_clause = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(updates))
        row = await conn.fetchrow(
            f"UPDATE policies SET {set_clause} WHERE id = $1 RETURNING *",
            policy_id, *updates.values(),
        )

    return await _policy_out(row)


@router.delete("/policy/{policy_id}")
async def delete_policy(
    policy_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Admin deletes a policy record (e.g. accidental upload, duplicate, bad entry)."""
    row = await conn.fetchrow(
        """SELECT p.id, u.hoa_id
           FROM policies p
           JOIN tenants t ON t.id = p.tenant_id
           JOIN units u ON u.id = t.unit_id
           WHERE p.id = $1""",
        policy_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Policy not found")
    if user.hoa_id and str(row["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")

    await conn.execute("DELETE FROM policies WHERE id = $1", policy_id)
    return {"deleted": True}


@router.post("/policy/{policy_id}/approve", response_model=PolicyOut)
async def approve_policy(
    policy_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Admin marks a pending-review policy as reviewed; status is recomputed from expiration date."""
    row = await conn.fetchrow(
        """SELECT p.*, u.hoa_id FROM policies p
           JOIN tenants t ON t.id = p.tenant_id
           JOIN units u ON u.id = t.unit_id
           WHERE p.id = $1""",
        policy_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Policy not found")
    if user.hoa_id and str(row["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")

    new_status = _compute_status(row["expiration_date"])

    updated = await conn.fetchrow(
        "UPDATE policies SET status = $1 WHERE id = $2 RETURNING *",
        new_status.value,
        policy_id,
    )

    return await _policy_out(updated)


@router.post("/policy/{policy_id}/run-ai", response_model=PolicyOut)
async def run_ai_on_policy(
    policy_id: str,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Manually (re-)run AI dec page parsing on a policy's attached document."""
    row = await conn.fetchrow(
        """
        SELECT p.*, u.owner_primary, u.owner_secondary, u.street_address, u.unit_number,
               u.city, u.state, u.zip, u.hoa_id
        FROM policies p
        JOIN tenants t ON t.id = p.tenant_id
        JOIN units u ON u.id = t.unit_id
        WHERE p.id = $1
        """,
        policy_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Policy not found")
    if user.hoa_id and str(row["hoa_id"]) != user.hoa_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if not row["document_url"]:
        raise HTTPException(status_code=422, detail="This policy has no attached document to parse")

    hoa_row = await conn.fetchrow(
        "SELECT ho6_coverage_a_min, ho6_coverage_e_min, ho6_wind_required FROM hoas WHERE id = $1",
        row["hoa_id"],
    )

    unit_address = None
    if row["street_address"]:
        parts = [row["street_address"]]
        if row["unit_number"]:
            parts.append(f"Unit {row['unit_number']}")
        addr = ", ".join(parts)
        cs = " ".join(filter(None, [row["city"], row["state"]]))
        if cs:
            addr += f", {cs}"
        if row["zip"]:
            addr += f" {row['zip']}"
        unit_address = addr

    submitted = {
        "insurer": row["insurer"],
        "policy_number": row["policy_number"],
        "expiration_date": str(row["expiration_date"]) if row["expiration_date"] else None,
        "named_insured": row["owner_primary"] or row["owner_secondary"],
        "address": unit_address,
        "ho6_coverage_a_min": hoa_row["ho6_coverage_a_min"] if hoa_row else None,
        "ho6_coverage_e_min": hoa_row["ho6_coverage_e_min"] if hoa_row else None,
        "ho6_wind_required": hoa_row["ho6_wind_required"] if hoa_row else False,
    }

    background_tasks.add_task(_run_parsing, str(row["id"]), row["document_url"], submitted)

    return await _policy_out(row)
