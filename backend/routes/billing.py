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
from datetime import datetime, timedelta, timezone

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
                  stripe_price_id, billing_status, trial_ends_at, billing_cancel_at
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


def _graduated_monthly_cents(units: int) -> int:
    """Mirror of the Stripe graduated price AND frontend/src/pricing.js — the
    three must agree. First 750 @ $1.00, next to 10,000 @ $0.50, beyond @
    $0.25, $50/mo minimum (modeled in Stripe as a $50 flat fee on units 1-50)."""
    if units <= 0:
        return 0
    if units <= 750:
        cost = units * 100
    elif units <= 10000:
        cost = 750 * 100 + (units - 750) * 50
    else:
        cost = 750 * 100 + 9250 * 50 + (units - 10000) * 25
    return max(cost, 5000)


# ── Read: always works, even while dormant ──────────────────────────────────
@router.get("/hoa/{hoa_id}/billing")
async def get_billing(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    hoa = await _authz_hoa(conn, user, hoa_id)
    units = await _billable_units(conn, hoa_id)
    monthly = _graduated_monthly_cents(units)
    # Effective blended rate for display; graduated tiers mean big portfolios
    # pay less per unit than the headline $1.
    rate = round(monthly / units) if units else DEFAULT_UNIT_RATE_CENTS
    trial_ends_at = hoa["trial_ends_at"]
    trial_days_left = None
    if trial_ends_at:
        trial_days_left = max((trial_ends_at - datetime.now(timezone.utc)).days, 0)
    trial_active = bool(trial_days_left)  # None (no trial set) and 0 (expired) both mean not active
    return {
        "enabled": BILLING_ENABLED,
        "status": hoa["billing_status"] or "none",
        "in_good_standing": (hoa["billing_status"] or "none") in _GOOD_STANDING or trial_active,
        "units": units,
        "unit_rate_cents": rate,
        "monthly_cents": monthly,
        "has_subscription": bool(hoa["stripe_subscription_id"]),
        "trial_ends_at": trial_ends_at.isoformat() if trial_ends_at else None,
        "trial_days_left": trial_days_left,
        "trial_active": trial_active,
        "cancel_at": hoa["billing_cancel_at"].isoformat() if hoa["billing_cancel_at"] else None,
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

    # Subscribing mid-trial shouldn't cut the free 90 days short: carry the
    # remaining trial into Stripe so the first charge lands when it would have
    # anyway. (Stripe requires trial_end >= 48h out, hence the 2-day floor.)
    subscription_data = {}
    trial_ends_at = hoa["trial_ends_at"]
    if trial_ends_at and trial_ends_at > datetime.now(timezone.utc) + timedelta(days=2):
        subscription_data["trial_end"] = int(trial_ends_at.timestamp())

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": max(units, 1)}],
        success_url=f"{APP_URL}/admin/settings?billing=success",
        cancel_url=f"{APP_URL}/admin/settings?billing=cancel",
        metadata={"hoa_id": hoa_id},
        allow_promotion_codes=True,
        **({"subscription_data": subscription_data} if subscription_data else {}),
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
        # Portal cancels default to "at period end": status stays active/trialing
        # but cancel_at(_period_end) is set. Track the date so the UI can say so.
        cancel_at = None
        if not etype.endswith("deleted") and obj.get("cancel_at_period_end"):
            ts = obj.get("cancel_at") or obj.get("current_period_end")
            if ts:
                cancel_at = datetime.fromtimestamp(ts, tz=timezone.utc)
        await conn.execute(
            "UPDATE hoas SET billing_status = $1, stripe_subscription_id = $2, billing_cancel_at = $3 "
            "WHERE stripe_customer_id = $4",
            status, obj.get("id"), cancel_at, customer_id,
        )
    elif etype == "checkout.session.completed":
        await conn.execute(
            "UPDATE hoas SET billing_status = 'active', stripe_subscription_id = $1, billing_cancel_at = NULL "
            "WHERE stripe_customer_id = $2",
            obj.get("subscription"), customer_id,
        )
    elif etype == "invoice.payment_failed":
        await conn.execute(
            "UPDATE hoas SET billing_status = 'past_due' WHERE stripe_customer_id = $1", customer_id,
        )
    return {"received": True}


# ── PM firm billing: one subscription covering every managed association ─────
# A property manager pays once for their whole portfolio: one Stripe customer
# (tracked in pm_billing), one subscription with quantity = combined billable
# units. Because the graduated price is applied to the combined quantity, PMs
# get the volume tiers ($0.50/$0.25) their associations would never reach
# individually — that discount is the incentive to consolidate.
#
# Every covered HOA row is stamped with the firm's stripe_customer_id, so the
# existing webhook above fans subscription status out to all of them and each
# association reads as paid through the normal per-HOA billing endpoint.

def _require_pm(user: AuthUser):
    if user.role != "property_manager":
        raise HTTPException(status_code=403, detail="Property-manager account required")


async def _pm_portfolio(conn: asyncpg.Connection, user_id: str):
    """All HOAs this PM manages, with billable unit counts and billing state."""
    return await conn.fetch(
        """SELECT h.id, h.name, h.billing_status, h.stripe_customer_id,
                  h.stripe_subscription_id, h.trial_ends_at, h.billing_cancel_at,
                  (SELECT count(*) FROM units u
                     WHERE u.hoa_id = h.id
                       AND lower(coalesce(u.assoc_title, '')) <> 'property manager'
                       AND u.parent_unit_id IS NULL) AS units
           FROM hoas h
           JOIN property_manager_hoas pmh ON pmh.hoa_id = h.id
           WHERE pmh.supabase_user_id = $1
           ORDER BY h.name""",
        user_id,
    )


def _split_portfolio(hoas, firm_customer):
    """Included = billable under the firm subscription. Excluded = associations
    that already pay on their own (a live subscription under a different
    Stripe customer) — we never double-charge those."""
    included, excluded = [], []
    for h in hoas:
        self_paying = (
            h["stripe_subscription_id"]
            and (h["billing_status"] or "") in _GOOD_STANDING
            and (not firm_customer or h["stripe_customer_id"] != firm_customer)
        )
        (excluded if self_paying else included).append(h)
    return included, excluded


def _latest_trial_end(hoas):
    ends = [h["trial_ends_at"] for h in hoas if h["trial_ends_at"]]
    return max(ends) if ends else None


@router.get("/pm/billing")
async def get_pm_billing(
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    _require_pm(user)
    firm_customer = await conn.fetchval(
        "SELECT stripe_customer_id FROM pm_billing WHERE supabase_user_id = $1", user.sub,
    )
    hoas = await _pm_portfolio(conn, user.sub)
    included, excluded = _split_portfolio(hoas, firm_customer)

    # Firm subscription state lives on the stamped HOA rows (webhook keeps
    # them in sync); any one of them speaks for the whole subscription.
    stamped = [h for h in included if firm_customer and h["stripe_customer_id"] == firm_customer]
    firm = next((h for h in stamped if h["stripe_subscription_id"]), None)
    status = (firm["billing_status"] or "none") if firm else "none"
    cancel_at = firm["billing_cancel_at"] if firm else None

    units = sum(h["units"] for h in included)
    monthly = _graduated_monthly_cents(units)
    separate = sum(_graduated_monthly_cents(h["units"]) for h in included)
    trial_ends_at = _latest_trial_end(included)
    trial_days_left = None
    if trial_ends_at:
        trial_days_left = max((trial_ends_at - datetime.now(timezone.utc)).days, 0)
    trial_active = bool(trial_days_left)

    return {
        "enabled": BILLING_ENABLED,
        "status": status,
        "in_good_standing": status in _GOOD_STANDING or trial_active,
        "has_subscription": bool(firm),
        "units": units,
        "monthly_cents": monthly,
        "separate_monthly_cents": separate,
        "savings_cents": max(separate - monthly, 0),
        "trial_ends_at": trial_ends_at.isoformat() if trial_ends_at else None,
        "trial_days_left": trial_days_left,
        "trial_active": trial_active,
        "cancel_at": cancel_at.isoformat() if cancel_at else None,
        "hoas": [
            {
                "id": str(h["id"]),
                "name": h["name"],
                "units": h["units"],
                "status": h["billing_status"] or "none",
                "included": h in included,
            }
            for h in hoas
        ],
    }


@router.post("/pm/billing/checkout")
async def create_pm_checkout(
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    _require_live()
    _require_pm(user)
    if not STRIPE_PRICE_ID:
        raise HTTPException(status_code=503, detail="No Stripe price configured")

    firm_customer = await conn.fetchval(
        "SELECT stripe_customer_id FROM pm_billing WHERE supabase_user_id = $1", user.sub,
    )
    hoas = await _pm_portfolio(conn, user.sub)
    included, _ = _split_portfolio(hoas, firm_customer)
    if any(
        firm_customer and h["stripe_customer_id"] == firm_customer
        and h["stripe_subscription_id"] and (h["billing_status"] or "") in _GOOD_STANDING
        for h in included
    ):
        raise HTTPException(status_code=400, detail="Already subscribed — use Manage billing.")
    units = sum(h["units"] for h in included)
    if units <= 0:
        raise HTTPException(status_code=400, detail="No billable units across your associations yet.")

    if not firm_customer:
        customer = stripe.Customer.create(
            email=user.email,
            metadata={"pm_user_id": user.sub},
        )
        firm_customer = customer.id
        await conn.execute(
            """INSERT INTO pm_billing (supabase_user_id, stripe_customer_id) VALUES ($1, $2)
               ON CONFLICT (supabase_user_id) DO UPDATE SET stripe_customer_id = $2""",
            user.sub, firm_customer,
        )

    # Stamp the firm customer on every covered HOA so the webhook marks them
    # all paid the moment checkout completes.
    await conn.execute(
        "UPDATE hoas SET stripe_customer_id = $1 WHERE id = ANY($2::uuid[])",
        firm_customer, [h["id"] for h in included],
    )

    # Same mid-trial courtesy as per-HOA checkout: first charge lands when the
    # (latest) trial would have ended anyway.
    subscription_data = {}
    trial_ends_at = _latest_trial_end(included)
    if trial_ends_at and trial_ends_at > datetime.now(timezone.utc) + timedelta(days=2):
        subscription_data["trial_end"] = int(trial_ends_at.timestamp())

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=firm_customer,
        line_items=[{"price": STRIPE_PRICE_ID, "quantity": units}],
        success_url=f"{APP_URL}/admin/settings?billing=success",
        cancel_url=f"{APP_URL}/admin/settings?billing=cancel",
        metadata={"pm_user_id": user.sub},
        allow_promotion_codes=True,
        **({"subscription_data": subscription_data} if subscription_data else {}),
    )
    return {"url": session.url}


@router.post("/pm/billing/portal")
async def create_pm_portal(
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    _require_live()
    _require_pm(user)
    firm_customer = await conn.fetchval(
        "SELECT stripe_customer_id FROM pm_billing WHERE supabase_user_id = $1", user.sub,
    )
    if not firm_customer:
        raise HTTPException(status_code=400, detail="No billing account yet — subscribe first.")
    session = stripe.billing_portal.Session.create(
        customer=firm_customer,
        return_url=f"{APP_URL}/admin/settings",
    )
    return {"url": session.url}


# ── Future paywall hook — currently a NO-OP, called from nowhere yet ─────────
async def assert_billing_ok(conn: asyncpg.Connection, hoa_id: str) -> None:
    """When we decide to gate features behind payment, call this in those flows.
    Today it does nothing (dormant), so it can be wired in ahead of time safely."""
    if not BILLING_ENABLED:
        return
    # Intentionally permissive until we choose to enforce. To turn on the
    # paywall, replace the early return below with the 402 raise.
    return
    # row = await conn.fetchrow(
    #     "SELECT billing_status, trial_ends_at FROM hoas WHERE id = $1", hoa_id)
    # in_trial = row["trial_ends_at"] and row["trial_ends_at"] > datetime.now(timezone.utc)
    # if (row["billing_status"] or "none") not in _GOOD_STANDING and not in_trial:
    #     raise HTTPException(status_code=402, detail="This association's subscription is inactive.")
