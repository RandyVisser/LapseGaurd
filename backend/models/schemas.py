from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import date, datetime
from enum import Enum
import uuid


class PolicyStatus(str, Enum):
    active = "active"
    expiring = "expiring"
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
    policies: list[PolicyOut]
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
    purchase_date: Optional[date]
    tenant_id: Optional[uuid.UUID]
    status: PolicyStatus


class ComplianceSummary(BaseModel):
    total_units: int
    board_members: int
    property_managers: int
    compliant: int
    expiring: int
    lapsed: int
    missing: int


class DocumentCreate(BaseModel):
    name: str
    file_url: str


class DocumentOut(BaseModel):
    id: uuid.UUID
    hoa_id: uuid.UUID
    name: str
    file_url: str
    uploaded_by: Optional[uuid.UUID]
    created_at: datetime
