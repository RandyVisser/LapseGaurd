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
import hmac
import logging
import os
from datetime import datetime, timedelta, timezone

import asyncpg
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from auth.jwt import AuthUser, require_hoa_admin
from models.db import get_conn
from services.email import APP_URL
from services.firms import firm_manages_hoa, user_firm

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
        if await firm_manages_hoa(conn, user.sub, hoa_id):
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


def _volume_monthly_cents(units: int) -> int:
    """VOLUME pricing (since 2026-07-12): every unit is billed at the rate of
    the tier the TOTAL lands in — ≤750 @ $1.00, 751–10,000 @ $0.50, 10,000+ @
    $0.25, $50/mo minimum. Mirror of the Stripe volume price AND the landing
    #pricing copy — the three must agree. (In Stripe: volume tiers with the
    minimum modeled as a $50 flat fee on the 1–50 tier.)"""
    if units <= 0:
        return 0
    rate = 100 if units <= 750 else 50 if units <= 10000 else 25
    return max(units * rate, 5000)


async def _firm_rate_for_hoa(conn: asyncpg.Connection, hoa_id: str):
    """If a firm manages this association and passes billing through
    ('association' mode), the association pays its own bill at the firm's BULK
    rate: the volume-tier rate of the firm's whole portfolio (blended only
    when the $50 minimum dominates). Returns (firm_row, rate_cents) or None. Note: no $50
    minimum on the bulk rate — that's the firm-deal incentive."""
    firm = await conn.fetchrow(
        """SELECT f.id, f.name, f.billing_mode FROM pm_firms f
           JOIN pm_firm_hoas fh ON fh.firm_id = f.id
           WHERE fh.hoa_id = $1 ORDER BY fh.created_at LIMIT 1""",
        hoa_id,
    )
    if not firm or firm["billing_mode"] != "association":
        return None
    total_units = await conn.fetchval(
        f"""SELECT coalesce(sum({_UNITS_SUBQ}), 0)
            FROM pm_firm_hoas fh JOIN hoas h ON h.id = fh.hoa_id
            WHERE fh.firm_id = $1""",
        firm["id"],
    ) or 0
    if total_units <= 0:
        return None
    rate = max(round(_volume_monthly_cents(total_units) / total_units), 1)
    return firm, rate


# ── Read: always works, even while dormant ──────────────────────────────────
@router.get("/hoa/{hoa_id}/billing")
async def get_billing(
    hoa_id: str,
    user: AuthUser = Depends(require_hoa_admin),
    conn: asyncpg.Connection = Depends(get_conn),
):
    hoa = await _authz_hoa(conn, user, hoa_id)
    units = await _billable_units(conn, hoa_id)
    # A firm in pass-through mode gives its associations the firm's bulk rate;
    # otherwise standard graduated pricing on this association's own units.
    firm_rate = await _firm_rate_for_hoa(conn, hoa_id)
    if firm_rate:
        rate = firm_rate[1]
        monthly = units * rate
    else:
        monthly = _volume_monthly_cents(units)
        # Effective per-unit rate for display; under volume pricing this IS
        # the tier rate unless the $50 minimum dominates.
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
        "firm_rate": bool(firm_rate),
        "firm_name": firm_rate[0]["name"] if firm_rate else None,
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
    firm_rate = await _firm_rate_for_hoa(conn, hoa_id)

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

    # Pass-through firms: the association subscribes itself, but at the firm's
    # bulk per-unit rate (ad-hoc monthly price) instead of the public tiers.
    if firm_rate:
        line_item = {
            "price_data": {
                "currency": "usd",
                "product_data": {"name": f"condo.insure — per-unit, {firm_rate[0]['name']} firm rate"},
                "unit_amount": firm_rate[1],
                "recurring": {"interval": "month"},
            },
            "quantity": max(units, 1),
        }
    else:
        line_item = {"price": price_id, "quantity": max(units, 1)}

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[line_item],
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


