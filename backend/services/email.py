import html as _html
import os
import httpx

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "alerts@condo.insure")
QUOTE_FORM_URL = os.environ.get("QUOTE_FORM_URL", "")
APP_URL = os.environ.get("APP_URL", "https://www.condo.insure")


async def send_email(to_email: str, subject: str, html: str) -> bool:
    if not RESEND_API_KEY:
        print(f"[email] RESEND_API_KEY not set — skipping email to {to_email}")
        return False
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={"from": FROM_EMAIL, "to": [to_email], "subject": subject, "html": html},
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
      LapseGuard — Condo Association Insurance Compliance
    </p>"""


def _header() -> str:
    return """
    <div style="background:#1e40af;padding:20px 24px;border-radius:8px 8px 0 0">
      <span style="color:#ffffff;font-size:20px;font-weight:700">LapseGuard</span>
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
) -> tuple[str, str]:
    subject = f"You've been invited to join {hoa_name} on LapseGuard"
    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      <p style="color:#374151">Hi,</p>
      <p style="color:#374151">
        Your condo association <strong>{hoa_name}</strong> has invited you to set up
        your insurance compliance profile for <strong>Unit {unit_number}</strong>.
      </p>
      <p style="color:#374151">
        Once you create your account you can upload your proof of insurance,
        track your policy status, and receive renewal reminders — all in one place.
      </p>
      {_btn(invite_url, "Create Your Account")}
      <p style="color:#6b7280;font-size:13px;margin-top:8px">
        This link is unique to you ({email}) and can only be used once.
      </p>
      {_footer()}
    </div></body></html>"""
    return subject, html


def welcome_admin_html(admin_name: str, hoa_name: str) -> tuple[str, str]:
    subject = f"Welcome to LapseGuard — let's get {hoa_name} set up"
    dashboard_url = f"{APP_URL}/admin/dashboard"
    html = f"""
    <html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px 0">
      {_header()}
      <p style="color:#374151">Hi {admin_name},</p>
      <p style="color:#374151">
        Your <strong>{hoa_name}</strong> account is ready on LapseGuard. Here's how to get started:
      </p>
      <ol style="color:#374151;padding-left:20px;line-height:2">
        <li>Log in to your dashboard</li>
        <li>Add your units (or import them from a CSV)</li>
        <li>Invite unit-owners to upload their proof of insurance</li>
        <li>Review uploaded policies and track compliance</li>
      </ol>
      {_btn(dashboard_url, "Go to Dashboard")}
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


def _build_quote_url(tenant_name: str, unit_number: str) -> str:
    if not QUOTE_FORM_URL:
        return APP_URL
    from urllib.parse import urlencode
    params = urlencode({"tenant_name": tenant_name, "unit": unit_number})
    sep = "&" if "?" in QUOTE_FORM_URL else "?"
    return f"{QUOTE_FORM_URL}{sep}{params}"
