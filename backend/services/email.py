import html as _html
import os
import httpx

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "alerts@condo.insure")
# Friendly display name shown in the inbox, e.g. "condo.insure <alerts@condo.insure>"
# instead of a bare "alerts". Override in Railway via FROM_NAME. Fall back to the
# brand if the var is unset OR set-but-blank — an empty value would otherwise build
# a malformed " <addr>" From header that Resend rejects, silently killing all sends.
FROM_NAME = (os.environ.get("FROM_NAME") or "").strip() or "condo.insure"
# Quote links in emails point at the agency quote page.
QUOTE_FORM_URL = "https://www.universalcondo.com/quote"
# Renters get an HO-4-specific quote page.
HO4_QUOTE_URL = "https://www.universalcondo.com/ho4quote.html"
APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")
# Dec-page email-in intake address shown to owners who'd rather email their
# document than upload it. Override in Railway via INBOUND_ADDRESS if needed.
INBOUND_ADDRESS = os.environ.get("INBOUND_ADDRESS", "docs@condo.insure")


async def send_email(to_email: str, subject: str, html: str, reply_to: str | None = None) -> bool:
    if not RESEND_API_KEY:
        print(f"[email] RESEND_API_KEY not set — skipping email to {to_email}")
        return False
    # Don't double-wrap if FROM_EMAIL already carries a display name.
    from_header = FROM_EMAIL if "<" in FROM_EMAIL else f"{FROM_NAME} <{FROM_EMAIL}>"
    payload = {"from": from_header, "to": [to_email], "subject": subject, "html": html}
    if reply_to:
        payload["reply_to"] = [reply_to]
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json=payload,
        )
        return resp.status_code == 200


def _btn(url: str, label: str) -> str:
    return f"""
    <a href="{url}" style="display:inline-block;background:#1d4ed8;color:#ffffff;
       font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;
       text-decoration:none;margin:16px 0">{label}</a>"""


def _footer() -> str:
    return """
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0">
    <p style="color:#9ca3af;font-size:12px">
      condo.insure — Condo Association Insurance Compliance
    </p>"""


def _header() -> str:
    return """
    <div style="background:#1e40af;padding:20px 24px;border-radius:8px 8px 0 0">
      <span style="color:#ffffff;font-size:20px;font-weight:700">condo.insure</span>
    </div>
    <div style="background:#ffffff;padding:24px;border-radius:0 0 8px 8px;
                border:1px solid #e5e7eb;border-top:none">"""


