"""
Stripe billing — fully built but DORMANT until you turn it on.

Nothing here gates any existing flow. With BILLING_ENABLED unset/false:
  - the read endpoint still works and just reports {"enabled": false}
  - checkout / portal return 503 "Billing is not enabled yet"
  - the webhook returns 503
  - assert_billing_ok() (the future paywall hook) is a no-op and is not yet
    called from anywhere.

To flip it on later:
  1. Set env (test mode first): STRIPE_SECRET_KEY, STRIPE_PRICE_ID,
     STRIPE_WEBHOOK_SECRET, BILLING_ENABLED=true
  2. Create a recurring per-unit Price in Stripe (quantity = unit count)
  3. Register the webhook at POST {API_URL}/billing/webhook
  4. Frontend: set VITE_BILLING_ENABLED=true to reveal the Billing panel
  5. When ready to actually paywall, call assert_billing_ok() in the flows you
     want to restrict (it already knows how to 402 unpaid associations).

Model: one subscription per association, quantity = billable unit count
(property-manager placeholder units excluded). Founding/pilot pricing is just a
different Stripe Price — set hoas.stripe_price_id to override the env default.
"""
import logging
import os

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request

from auth.jwt import AuthUser, require_hoa_admin
from models.db import get_conn
from services.email import APP_URL

router = APIRouter()
logger = logging.getLogger(__name__)

BILLING_ENABLED = os.environ.get("BILLING_ENABLED", "").lower() == "true"
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
DEFAULT_UNIT_RATE_CENTS = int(os.environ.get("UNIT_RATE_CENTS", "100"))  # $1.00/unit/mo

try:
    import stripe  # optional dep; absent locally is fine while dormant
    if STRIPE_SECRET_KEY:
        stripe.api_key = STRIPE_SECRET_KEY
except ImportError:  # pragma: no cover
    stripe = None

# Stripe subscription.status values that mean "paid / in good standing"
_GOOD_STANDING = {"active", "trialing"}


def _require_live():
    if not (BILLING_ENABLED and stripe and STRIPE_SECRET_KEY):
        raise HTTPException(status_code=503, detail="Billing is not enabled yet.")


async def _authz_hoa(conn: asyncpg.Connection, user: AuthUser, hoa_id: str):
    """Load the association and ensure this admin may manage its billing.
    super_user: any; property_manager: their assigned HOAs; hoa_admin: own."""
    hoa = await conn.fetchrow(
        """SELECT id, name, admin_email, stripe_customer_id, stripe_subscription_id,
                  stripe_price_id, billing_status
           FROM hoas WHERE id = $1""",
        hoa_id,
    )
    if not hoa:
        raise HTTPException(status_code=404, detail="HOA not found")
    if user.role == "super_user":
        return hoa
    if user.role == "property_manager":
        ok = await conn.fetchval(
            "SELECT 1 FROM property_manager_hoas WHERE supabase_user_id = $1 AND hoa_id = $2",
            user.sub, hoa_id,
        )
        if ok:
            return hoa
        raise HTTPException(status_code=403, detail="Access denied to this HOA")
    if str(user.hoa_id or "") == str(hoa_id):
        return hoa
    raise HTTPException(status_code=403, detail="Access denied to this HOA")


async def _billable_units(conn: asyncpg.Connection, hoa_id: str) -> int:
    return await conn.fetchval(
        """SELECT count(*) FROM units
           WHERE hoa_id = $1 AND lower(coalesce(assoc_title, '')) <> 'property manager'
             AND parent_unit_id IS NULL""",
        hoa_id,
    ) or 0