def _sub_billing_state(sub) -> tuple:
    """Map a Stripe subscription object to (billing_status, billing_cancel_at).
    THE status mapping — the webhook and the daily sync both use it; fork it
    and a row healed by one gets re-broken by the other. Portal cancels
    default to "at period end": status stays active/trialing but
    cancel_at(_period_end) is set, so we track the date for the UI."""
    status = sub.get("status")
    cancel_at = None
    if status != "canceled" and sub.get("cancel_at_period_end"):
        ts = sub.get("cancel_at") or sub.get("current_period_end")
        if ts:
            cancel_at = datetime.fromtimestamp(ts, tz=timezone.utc)
    return status, cancel_at


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
        status, cancel_at = _sub_billing_state(obj)
        if etype.endswith("deleted"):
            status, cancel_at = "canceled", None
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
# A property-management firm pays once for its whole portfolio: one Stripe
# customer (pm_firms.stripe_customer_id), one subscription with quantity =
# combined billable units. Because the graduated price is applied to the
# combined quantity, firms get the volume tiers ($0.50/$0.25) their
# associations would never reach individually — that discount is the
# incentive to consolidate. Any member of the firm sees the same portfolio
# billing; the subscription belongs to the firm, not to whoever clicked
# Subscribe.
#
# Every covered HOA row is stamped with the firm's stripe_customer_id, so the
# existing webhook above fans subscription status out to all of them and each
# association reads as paid through the normal per-HOA billing endpoint.

def _require_pm(user: AuthUser):
    if user.role != "property_manager":
        raise HTTPException(status_code=403, detail="Property-manager account required")