def renewal_notice_html(
    tenant_name: str,
    unit_number: str,
    hoa_name: str,
    expiration_date,
    status: str,
    days_until: int | None = None,
) -> tuple[str, str]:
    exp_str = expiration_date.isoformat() if expiration_date else "unknown"

    if status == "lapsed":
        subject = "Action required — your insurance policy has lapsed"
        body = f"Your condo insurance policy expired on <strong>{exp_str}</strong> and is no longer active."
    elif days_until is not None and days_until <= 1:
        subject = "Final notice — your insurance policy expires tomorrow"
        body = (f"Your condo insurance policy expires on <strong>{exp_str}</strong> — that's "
                f"<strong>tomorrow</strong>. Please renew today to avoid a lapse in coverage.")
    elif days_until is not None and days_until <= 7:
        subject = "Reminder — your insurance policy expires in 1 week"
        body = (f"Your condo insurance policy expires on <strong>{exp_str}</strong>, about a "
                f"<strong>week</strong> from now. Please renew soon so your coverage stays active.")
    else:
        subject = "Your condo insurance policy is expiring in 30 days"
        body = (f"Your condo insurance policy expires on <strong>{exp_str}</strong>, about "
                f"<strong>30 days</strong> from now. Now is a great time to renew.")

    quote_url = _build_quote_url(tenant_name, unit_number)
    portal_url = f"{APP_URL}/tenant/dashboard"

    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      <p style="color:#374151">Hi {tenant_name},</p>
      <p style="color:#374151">{body}</p>
      <p style="color:#374151">
        <strong>Unit:</strong> {unit_number}<br>
        <strong>Association:</strong> {hoa_name}
      </p>
      <p style="color:#374151">
        Need a new policy? Get a free quote and upload your proof of insurance
        before your association flags your unit as non-compliant.
      </p>
      {_btn(quote_url, "Request a Free Quote")}
      <p style="margin-top:8px">
        <a href="{portal_url}" style="color:#1d4ed8;font-size:13px">
          Or log in to upload an existing policy →
        </a>
      </p>
      {_footer()}
    </div></body></html>"""

    return subject, html


def renewal_reminder_html(
    unit_number: str,
    hoa_name: str,
    portal_url: str,
    renewal_date,
    days_until: int,
    recipient_name: str | None = None,
    sender_email: str | None = None,
    corp_name: str | None = None,
    sender_name: str | None = None,
    sender_title: str | None = None,
    unit_address: str | None = None,
    is_renter: bool = False,
) -> tuple[str, str]:
    """Renewal reminder sent at the 30/7/1-day milestones — same body, with the
    timing line escalating as the renewal date approaches."""
    try:
        date_str = renewal_date.strftime("%B %-d, %Y")
    except (AttributeError, ValueError):
        date_str = str(renewal_date)

    if days_until is not None and days_until <= 1:
        when, subject = "tomorrow", f"Final reminder — your policy renews tomorrow ({hoa_name})"
    elif days_until is not None and days_until <= 7:
        when, subject = "in 7 days", f"Reminder — your policy renews in 7 days ({hoa_name})"
    else:
        when, subject = "in 30 days", f"Reminder — your policy renews in 30 days ({hoa_name})"

    policy_word = "HO-4 renters insurance policy" if is_renter else "insurance policy"
    quote_btn = "Get an HO-4 Quote" if is_renter else "Get a Quote"
    greeting = "Dear " + ((recipient_name or "").strip() or ("Renter" if is_renter else "Unit Owner"))
    re_parts = [p for p in [(unit_address or "").strip(),
                            (f"Unit {unit_number}" if unit_number else "")] if p]
    re_line = (f'<p style="color:#111827;font-weight:600;margin-bottom:16px">Re: '
               f'{", ".join(re_parts)}</p>') if re_parts else ""
    quote_link = HO4_QUOTE_URL if is_renter else (QUOTE_FORM_URL or "https://www.universalcondo.com/quote")
    contact_parts = [
        (sender_name or "").strip() or None,
        (sender_title or "").strip() or None,
        (corp_name or hoa_name),
        (sender_email or "").strip() or None,
    ]
    contact = "<br>".join(p for p in contact_parts if p)

    body = f"""
      {re_line}
      <p style="color:#374151">{greeting},</p>
      <p style="color:#374151">
        This is a friendly reminder that the {policy_word} on file for your unit is
        set to renew {when}, on <strong>{date_str}</strong>.
      </p>
      <p style="color:#374151">
        To ensure continued compliance with your Association's insurance requirements,
        please log in to the Condo.insure portal and upload your updated Declaration
        Page once your policy renews.
      </p>
      {_btn(portal_url, "Upload Updated Documents")}

      <p style="color:#111827;font-weight:700;margin-top:20px">Looking to Review Your Coverage?</p>
      <p style="color:#374151">
        Now is a great time to shop your policy and make sure you have the right
        coverage at the best rate. You can get a free quote directly through Condo.insure:
      </p>
      <div style="text-align:center;margin:4px 0 8px">
        <a href="{quote_link}" style="display:inline-block;background:#111827;color:#ffffff;
           font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;
           text-decoration:none">{quote_btn}</a>
      </div>

      <p style="color:#6b7280;font-size:13px;margin-top:16px">
        Please note that Condo.insure does not provide insurance advice or recommend
        specific coverage. We are only verifying compliance with the insurance
        requirements established by the Association.
      </p>
      <p style="color:#374151">
        If you have questions about your Association's insurance requirements, please contact:
      </p>
      <p style="color:#374151">{contact or hoa_name}</p>
      <p style="color:#374151">
        Thank you for staying on top of your coverage — we look forward to receiving
        your updated documentation.
      </p>
      <p style="color:#374151;margin-top:20px">
        Thank you,<br>
        Condo.insure Compliance Team<br>
        On behalf of {corp_name or hoa_name}
      </p>"""

    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      {body}
      {_footer()}
    </div></body></html>"""
    return subject, html


