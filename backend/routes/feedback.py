"""
In-app feedback / feature requests / help-needed.
  POST /feedback        — any logged-in user submits; stored + emailed to super-users
  GET  /feedback        — super-user inbox (all submissions)
  PATCH /feedback/{id}  — super-user marks resolved/new
"""
import html as _html
import logging

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.jwt import AuthUser, get_current_user
from models.db import get_conn
from services.email import send_email, APP_URL

router = APIRouter()
logger = logging.getLogger(__name__)

_TYPES = {"feedback", "feature", "help"}
_TYPE_LABEL = {"feedback": "Feedback", "feature": "Feature request", "help": "Help needed"}


class FeedbackCreate(BaseModel):
    type: str = "feedback"
    message: str
    page: str | None = None
    hoa_id: str | None = None


class FeedbackStatus(BaseModel):
    status: str  # new | resolved


async def _notify_super_users(conn, sub: dict) -> None:
    """Email every super-user so feedback shows up immediately; reply-to is the
    submitter so they can answer the person directly."""
    rows = await conn.fetch(
        "SELECT email FROM auth.users WHERE raw_app_meta_data->>'role' = 'super_user' AND email IS NOT NULL"
    )
    recipients = [r["email"] for r in rows]
    if not recipients:
        return
    label = _TYPE_LABEL.get(sub["type"], "Feedback")
    subject = f"[condo.insure] {label} from {sub['email'] or 'a user'}"
    html = f"""
    <div style="font-family:sans-serif;max-width:600px">
      <p style="font-size:16px;font-weight:600">{label}</p>
      <table style="font-size:14px;color:#374151">
        <tr><td style="padding:2px 12px 2px 0;color:#6b7280">From</td><td>{_html.escape(sub['email'] or '—')} ({_html.escape(sub['role'] or '—')})</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Page</td><td>{_html.escape(sub['page'] or '—')}</td></tr>
      </table>
      <p style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-top:12px;color:#111827">{_html.escape(sub['message'])}</p>
      <p style="font-size:13px;color:#9ca3af;margin-top:12px">Reply to this email to respond to {_html.escape(sub['email'] or 'the user')}. Triage at <a href="{APP_URL}/admin/feedback">{APP_URL}/admin/feedback</a>.</p>
    </div>"""
    for to in recipients:
        await send_email(to, subject, html, reply_to=sub["email"] or None)


@router.post("/feedback", status_code=201)
async def submit_feedback(
    body: FeedbackCreate,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="Message is required")
    ftype = body.type if body.type in _TYPES else "feedback"
    row = await conn.fetchrow(
        """INSERT INTO feedback (user_id, email, role, hoa_id, page, type, message)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id""",
        user.sub, user.email, user.role,
        body.hoa_id if body.hoa_id and body.hoa_id != "__all__" else None,
        (body.page or "")[:300], ftype, message[:5000],
    )
    try:
        await _notify_super_users(conn, {
            "email": user.email, "role": user.role, "page": body.page,
            "type": ftype, "message": message,
        })
    except Exception:
        logger.exception("Failed to email super-users about feedback %s", row["id"])
    return {"id": str(row["id"])}


def _require_super_user(user: AuthUser):
    if user.role != "super_user":
        raise HTTPException(status_code=403, detail="Super-user only")


@router.get("/feedback")
async def list_feedback(
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    _require_super_user(user)
    rows = await conn.fetch(
        """SELECT f.id, f.email, f.role, f.page, f.type, f.message, f.status, f.created_at,
                  h.name AS hoa_name
           FROM feedback f LEFT JOIN hoas h ON h.id = f.hoa_id
           ORDER BY (f.status = 'new') DESC, f.created_at DESC
           LIMIT 500"""
    )
    return [
        {
            "id": str(r["id"]), "email": r["email"], "role": r["role"], "page": r["page"],
            "type": r["type"], "message": r["message"], "status": r["status"],
            "hoa_name": r["hoa_name"], "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


@router.patch("/feedback/{feedback_id}")
async def update_feedback(
    feedback_id: str,
    body: FeedbackStatus,
    user: AuthUser = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_conn),
):
    _require_super_user(user)
    status = body.status if body.status in ("new", "resolved") else "new"
    row = await conn.fetchrow(
        "UPDATE feedback SET status = $1 WHERE id = $2 RETURNING id", status, feedback_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return {"updated": True, "status": status}