async def _pm_portfolio(conn: asyncpg.Connection, user_id: str):
    """All HOAs this PM's firm manages, with billable unit counts and billing state."""
    return await conn.fetch(
        """SELECT h.id, h.name, h.billing_status, h.stripe_customer_id,
                  h.stripe_subscription_id, h.trial_ends_at, h.billing_cancel_at,
                  (SELECT count(*) FROM units u
                     WHERE u.hoa_id = h.id
                       AND lower(coalesce(u.assoc_title, '')) <> 'property manager'
                       AND u.parent_unit_id IS NULL) AS units
           FROM hoas h
           JOIN pm_firm_hoas fh ON fh.hoa_id = h.id
           JOIN pm_firm_members m ON m.firm_id = fh.firm_id
           WHERE m.supabase_user_id = $1
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
    firm = await user_firm(conn, user.sub)
    # Owners manage billing, managers get a read-only view; a plain member in
    # an assignment-based firm doesn't see the firm's bill at all.
    if firm and not firm["open_visibility"] and firm["role"] == "member":
        return {"enabled": BILLING_ENABLED, "restricted": True}
    firm_customer = firm["stripe_customer_id"] if firm else None
    hoas = await _pm_portfolio(conn, user.sub)
    included, excluded = _split_portfolio(hoas, firm_customer)

    # Firm subscription state lives on the stamped HOA rows (webhook keeps
    # them in sync); any one of them speaks for the whole subscription.
    stamped = [h for h in included if firm_customer and h["stripe_customer_id"] == firm_customer]
    sub_row = next((h for h in stamped if h["stripe_subscription_id"]), None)
    status = (sub_row["billing_status"] or "none") if sub_row else "none"
    cancel_at = sub_row["billing_cancel_at"] if sub_row else None

    units = sum(h["units"] for h in included)
    monthly = _volume_monthly_cents(units)
    separate = sum(_volume_monthly_cents(h["units"]) for h in included)
    # Bulk rate for pass-through mode: blended over the WHOLE portfolio
    # (including self-subscribed associations — they're part of the deal).
    portfolio_units = sum(h["units"] for h in hoas)
    firm_unit_rate = (
        max(round(_volume_monthly_cents(portfolio_units) / portfolio_units), 1)
        if portfolio_units else DEFAULT_UNIT_RATE_CENTS
    )
    trial_ends_at = _latest_trial_end(included)
    trial_days_left = None
    if trial_ends_at:
        trial_days_left = max((trial_ends_at - datetime.now(timezone.utc)).days, 0)
    trial_active = bool(trial_days_left)

    return {
        "enabled": BILLING_ENABLED,
        "billing_mode": firm["billing_mode"] if firm else "firm",
        "is_owner": bool(firm and firm["is_owner"]),
        "firm_unit_rate_cents": firm_unit_rate,
        "status": status,
        "in_good_standing": status in _GOOD_STANDING or trial_active,
        "has_subscription": bool(sub_row),
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

    firm = await user_firm(conn, user.sub)
    if not firm:
        raise HTTPException(status_code=400, detail="No firm found for this account yet.")
    if firm["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the firm owner can manage billing.")
    if firm["billing_mode"] == "association":
        raise HTTPException(
            status_code=400,
            detail="Your firm passes billing to each association — they subscribe individually at your firm rate.",
        )
    firm_customer = firm["stripe_customer_id"]
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
            name=firm["name"],
            metadata={"pm_firm_id": str(firm["id"])},
        )
        firm_customer = customer.id
        await conn.execute(
            "UPDATE pm_firms SET stripe_customer_id = $1 WHERE id = $2",
            firm_customer, firm["id"],
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
        metadata={"pm_firm_id": str(firm["id"])},
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
    firm = await user_firm(conn, user.sub)
    if not firm or not firm["stripe_customer_id"]:
        raise HTTPException(status_code=400, detail="No billing account yet — subscribe first.")
    if firm["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the firm owner can manage billing.")
    session = stripe.billing_portal.Session.create(
        customer=firm["stripe_customer_id"],
        return_url=f"{APP_URL}/admin/settings",
    )
    return {"url": session.url}


# ── Daily quantity sync: keep Stripe matching reality ────────────────────────
# Checkout sets a subscription's quantity once; after that, unit counts change
# and associations join or leave firms. This reconciler (run by the daily cron)
# closes all of those gaps in one pass:
#   - firm subscriptions: quantity = combined billable units of the firm's
#     current portfolio; associations newly added to a subscribed firm get
#     stamped (start showing paid, start being billed) and ones that left get
#     detached (firm stops paying; they drop back to unsubscribed)
#   - self-paying associations: quantity = today's billable unit count
#   - both paths refresh hoas.billing_status/billing_cancel_at from each
#     subscription's CURRENT Stripe status (webhooks can land out of order —
#     e.g. a stale invoice.payment_failed after subscription.updated=active —
#     and would otherwise leave rows stale forever)
# Quantity changes use proration_behavior='none' — the new count just applies
# from the next invoice, no surprise mid-cycle charges or credits.

_UNITS_SUBQ = """(SELECT count(*) FROM units u
                   WHERE u.hoa_id = h.id
                     AND lower(coalesce(u.assoc_title, '')) <> 'property manager'
                     AND u.parent_unit_id IS NULL)"""

INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")


def _sync_quantity(s, sub, qty: int) -> bool:
    """Set the subscription's (single) line item to qty if it differs."""
    item = sub["items"]["data"][0]
    if item["quantity"] == qty:
        return False
    s.Subscription.modify(
        sub["id"],
        items=[{"id": item["id"], "quantity": qty}],
        proration_behavior="none",
    )
    return True


async def sync_billing_quantities(conn: asyncpg.Connection, stripe_mod=None) -> dict:
    """Reconcile every live subscription with the database. stripe_mod is
    injectable for tests; production uses the configured stripe module."""
    s = stripe_mod or stripe
    if stripe_mod is None and not (stripe and STRIPE_SECRET_KEY):
        return {"skipped": "billing dormant"}
    summary = {"firm_subs": 0, "hoa_subs": 0, "stamped": 0, "detached": 0,
               "quantity_updates": 0, "status_refreshes": 0, "warnings": []}

    firms = await conn.fetch(
        "SELECT id, name, stripe_customer_id FROM pm_firms WHERE stripe_customer_id IS NOT NULL",
    )
    firm_customers = [f["stripe_customer_id"] for f in firms]

    for firm in firms:
        cust = firm["stripe_customer_id"]
        try:
            all_subs = s.Subscription.list(customer=cust, status="all", limit=100)["data"]
            # Self-heal billing_status: webhooks can land out of order (a stale
            # invoice.payment_failed after subscription.updated=active would
            # otherwise leave rows past_due forever). Refresh every row stamped
            # with one of these subscriptions from the subscription's CURRENT
            # status — same mapping the webhook uses.
            for x in all_subs:
                status, cancel_at = _sub_billing_state(x)
                refreshed = await conn.fetch(
                    "UPDATE hoas SET billing_status = $1, billing_cancel_at = $2 "
                    "WHERE stripe_customer_id = $3 AND stripe_subscription_id = $4 "
                    "AND (billing_status IS DISTINCT FROM $1 OR billing_cancel_at IS DISTINCT FROM $2) "
                    "RETURNING id",
                    status, cancel_at, cust, x["id"],
                )
                summary["status_refreshes"] += len(refreshed)
            subs = [x for x in all_subs if x["status"] in _GOOD_STANDING]
            if not subs:
                continue
            if len(subs) > 1:
                summary["warnings"].append(f"firm {firm['name']}: multiple live subscriptions, skipped")
                continue
            sub = subs[0]
            summary["firm_subs"] += 1

            mapped = await conn.fetch(
                f"""SELECT h.id, h.stripe_customer_id, h.stripe_subscription_id,
                           h.billing_status, {_UNITS_SUBQ} AS units
                    FROM hoas h JOIN pm_firm_hoas fh ON fh.hoa_id = h.id
                    WHERE fh.firm_id = $1""",
                firm["id"],
            )
            included, _ = _split_portfolio(mapped, cust)

            # Associations added to the firm since checkout: cover them.
            to_stamp = [h["id"] for h in included if h["stripe_customer_id"] != cust]
            if to_stamp:
                status, cancel_at = _sub_billing_state(sub)
                await conn.execute(
                    "UPDATE hoas SET stripe_customer_id = $1, stripe_subscription_id = $2, "
                    "billing_status = $3, billing_cancel_at = $4 WHERE id = ANY($5::uuid[])",
                    cust, sub["id"], status, cancel_at, to_stamp,
                )
                summary["stamped"] += len(to_stamp)

            # Associations that left the firm: stop paying for them and drop
            # them back to unsubscribed (their own trial/checkout applies again).
            included_ids = [h["id"] for h in included]
            detached = await conn.fetch(
                "UPDATE hoas SET stripe_customer_id = NULL, stripe_subscription_id = NULL, "
                "billing_status = 'none', billing_cancel_at = NULL "
                "WHERE stripe_customer_id = $1 AND NOT (id = ANY($2::uuid[])) RETURNING id",
                cust, included_ids,
            )
            summary["detached"] += len(detached)

            qty = sum(h["units"] for h in included)
            if qty <= 0:
                summary["warnings"].append(
                    f"firm {firm['name']}: live subscription but no billable units — cancel via portal if intended",
                )
                continue
            if _sync_quantity(s, sub, qty):
                summary["quantity_updates"] += 1
        except Exception as e:  # one broken firm shouldn't stop the rest
            logger.exception("Billing sync failed for firm %s", firm["id"])
            summary["warnings"].append(f"firm {firm['name']}: {e}")

    # Self-paying associations (their customer isn't any firm's customer).
    # No billing_status filter: a row stuck on a stale webhook status (e.g.
    # past_due after the subscription recovered) must still be visited so the
    # refresh below can heal it.
    rows = await conn.fetch(
        f"""SELECT h.id, h.name, h.stripe_subscription_id, {_UNITS_SUBQ} AS units
            FROM hoas h
            WHERE h.stripe_subscription_id IS NOT NULL
              AND (h.stripe_customer_id IS NULL OR NOT (h.stripe_customer_id = ANY($1::text[])))""",
        firm_customers,
    )
    for h in rows:
        try:
            sub = s.Subscription.retrieve(h["stripe_subscription_id"])
            # Same self-heal as the firm loop: refresh from the subscription's
            # current status via the shared webhook mapping (read-only).
            status, cancel_at = _sub_billing_state(sub)
            refreshed = await conn.fetch(
                "UPDATE hoas SET billing_status = $1, billing_cancel_at = $2 "
                "WHERE id = $3 "
                "AND (billing_status IS DISTINCT FROM $1 OR billing_cancel_at IS DISTINCT FROM $2) "
                "RETURNING id",
                status, cancel_at, h["id"],
            )
            summary["status_refreshes"] += len(refreshed)
            if sub["status"] not in _GOOD_STANDING:
                continue
            summary["hoa_subs"] += 1
            if h["units"] <= 0:
                summary["warnings"].append(f"hoa {h['name']}: live subscription but no billable units")
                continue
            if _sync_quantity(s, sub, h["units"]):
                summary["quantity_updates"] += 1
        except Exception as e:
            logger.exception("Billing sync failed for hoa %s", h["id"])
            summary["warnings"].append(f"hoa {h['name']}: {e}")

    return summary


@router.post("/billing/sync")
async def billing_sync(
    x_api_key: str | None = Header(None),
    conn: asyncpg.Connection = Depends(get_conn),
):
    """Internal (cron) — reconcile Stripe quantities; same auth as /alerts/run."""
    if not INTERNAL_API_KEY or not x_api_key or not hmac.compare_digest(x_api_key, INTERNAL_API_KEY):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return await sync_billing_quantities(conn)


def cancel_firm_subscriptions(customer_id: str | None) -> bool:
    """Cancel every live subscription on a firm's Stripe customer. Called
    before a firm row is deleted — deleting first would orphan a subscription
    that keeps charging with no portal left to cancel it. Returns False when a
    cancellation failed (caller should keep the firm so billing stays
    reachable). Trivially succeeds while billing is dormant: no keys means no
    live subscription can exist."""
    if not customer_id or not (stripe and STRIPE_SECRET_KEY):
        return True
    try:
        subs = stripe.Subscription.list(customer=customer_id, status="all", limit=100)
        for s in subs.auto_paging_iter():
            if s["status"] not in ("canceled", "incomplete_expired"):
                stripe.Subscription.delete(s["id"])
        return True
    except Exception:
        logger.exception("Could not cancel Stripe subscriptions for customer %s", customer_id)
        return False


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