def lease_expiration_html(
    unit_number: str,
    hoa_name: str,
    portal_url: str,
    lease_end,
    days_until: int,
    recipient_name: str | None = None,
    sender_email: str | None = None,
    corp_name: str | None = None,
    sender_name: str | None = None,
    sender_title: str | None = None,
    unit_address: str | None = None,
    expired: bool = False,
) -> tuple[str, str]:
    """Sent to the unit OWNER of a rented unit when the lease on file is
    expiring (30/7/1) or has expired — prompts them to upload the renewed lease."""
    try:
        date_str = lease_end.strftime("%B %-d, %Y")
    except (AttributeError, ValueError):
        date_str = str(lease_end)

    if expired:
        when, subject = "has expired", f"Action required — the lease on file has expired ({hoa_name})"
    elif days_until is not None and days_until <= 1:
        when, subject = "expires tomorrow", f"Final reminder — the lease on file expires tomorrow ({hoa_name})"
    elif days_until is not None and days_until <= 7:
        when, subject = "expires in 7 days", f"Reminder — the lease on file expires in 7 days ({hoa_name})"
    else:
        when, subject = "expires in 30 days", f"Reminder — the lease on file expires in 30 days ({hoa_name})"

    greeting = "Dear " + ((recipient_name or "").strip() or "Unit Owner")
    re_parts = [p for p in [(unit_address or "").strip(),
                            (f"Unit {unit_number}" if unit_number else "")] if p]
    re_line = (f'<p style="color:#111827;font-weight:600;margin-bottom:16px">Re: '
               f'{", ".join(re_parts)}</p>') if re_parts else ""
    contact_parts = [
        (sender_name or "").strip() or None,
        (sender_title or "").strip() or None,
        (corp_name or hoa_name),
        (sender_email or "").strip() or None,
    ]
    contact = "<br>".join(p for p in contact_parts if p)

    body = f"""
      {re_line}
      <p style="color:#374151">{greeting},</p>
      <p style="color:#374151">
        Our records show the lease on file for your rented unit <strong>{when}</strong>
        on <strong>{date_str}</strong>.
      </p>
      <p style="color:#374151">
        Because this unit is rented, the Association requires a current lease on file.
        Please upload the renewed lease so the unit stays compliant — when you do, we'll
        read the new renter details automatically.
      </p>
      {_btn(portal_url, "Upload Renewed Lease")}
      <p style="color:#374151;margin-top:16px">
        If the tenancy has ended and the unit is no longer rented, let your association
        know so the rental flag can be removed.
      </p>
      <p style="color:#374151">If you have questions, please contact:</p>
      <p style="color:#374151">{contact or hoa_name}</p>
      <p style="color:#374151;margin-top:20px">
        Thank you,<br>
        Condo.insure Compliance Team<br>
        On behalf of {corp_name or hoa_name}
      </p>"""

    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      {body}
      {_footer()}
    </div></body></html>"""
    return subject, html


def expired_email_html(
    unit_number: str,
    hoa_name: str,
    portal_url: str,
    expiration_date,
    reminder_days: int = 7,
    recipient_name: str | None = None,
    sender_email: str | None = None,
    corp_name: str | None = None,
    sender_name: str | None = None,
    sender_title: str | None = None,
    unit_address: str | None = None,
    is_renter: bool = False,
) -> tuple[str, str]:
    """Notice for owners whose policy has expired and no updated docs received."""
    try:
        date_str = expiration_date.strftime("%B %-d, %Y")
    except (AttributeError, ValueError):
        date_str = str(expiration_date)
    policy_word = "HO-4 renters policy" if is_renter else "insurance policy"
    subject = f"Action required — your {policy_word} has expired ({hoa_name})"
    greeting = "Dear " + ((recipient_name or "").strip() or ("Renter" if is_renter else "Unit Owner"))
    re_parts = [p for p in [(unit_address or "").strip(),
                            (f"Unit {unit_number}" if unit_number else "")] if p]
    re_line = (f'<p style="color:#111827;font-weight:600;margin-bottom:16px">Re: '
               f'{", ".join(re_parts)}</p>') if re_parts else ""
    quote_link = HO4_QUOTE_URL if is_renter else (QUOTE_FORM_URL or "https://www.universalcondo.com/quote")
    contact_parts = [
        (sender_name or "").strip() or None,
        (sender_title or "").strip() or None,
        (corp_name or hoa_name),
        (sender_email or "").strip() or None,
    ]
    contact = "<br>".join(p for p in contact_parts if p)

    body = f"""
      {re_line}
      <p style="color:#374151">{greeting},</p>
      <p style="color:#374151">
        Our records indicate that the {policy_word} on file for your unit expired on
        <strong>{date_str}</strong> and we have not yet received updated documentation.
      </p>
      <p style="color:#374151">
        To remain in compliance with your Association's insurance requirements, please
        take one of the following actions as soon as possible:
      </p>

      <p style="color:#111827;font-weight:700;margin-top:20px">1. Upload Your Renewed Declaration Page</p>
      <p style="color:#374151">
        If your policy has already been renewed, please upload your updated Declaration
        Page through the Condo.insure portal.
      </p>
      {_btn(portal_url, "Upload Updated Documents")}

      <p style="color:#111827;font-weight:700;margin-top:20px">2. Get a New Quote</p>
      <p style="color:#374151">
        If your policy has not yet been renewed or you are looking to switch providers,
        you can get a free quote directly through Condo.insure.
      </p>
      <div style="text-align:center;margin:4px 0 8px">
        <a href="{quote_link}" style="display:inline-block;background:#111827;color:#ffffff;
           font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;
           text-decoration:none">{"Get a HO-4 Quote →" if is_renter else "Get a Quote →"}</a>
      </div>

      <p style="color:#374151">
        Please be aware that failure to maintain active insurance coverage that meets
        your Association's requirements may result in action by the Association. Please
        refer to your governing documents or contact your Association for more information.
      </p>
      <p style="color:#6b7280;font-size:13px;margin-top:12px">
        Please note that Condo.insure does not provide insurance advice or recommend
        specific coverage. We are only verifying compliance with the insurance
        requirements established by the Association.
      </p>
      <p style="color:#374151">
        If you believe your policy is current or if you have questions regarding your
        compliance status, please contact:
      </p>
      <p style="color:#374151">{contact or hoa_name}</p>
      <p style="color:#374151">
        This notice will be resent every {reminder_days} days until updated
        documentation is received. We encourage you to act promptly to avoid any
        further follow-up.
      </p>
      <p style="color:#374151;margin-top:20px">
        Thank you,<br>
        Condo.insure Compliance Team<br>
        On behalf of {corp_name or hoa_name}
      </p>"""

    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      {body}
      {_footer()}
    </div></body></html>"""
    return subject, html


