import html as _html
import os
import httpx

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "alerts@condo.insure")
QUOTE_FORM_URL = os.environ.get("QUOTE_FORM_URL", "")
APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")
INBOUND_ADDRESS = os.environ.get("INBOUND_ADDRESS", "docs@condo.insure")


async def send_email(to_email: str, subject: str, html: str, reply_to: str | None = None) -> bool:
    if not RESEND_API_KEY:
        print(f"[email] RESEND_API_KEY not set — skipping email to {to_email}")
        return False
    payload = {"from": FROM_EMAIL, "to": [to_email], "subject": subject, "html": html}
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
) -> tuple[str, str]:
    exp_str = expiration_date.isoformat() if expiration_date else "unknown"

    if status == "lapsed":
        subject = "Action required — your insurance policy has lapsed"
        body = f"Your condo insurance policy expired on <strong>{exp_str}</strong> and is no longer active."
    else:
        subject = "Your condo insurance policy is expiring soon"
        body = f"Your condo insurance policy expires on <strong>{exp_str}</strong>. Now is a great time to renew."

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
) -> tuple[str, str]:
    subject = f"Action requested — {hoa_name} insurance compliance"
    greeting = "Dear " + ((recipient_name or "").strip() or "Unit Owner")

    # Property managers get a short admin invite; unit owners get the full notice
    if is_property_manager:
        body = f"""
      <p style="color:#374151">Hi,</p>
      <p style="color:#374151">
        Your condo association <strong>{hoa_name}</strong> has invited you to join
        condo.insure as a <strong>property manager</strong>. Once you create your
        account you can track unit-owner insurance compliance, manage documents,
        and stay on top of renewals — all in one place.
      </p>
      {_btn(invite_url, "Create Your Account")}
      <p style="color:#6b7280;font-size:13px;margin-top:8px">
        This link is unique to you ({email}) and can only be used once.
      </p>"""
    else:
        # Signature block: corp name, signer name, title, "For the Board", email
        sig_lines = [
            (corp_name or hoa_name),
            (sender_name or "").strip() or None,
            (sender_title or "").strip() or "Property Manager",
            "For the Board",
            (sender_email or "").strip() or None,
        ]
        signature = "<br>".join(line for line in sig_lines if line)
        body = f"""
      <p style="color:#374151">{greeting},</p>
      <p style="color:#374151">
        To help maintain accurate insurance records and simplify compliance with our
        condominium insurance requirements, the Association has partnered with
        <strong>Condo.insure</strong>, a secure online insurance compliance platform.
      </p>

      <p style="color:#111827;font-weight:700;margin-top:20px">Why am I receiving this notice?</p>
      <p style="color:#374151">
        The Association's governing documents require unit owners to maintain insurance
        for portions of their unit that are not covered by the Association's master
        policy. In addition, maintaining appropriate insurance helps protect you from
        losses involving personal property, interior improvements, liability claims,
        loss assessments, and other expenses that may not be covered by the
        Association's insurance policy.
      </p>
      <p style="color:#374151">
        To streamline this process, the Association will now use Condo.insure to
        collect and track unit-owner insurance information.
      </p>

      <p style="color:#111827;font-weight:700;margin-top:20px">What do I need to do?</p>
      <p style="color:#374151">Visit the secure compliance portal and:</p>
      {_btn(invite_url, "Open the Compliance Portal")}
      <ol style="color:#374151;padding-left:20px;margin-top:8px">
        <li>Confirm your contact information.</li>
        <li>Upload one of the following:
          <ul style="padding-left:18px;margin:6px 0">
            <li>Your current HO-6 Condominium Unit Owners Policy Declaration Page</li>
            <li>A Certificate of Insurance showing active coverage</li>
          </ul>
        </li>
        <li>Submit the information at your earliest convenience.</li>
      </ol>

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
        If you already maintain condominium unit-owner insurance, the process should
        only take a few minutes.
      </p>
      <p style="color:#374151">
        If you do not currently have insurance or have questions regarding your
        coverage, please contact your insurance agent or carrier for assistance.
      </p>
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


def welcome_admin_html(admin_name: str, hoa_name: str) -> tuple[str, str]:
    subject = f"Welcome to condo.insure — let's get {hoa_name} set up"
    dashboard_url = f"{APP_URL}/admin/dashboard"
    html = f"""
    <html><body style="margin:0;background:#f1f5f9;
          font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:600px;margin:0 auto;padding:24px 12px">
        {_header()}
        <p style="color:#111827;font-size:16px;margin:0 0 4px">Hi {admin_name},</p>
        <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px">
          Your account for <strong>{hoa_name}</strong> is ready — you can sign in right now.
          Here's the quickest path to a compliance dashboard that keeps itself up to date:
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

        {_btn(dashboard_url, "Go to your dashboard")}

        <p style="color:#9ca3af;font-size:13px;line-height:1.5;margin:16px 0 0">
          Questions while you're getting set up? Just reply to this email.
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
    if not QUOTE_FORM_URL:
        return APP_URL
    from urllib.parse import urlencode
    params = urlencode({"tenant_name": tenant_name, "unit": unit_number})
    sep = "&" if "?" in QUOTE_FORM_URL else "?"
    return f"{QUOTE_FORM_URL}{sep}{params}"
