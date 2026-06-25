from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import date, datetime
from enum import Enum
import uuid


class PolicyStatus(str, Enum):
    active = "active"
    expiring = "expiring"
    non_compliant = "non_compliant"
    lapsed = "lapsed"
    missing = "missing"
    pending_review = "pending_review"


class PolicyCreate(BaseModel):
    insurer: Optional[str] = None
    policy_number: Optional[str] = None
    expiration_date: Optional[date] = None
    document_url: Optional[str] = None


class PolicyOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    insurer: Optional[str]
    policy_number: Optional[str]
    expiration_date: Optional[date]
    status: PolicyStatus
    document_url: Optional[str]
    uploaded_at: datetime
    extracted_data: Optional[dict] = None
    parsed_at: Optional[datetime] = None
    coverage_type: Optional[str] = None
    is_current: bool = False
    review_overrides: dict = {}
    superseded_by: Optional[uuid.UUID] = None


class ActivityLogEntry(BaseModel):
    id: str
    description: str
    timestamp: datetime
    actor: Optional[str] = None


class TenantDetailOut(BaseModel):
    tenant_id: uuid.UUID
    unit_id: uuid.UUID
    unit_number: str
    name: str
    email: str
    phone: Optional[str] = None
    hoa_id: Optional[uuid.UUID] = None
    hoa_name: Optional[str] = None
    street_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    owner_primary: Optional[str] = None
    owner_secondary: Optional[str] = None
    email_primary: Optional[str] = None
    email_secondary: Optional[str] = None
    policies: list[PolicyOut]
    compliance_status: Optional[str] = None  # authoritative rental-aware overall status
    is_rental: bool = False
    is_renter: bool = False
    has_lease: bool = False
    lease_summary: Optional[dict] = None  # AI-extracted lease fields
    rental_endorsement_required: bool = True
    needs_wind_policy: bool = False
    ho6_coverage_a_min: Optional[float] = None
    ho6_coverage_e_min: Optional[float] = None
    ho6_wind_required: bool = False
    ho6_additional_interest_required: bool = False
    ho6_policy_in_force_required: bool = True
    ho6_named_insured_match_required: bool = True
    ho6_property_address_match_required: bool = True
    activity_log: list[ActivityLogEntry] = []


class TenantOut(BaseModel):
    id: uuid.UUID
    unit_id: uuid.UUID
    name: str
    email: str
    created_at: datetime


class UnitComplianceOut(BaseModel):
    unit_id: uuid.UUID
    unit_number: str
    street_address: Optional[str]
    city: Optional[str]
    state: Optional[str]
    zip: Optional[str]
    radar_id: Optional[str]
    assessor_parcel_number: Optional[str]
    type: Optional[str]
    is_rental: bool = False
    is_renter: bool = False
    subdivision: Optional[str]
    corp_name: Optional[str]
    assoc_title: Optional[str]
    sunbiz_doc_number: Optional[str]
    fein: Optional[str]
    owner_primary: Optional[str]
    email_primary: Optional[str]
    tenant_name: Optional[str]
    tenant_email: Optional[str]
    owner_secondary: Optional[str]
    email_secondary: Optional[str]
    phone_primary: Optional[str] = None
    phone_secondary: Optional[str] = None
    purchase_date: Optional[date]
    tenant_id: Optional[uuid.UUID]
    status: PolicyStatus
    expiration_date: Optional[date] = None
    invite_sent: bool = False
    account_status: str = "not_invited"  # verified | invited | not_invited
    email_bounced: bool = False


class ComplianceSummary(BaseModel):
    total_units: int
    board_members: int
    rented_units: int = 0  # parent units flagged as rented
    admins: int = 0  # unit-owners whose email matches the association admin
    property_managers: int = 0  # kept for backwards compat, always 0
    compliant: int
    expiring: int = 0
    lapsed: int
    non_compliant: int = 0
    pending_review: int = 0
    missing: int
    invites_sent: int = 0  # invites issued for this HOA's units (getting-started checklist)
    invite_sent: int = 0   # units with no policy that have been invited
    not_invited: int = 0   # units with no policy and no invite sent
    documents_count: int = 0  # shared association documents on file


class DocumentCreate(BaseModel):
    name: str
    file_url: str
    doc_type: Optional[str] = None
    metadata: Optional[dict] = None


class DocumentOut(BaseModel):
    id: uuid.UUID
    hoa_id: uuid.UUID
    name: str
    file_url: str
    doc_type: Optional[str] = None
    metadata: Optional[dict] = None
    uploaded_by: Optional[uuid.UUID]
    created_at: datetime
    fillable: bool = False  # has a pre-fill coordinate map (e.g. Sprinkler Alarm Form)