def admin_notify_html(
    tenant_name: str,
    unit_number: str,
    hoa_name: str,
    admin_message: str | None = None,
) -> tuple[str, str]:
    subject = f"Reminder — please update your condo insurance policy"
    quote_url = _build_quote_url(tenant_name, unit_number)
    portal_url = f"{APP_URL}/tenant/dashboard"

    custom_block = ""
    if admin_message:
        safe_msg = _html.escape(admin_message)
        custom_block = f'<p style="color:#374151;background:#f8fafc;border-left:3px solid #1d4ed8;padding:12px 16px;border-radius:4px">{safe_msg}</p>'

    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      <p style="color:#374151">Hi {tenant_name},</p>
      <p style="color:#374151">
        Your condo association (<strong>{hoa_name}</strong>) has sent you a reminder
        to update your insurance policy for <strong>Unit {unit_number}</strong>.
      </p>
      {custom_block}
      <p style="color:#374151">
        If you need a new or updated policy, you can request a free quote below.
        Once you have your dec page, upload it to your tenant portal to stay compliant.
      </p>
      {_btn(quote_url, "Request a Free Quote")}
      <p style="margin-top:8px">
        <a href="{portal_url}" style="color:#1d4ed8;font-size:13px">
          Already have a policy? Upload it here →
        </a>
      </p>
      {_footer()}
    </div></body></html>"""

    return subject, html


def format_address(street, city, state, zip_) -> str:
    cs = " ".join(p for p in [(state or "").strip(), (zip_ or "").strip()] if p)
    return ", ".join(p for p in [(street or "").strip(), (city or "").strip(), cs] if p)


def invite_email_html(
    email: str,
    unit_number: str,
    hoa_name: str,
    invite_url: str,
    is_property_manager: bool = False,
    sender_email: str | None = None,
    recipient_name: str | None = None,
    corp_name: str | None = None,
    sender_name: str | None = None,
    sender_title: str | None = None,
    unit_address: str | None = None,
    is_renter: bool = False,
) -> tuple[str, str]:
    subject = f"Action requested — {hoa_name} insurance compliance"
    greeting = "Dear " + ((recipient_name or "").strip() or ("Renter" if is_renter else "Unit Owner"))
    re_parts = [p for p in [(unit_address or "").strip(),
                            (f"Unit {unit_number}" if unit_number else "")] if p]
    re_line = (f'<p style="color:#111827;font-weight:600;margin-bottom:16px">Re: '
               f'{", ".join(re_parts)}</p>') if re_parts else ""
    quote_link = HO4_QUOTE_URL if is_renter else (QUOTE_FORM_URL or "https://www.universalcondo.com/quote")

    # Property managers get a short admin invite; unit owners get the full notice
    if is_property_manager:
        subject = f"Welcome to Condo.insure — {hoa_name}"
        pm_greeting = "Dear " + ((recipient_name or "").strip() or "Property Manager")
        body = f"""
      <p style="color:#374151">{pm_greeting},</p>
      <p style="color:#374151">
        Welcome to Condo.insure! You have been added as a Property Manager for
        <strong>{hoa_name}</strong>. We're excited to have you on board and wanted to
        take a moment to introduce you to the platform and walk you through getting started.
      </p>

      <p style="color:#111827;font-weight:700;margin-top:20px">What is Condo.insure?</p>
      <p style="color:#374151">
        Condo.insure is an insurance compliance management platform designed to simplify
        the process of collecting, reviewing, and tracking unit owner insurance
        documentation on behalf of homeowner and condominium associations.
      </p>
      <p style="color:#374151">With Condo.insure, you can:</p>
      <ul style="color:#374151;padding-left:20px">
        <li>Collect and store unit owner Declaration Pages in one centralized place</li>
        <li>Automatically verify that unit owner policies meet the Association's insurance requirements</li>
        <li>Send automated compliance notices and renewal reminders to unit owners</li>
        <li>Monitor the compliance status of all units in real time</li>
        <li>Manage multiple associations from a single account</li>
      </ul>
      <p style="color:#374151">
        As a Property Manager, your account gives you the ability to be added to
        multiple associations — so once you're set up, onboarding additional communities
        you manage is simple.
      </p>

      <p style="color:#111827;font-weight:700;margin-top:20px">Setting Up Your Account</p>
      <p style="color:#374151">Follow these steps to get started:</p>
      <p style="color:#111827;font-weight:600;margin-top:12px">1. Create Your Account</p>
      <p style="color:#374151">
        Click the button below to set up your Condo.insure account. If you already have
        an account, simply log in and your new association will appear in your dashboard.
      </p>
      {_btn(invite_url, "Create Account / Log In")}
      <p style="color:#111827;font-weight:600;margin-top:12px">2. Access Your Association</p>
      <p style="color:#374151">
        Once logged in, <strong>{hoa_name}</strong> will be available in your dashboard.
        From there you can view unit compliance status, manage unit owner information,
        and configure association-specific insurance requirements.
      </p>
      <p style="color:#111827;font-weight:600;margin-top:12px">3. Get Added to Additional Associations</p>
      <p style="color:#374151">
        If you manage other associations, you can bring them onto Condo.insure too. If
        an association is already using Condo.insure, simply have its administrator add
        your account email. If it isn't set up yet, you can sign it up to get started.
        Either way, all of your communities will be accessible from your single dashboard.
      </p>

      <p style="color:#374151">
        We look forward to working with you and making insurance compliance easier for
        you and the communities you manage.
      </p>
      <p style="color:#374151;margin-top:20px">
        Thank you,<br>
        The Condo.insure Team
      </p>
      <p style="color:#9ca3af;font-size:12px;margin-top:12px">
        This link is unique to you ({email}) and can only be used once.
      </p>"""
    else:
        # Signature block: name, title, association, email
        sig_lines = [
            (sender_name or "").strip() or None,
            (sender_title or "").strip() or "Property Manager",
            (corp_name or hoa_name),
            (sender_email or "").strip() or None,
        ]
        signature = "<br>".join(line for line in sig_lines if line)
        # Renter (HO-4) vs unit-owner (HO-6) wording
        track_line = ("collect and track renter's insurance information." if is_renter
                      else "collect and track unit-owner insurance information.")
        why_para = (
            "The Association's governing documents require renters to maintain liability "
            "insurance (HO-4) for the rented unit." if is_renter else
            "The Association's governing documents require unit owners to maintain insurance "
            "for portions of their unit that are not covered by the Association's master "
            "policy. In addition, maintaining appropriate insurance helps protect you from "
            "losses involving personal property, interior improvements, liability claims, "
            "loss assessments, and other expenses that may not be covered by the "
            "Association's insurance policy.")
        dec_label = ("Your current HO-4 Renters Insurance Policy Declaration Page" if is_renter
                     else "Your current HO-6 Condominium Unit Owners Policy Declaration Page")
        match_target = "this unit" if is_renter else "your unit"
        maintain_line = ("If you already maintain Renters Insurance, the process should" if is_renter
                         else "If you already maintain condominium unit-owner insurance, the process should")
        quote_intro = (
            "Don't have an HO-4 policy yet, or want to compare your current rate? Get a "
            "fast, no-obligation HO-4 quote in minutes:" if is_renter else
            "Don't have an HO-6 policy yet, or want to compare your current rate? Get a "
            "fast, no-obligation HO-6 quote in minutes:")
        quote_btn_label = "Get a New HO-4 Quote" if is_renter else "Get a New HO-6 Quote"
        body = f"""
      {re_line}
      <p style="color:#374151">{greeting},</p>
      <p style="color:#374151">
        To help maintain accurate insurance records and simplify compliance with our
        condominium insurance requirements, the Association has partnered with
        <strong>Condo.insure</strong>, a secure online insurance compliance platform.
      </p>

      <p style="color:#111827;font-weight:700;margin-top:20px">Why am I receiving this notice?</p>
      <p style="color:#374151">
        {why_para}
      </p>
      <p style="color:#374151">
        To streamline this process, the Association will now use Condo.insure to
        {track_line}
      </p>

      <p style="color:#111827;font-weight:700;margin-top:20px">What do I need to do?</p>
      <p style="color:#374151">Visit the secure compliance portal and:</p>
      {_btn(invite_url, "Open the Compliance Portal")}
      <ol style="color:#374151;padding-left:20px;margin-top:8px">
        <li>Confirm your contact information.</li>
        <li>Upload one of the following:
          <ul style="padding-left:18px;margin:6px 0">
            <li>{dec_label}</li>
            <li>A Certificate of Insurance showing active coverage</li>
          </ul>
        </li>
        <li>Submit the information at your earliest convenience.</li>
      </ol>

      <p style="color:#374151">
        <strong>Prefer not to create an account?</strong> You can simply email your
        Declaration Page or Certificate of Insurance to
        <a href="mailto:{INBOUND_ADDRESS}" style="color:#1d4ed8">{INBOUND_ADDRESS}</a>
        and we'll add it to your unit's record for you. <strong>Please send it from
        this same email address ({email})</strong> — that's how we match your document
        to {match_target}, so a message from a different address won't be routed correctly.
      </p>

      <p style="color:#111827;font-weight:700;margin-top:20px">What information will be requested?</p>
      <ul style="color:#374151;padding-left:20px">
        <li>Insurance carrier name</li>
        <li>Policy number</li>
        <li>Effective and expiration dates</li>
        <li>Named insured(s)</li>
        <li>Proof of active coverage</li>
      </ul>

      <p style="color:#374151">There is no cost to you to use the compliance portal.</p>
      <p style="color:#374151">
        {maintain_line} only take a few minutes.
      </p>
      <p style="color:#374151">
        {quote_intro}
      </p>
      <div style="text-align:center;margin:4px 0 8px">
        <a href="{quote_link}" style="display:inline-block;background:#111827;color:#ffffff;
           font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;
           text-decoration:none">{quote_btn_label}</a>
      </div>
      <p style="color:#374151">
        Thank you for your prompt attention and cooperation in helping the Association
        maintain accurate insurance records.
      </p>
      <p style="color:#374151;margin-top:20px">
        Sincerely,<br>
        {signature}
      </p>
      <p style="color:#9ca3af;font-size:12px;margin-top:12px">
        This link is unique to you ({email}) and can only be used once.
      </p>"""

    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      {body}
      {_footer()}
    </div></body></html>"""
    return subject, html


