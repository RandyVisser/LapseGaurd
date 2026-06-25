"""
Lease parsing for subrented units. When the owner uploads the lease, we pull the
renter name(s) (and term) to prefill the renter sub-unit. Reuses the dec-page
parser's pdfplumber + Claude Haiku plumbing.
"""
import base64
import logging

import anthropic

from services.policy_parser import ANTHROPIC_API_KEY, _extract_pdf_text, _parse_response

logger = logging.getLogger(__name__)

LEASE_PROMPT = """You are reading a residential LEASE agreement for a condominium or apartment unit.
Extract the following and return STRICT JSON only (no prose, no markdown fences):
{
  "tenant_names": ["Full Name", ...],    // every named TENANT / LESSEE / renter (NOT the landlord/owner/lessor)
  "tenant_emails": ["name@email.com", ...], // email addresses for the tenants/lessees, if shown
  "landlord_names": ["Full Name", ...],  // the landlord / lessor / owner, if shown
  "property_address": "unit address as written, or null",
  "lease_start": "YYYY-MM-DD or null",
  "lease_end": "YYYY-MM-DD or null",
  "is_lease": true                        // false if this document is NOT actually a lease
}
List only real people as tenant_names. Use null for missing scalars and [] for missing lists."""


async def parse_lease_bytes(content: bytes, content_type: str) -> dict | None:
    """Parse lease document bytes → {tenant_names, lease_start, ...} or None."""
    if not ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY not set — skipping lease parsing")
        return None
    try:
        client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        if "pdf" in (content_type or ""):
            text = _extract_pdf_text(content)
            return await _lease_with_pdf(client, content, text if len(text.strip()) > 100 else None)
        media_type = content_type if (content_type or "").startswith("image/") else "image/jpeg"
        return await _lease_with_vision(client, content, media_type)
    except Exception as e:
        logger.error(f"Lease parsing failed: {e}")
        return None


async def _lease_with_pdf(client: anthropic.AsyncAnthropic, content: bytes, text_hint: str | None) -> dict | None:
    b64 = base64.standard_b64encode(content).decode()
    message_content = [
        {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}},
    ]
    prompt = (f"Extracted text from the document (use as a hint):\n{text_hint[:6000]}\n\n{LEASE_PROMPT}"
              if text_hint else LEASE_PROMPT)
    message_content.append({"type": "text", "text": prompt})
    msg = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{"role": "user", "content": message_content}],
    )
    return _parse_response(msg.content[0].text)


async def _lease_with_vision(client: anthropic.AsyncAnthropic, content: bytes, media_type: str) -> dict | None:
    b64 = base64.standard_b64encode(content).decode()
    msg = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                {"type": "text", "text": LEASE_PROMPT},
            ],
        }],
    )
    return _parse_response(msg.content[0].text)