# ── Read: always works, even while dormant ──────────────────────────────────
@router.get("/hoa/{hoa_id}/billing")
async def get_billing(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    hoa = await _authz_hoa(conn, user, hoa_id)
    units = await _billable_units(conn, hoa_id)
    rate = DEFAULT_UNIT_RATE_CENTS
    return {
        "enabled": BILLING_ENABLED,
        "status": hoa["billing_status"] or "none",
        "in_good_standing": (hoa["billing_status"] or "none") in _GOOD_STANDING,
        "units": units,
        "unit_rate_cents": rate,
        "monthly_cents": units * rate,
        "has_subscription": bool(hoa["stripe_subscription_id"]),
    }


# ── Subscribe: hosted Stripe Checkout (no card data touches us) ──────────────
@router.post("/hoa/{hoa_id}/billing/checkout")
async def create_checkout(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    _require_live()
    hoa = await _authz_hoa(conn, user, hoa_id)
    price_id = hoa["stripe_price_id"] or STRIPE_PRICE_ID
    if not price_id:
        raise HTTPException(status_code=503, detail="No Stripe price configured")
    units = await _billable_units(conn, hoa_id)

    customer_id = hoa["stripe_customer_id"]
    if not customer_id:
        customer = stripe.Customer.create(
            email=hoa["admin_email"] or user.email,
            name=hoa["name"],
            metadata={"hoa_id": hoa_id},
        )
        customer_id = customer.id
        await conn.execute(
            "UPDATE hoas SET stripe_customer_id = $1 WHERE id = $2", customer_id, hoa_id,
        )

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": max(units, 1)}],
        success_url=f"{APP_URL}/admin/settings?billing=success",
        cancel_url=f"{APP_URL}/admin/settings?billing=cancel",
        metadata={"hoa_id": hoa_id},
        allow_promotion_codes=True,
    )
    return {"url": session.url}


# ── Manage: hosted Stripe Customer Portal (invoices, card, cancel) ───────────
@router.post("/hoa/{hoa_id}/billing/portal")
async def create_portal(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    _require_live()
    hoa = await _authz_hoa(conn, user, hoa_id)
    if not hoa["stripe_customer_id"]:
        raise HTTPException(status_code=400, detail="No billing account yet — subscribe first.")
    session = stripe.billing_portal.Session.create(
        customer=hoa["stripe_customer_id"],
        return_url=f"{APP_URL}/admin/settings",
    )
    return {"url": session.url}


# ── Webhook: Stripe → our billing_status (signature-verified, public) ────────
@router.post("/billing/webhook")
async def stripe_webhook(
    request: Request,
    conn: asyncpg.Connection = Depends(get_conn),
):
    if not (stripe and STRIPE_WEBHOOK_SECRET):
        raise HTTPException(status_code=503, detail="Billing webhook not configured")
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signature")

    etype = event["type"]
    obj = event["data"]["object"]
    customer_id = obj.get("customer")

    if etype in ("customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"):
        status = "canceled" if etype.endswith("deleted") else obj.get("status")
        await conn.execute(
            "UPDATE hoas SET billing_status = $1, stripe_subscription_id = $2 WHERE stripe_customer_id = $3",
            status, obj.get("id"), customer_id,
        )
    elif etype == "checkout.session.completed":
        await conn.execute(
            "UPDATE hoas SET billing_status = 'active', stripe_subscription_id = $1 WHERE stripe_customer_id = $2",
            obj.get("subscription"), customer_id,
        )
    elif etype == "invoice.payment_failed":
        await conn.execute(
            "UPDATE hoas SET billing_status = 'past_due' WHERE stripe_customer_id = $1", customer_id,
        )
    return {"received": True}


# ── Future paywall hook — currently a NO-OP, called from nowhere yet ─────────
async def assert_billing_ok(conn: asyncpg.Connection, hoa_id: str) -> None:
    """When we decide to gate features behind payment, call this in those flows.
    Today it does nothing (dormant), so it can be wired in ahead of time safely."""
    if not BILLING_ENABLED:
        return
    # Intentionally permissive until we choose to enforce. To turn on the
    # paywall, replace the early return below with the 402 raise.
    return
    # status = await conn.fetchval("SELECT billing_status FROM hoas WHERE id = $1", hoa_id)
    # if (status or "none") not in _GOOD_STANDING:
    #     raise HTTPException(status_code=402, detail="This association's subscription is inactive.")