def noncompliant_email_html(
    unit_number: str,
    hoa_name: str,
    portal_url: str,
    recipient_name: str | None = None,
    sender_email: str | None = None,
    corp_name: str | None = None,
    sender_name: str | None = None,
    sender_title: str | None = None,
    unit_address: str | None = None,
    items: list | None = None,
    is_renter: bool = False,
) -> tuple[str, str]:
    """Compliance-review notice for owners whose policy is on file but does not
    meet the association's requirements. Lists the specific failing items."""
    subject = f"Insurance compliance review — {hoa_name}"
    greeting = "Dear " + ((recipient_name or "").strip() or ("Renter" if is_renter else "Unit Owner"))
    re_parts = [p for p in [(unit_address or "").strip(),
                            (f"Unit {unit_number}" if unit_number else "")] if p]
    re_line = (f'<p style="color:#111827;font-weight:600;margin-bottom:16px">Re: '
               f'{", ".join(re_parts)}</p>') if re_parts else ""

    # Escape — these come from policy validation flags, which embed parsed
    # dec-page values (insurer/named-insured) from an owner-uploaded document
    item_list = [_html.escape(str(i).strip()) for i in (items or []) if str(i).strip()]
    items_html = ("".join(f"<li>{i}</li>" for i in item_list)
                  if item_list else "<li>One or more association requirements are not met.</li>")

    # Contact line for the association / property manager
    contact_parts = [
        (sender_name or "").strip() or None,
        (sender_title or "").strip() or None,
        (corp_name or hoa_name),
        (sender_email or "").strip() or None,
    ]
    contact = "<br>".join(p for p in contact_parts if p)
    quote_link = HO4_QUOTE_URL if is_renter else (QUOTE_FORM_URL or "https://www.universalcondo.com/quote")
    quote_label = "Get a New HO-4 Quote" if is_renter else "Get a New HO-6 Quote"
    quote_word = "HO-4" if is_renter else "HO-6"

    body = f"""
      {re_line}
      <p style="color:#374151">{greeting},</p>
      <p style="color:#374151">Thank you for submitting your insurance information through Condo.insure.</p>
      <p style="color:#374151">
        We have completed our review of the Declaration Page provided and have
        determined that the policy does not currently meet one or more of the
        insurance requirements established by the Association.
      </p>
      <p style="color:#374151">
        Please contact your insurance agent or insurance company to discuss the items
        listed below and obtain updated coverage, if necessary.
      </p>

      <p style="color:#111827;font-weight:700;margin-top:20px">Items Requiring Attention</p>
      <ul style="color:#b91c1c;padding-left:20px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding-top:10px;padding-bottom:10px">
        {items_html}
      </ul>

      <p style="color:#374151">
        Once the requested changes have been made, please upload an updated
        Declaration Page through the Condo.insure portal for review.
      </p>
      {_btn(portal_url, "Upload Updated Documents")}

      <p style="color:#374151;margin-top:8px">
        Need updated coverage, or want to compare your current rate? Get a fast,
        no-obligation {quote_word} quote in minutes:
      </p>
      <div style="text-align:center;margin:4px 0 8px">
        <a href="{quote_link}" style="display:inline-block;background:#111827;color:#ffffff;
           font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;
           text-decoration:none">{quote_label}</a>
      </div>

      <p style="color:#6b7280;font-size:13px;margin-top:16px">
        Please note that Condo.insure does not provide insurance advice or recommend
        specific coverage. We are only verifying compliance with the insurance
        requirements established by the Association.
      </p>
      <p style="color:#374151">
        If you believe the information submitted already satisfies the Association's
        requirements, or if you have questions regarding the compliance review, please
        contact:
      </p>
      <p style="color:#374151">{contact or hoa_name}</p>

      <p style="color:#374151">
        We appreciate your prompt attention to this matter and look forward to
        receiving your updated documentation.
      </p>
      <p style="color:#374151;margin-top:20px">
        Thank you,<br>
        Condo.insure Compliance Team<br>
        On behalf of {corp_name or hoa_name}
      </p>"""

    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      {body}
      {_footer()}
    </div></body></html>"""
    return subject, html


def _step(num: str, title: str, desc: str) -> str:
    return f"""
    <tr>
      <td valign="top" style="width:34px;padding:6px 0">
        <div style="width:26px;height:26px;line-height:26px;text-align:center;
             background:#1d4ed8;color:#ffffff;border-radius:50%;font-size:13px;
             font-weight:700">{num}</div>
      </td>
      <td valign="top" style="padding:6px 0 6px 4px">
        <div style="color:#111827;font-size:15px;font-weight:600">{title}</div>
        <div style="color:#6b7280;font-size:13px;line-height:1.5;margin-top:2px">{desc}</div>
      </td>
    </tr>"""


def welcome_admin_html(admin_name: str, hoa_name: str, setup_url: str | None = None) -> tuple[str, str]:
    subject = f"Welcome to condo.insure — let's get {hoa_name} set up"
    # setup_url => invited admin who must set a password first; otherwise they
    # already have a login and can go straight to the dashboard.
    cta_url = setup_url or f"{APP_URL}/admin/dashboard"
    cta_label = "Set your password & sign in" if setup_url else "Go to your dashboard"
    greeting = (admin_name or "").strip() or "there"
    ready_line = (
        f"Your association <strong>{hoa_name}</strong> is set up and ready. Set your password to sign in and take a look:"
        if setup_url else
        f"Your account for <strong>{hoa_name}</strong> is ready — you can sign in right now. "
        "Here's the quickest path to a compliance dashboard that keeps itself up to date:"
    )
    html = f"""
    <html><body style="margin:0;background:#f1f5f9;
          font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:600px;margin:0 auto;padding:24px 12px">
        {_header()}
        <p style="color:#111827;font-size:16px;margin:0 0 4px">Hi {greeting},</p>
        <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px">
          {ready_line}
        </p>

        <table cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0">
          {_step("1", "Add your units",
                 "Import your owner list in seconds — drop in a <strong>CSV or Excel</strong> file "
                 "exactly as you have it. Your columns don't need to match ours; we read them "
                 "automatically. (Or add units one at a time.)")}
          {_step("2", "Invite your unit-owners",
                 "Send each owner a secure link to upload their declaration page.")}
          {_step("3", "Owners send in their dec pages — their way",
                 f"They can upload through the portal, <strong>or simply email their dec page to "
                 f"<a href='mailto:{INBOUND_ADDRESS}' style='color:#1d4ed8'>{INBOUND_ADDRESS}</a></strong> "
                 "and it files itself. Even forwarding it to you works — you can submit on their behalf.")}
          {_step("4", "Watch compliance update on its own",
                 "We read each policy with AI, check it against your association's requirements, "
                 "and flag anything that's missing, expiring, or non-compliant — automatically.")}
        </table>

        {_btn(cta_url, cta_label)}

        <p style="color:#9ca3af;font-size:13px;line-height:1.5;margin:16px 0 0">
          Questions while you're getting set up? Just reply to this email.
        </p>
        {_footer()}
      </div></body></html>"""
    return subject, html


def new_association_notification_html(
    association_name: str,
    address: str,
    admin_name: str,
    admin_email: str,
) -> tuple[str, str]:
    """Internal heads-up email when a new association signs up."""
    subject = f"🎉 New association joined: {association_name}"
    rows = [
        ("Association", association_name),
        ("Address", address or "—"),
        ("Admin", admin_name or "—"),
        ("Admin email", admin_email),
    ]
    cells = "".join(
        f"<tr>"
        f"<td style='padding:4px 12px 4px 0;color:#6b7280;font-size:14px;white-space:nowrap;vertical-align:top'>{label}</td>"
        f"<td style='padding:4px 0;color:#111827;font-size:14px'>{value}</td>"
        f"</tr>"
        for label, value in rows
    )
    html = f"""
    <html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px 0">
      <p style="color:#111827;font-size:16px;font-weight:600;margin:0 0 12px">A new association just signed up</p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">{cells}</table>
    </body></html>"""
    return subject, html


def staff_activated_notification_html(
    role_label: str,
    name: str,
    email: str,
    hoa_name: str,
) -> tuple[str, str]:
    """Internal heads-up when an invited Admin or Property Manager completes
    setup (sets their password) and goes live on the dashboard."""
    subject = f"✅ {role_label} is now live: {name or email}"
    rows = [
        ("Role", role_label),
        ("Name", name or "—"),
        ("Email", email),
        ("Association", hoa_name or "—"),
    ]
    cells = "".join(
        f"<tr>"
        f"<td style='padding:4px 12px 4px 0;color:#6b7280;font-size:14px;white-space:nowrap;vertical-align:top'>{label}</td>"
        f"<td style='padding:4px 0;color:#111827;font-size:14px'>{value}</td>"
        f"</tr>"
        for label, value in rows
    )
    html = f"""
    <html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px 0">
      <p style="color:#111827;font-size:16px;font-weight:600;margin:0 0 12px">A {role_label} just accepted their invite and signed in</p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">{cells}</table>
    </body></html>"""
    return subject, html


def email_changed_html(hoa_name: str, new_email: str) -> tuple[str, str]:
    """Sent to both the old and new addresses when an admin/PM's sign-in email
    is changed, so the prior address is alerted in case it wasn't authorized."""
    subject = "Your condo.insure sign-in email was changed"
    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      <p style="color:#374151">
        The sign-in email for your condo.insure account (managing <strong>{hoa_name}</strong>)
        was changed to <strong>{new_email}</strong>. You'll use this address to sign in from now on.
      </p>
      <p style="color:#9ca3af;font-size:13px;margin-top:16px">
        If you didn't expect this change, contact us right away at
        <a href="mailto:support@condo.insure" style="color:#1d4ed8">support@condo.insure</a>.
      </p>
      {_footer()}
    </div></body></html>"""
    return subject, html


def policy_upload_notification_html(
    tenant_name: str,
    unit_number: str,
    hoa_name: str,
    tenant_url: str,
) -> tuple[str, str]:
    subject = f"New policy uploaded — Unit {unit_number} needs review"
    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      <p style="color:#374151">
        <strong>{tenant_name}</strong> (Unit {unit_number}) just uploaded a new policy for
        <strong>{hoa_name}</strong> and it's waiting for your review.
      </p>
      {_btn(tenant_url, "Review Policy")}
      {_footer()}
    </div></body></html>"""
    return subject, html


def board_report_html(
    hoa_name: str,
    total_units: int,
    compliant: int,
    expiring: int,
    lapsed: int,
    missing: int,
    lapsed_unit_list: list,
) -> tuple[str, str]:
    pct = round(100 * compliant / total_units) if total_units > 0 else 0
    subject = f"Monthly compliance report — {hoa_name}"
    dashboard_url = f"{APP_URL}/admin/dashboard"

    lapsed_block = ""
    if lapsed_unit_list:
        items = "".join(
            f'<li style="color:#374151">{_html.escape(u.get("unit_number", ""))} — {_html.escape(u.get("tenant_name") or "No owner on file")}</li>'
            for u in lapsed_unit_list[:8]
        )
        more = f'<li style="color:#6b7280;font-style:italic">…and {len(lapsed_unit_list) - 8} more</li>' if len(lapsed_unit_list) > 8 else ""
        lapsed_block = f'<p style="color:#374151;font-weight:600;margin-top:16px">Units requiring attention:</p><ul style="color:#374151;padding-left:20px;line-height:2">{items}{more}</ul>'

    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      <p style="color:#374151">Here's the compliance summary for <strong>{_html.escape(hoa_name)}</strong>:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #e5e7eb;border-radius:8px">
        <tr style="background:#f8fafc">
          <td style="padding:10px 16px;color:#374151;font-weight:600;border-bottom:1px solid #e5e7eb">Total Units</td>
          <td style="padding:10px 16px;color:#374151;border-bottom:1px solid #e5e7eb">{total_units}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:#374151;font-weight:600;border-bottom:1px solid #e5e7eb">Compliant</td>
          <td style="padding:10px 16px;color:#16a34a;font-weight:700;border-bottom:1px solid #e5e7eb">{compliant} ({pct}%)</td>
        </tr>
        <tr style="background:#f8fafc">
          <td style="padding:10px 16px;color:#374151;font-weight:600;border-bottom:1px solid #e5e7eb">Expiring Soon</td>
          <td style="padding:10px 16px;color:#ca8a04;font-weight:700;border-bottom:1px solid #e5e7eb">{expiring}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;color:#374151;font-weight:600;border-bottom:1px solid #e5e7eb">Lapsed</td>
          <td style="padding:10px 16px;color:#dc2626;font-weight:700;border-bottom:1px solid #e5e7eb">{lapsed}</td>
        </tr>
        <tr style="background:#f8fafc">
          <td style="padding:10px 16px;color:#374151;font-weight:600">Missing</td>
          <td style="padding:10px 16px;color:#dc2626;font-weight:700">{missing}</td>
        </tr>
      </table>
      {lapsed_block}
      {_btn(dashboard_url, "View Full Dashboard")}
      {_footer()}
    </div></body></html>"""

    return subject, html


def _build_quote_url(tenant_name: str, unit_number: str) -> str:
    from urllib.parse import urlencode
    params = urlencode({"tenant_name": tenant_name or "", "unit": unit_number or ""})
    sep = "&" if "?" in QUOTE_FORM_URL else "?"
    return f"{QUOTE_FORM_URL}{sep}{params}"
