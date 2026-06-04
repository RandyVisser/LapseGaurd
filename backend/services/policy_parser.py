"""
Parses insurance dec pages using pdfplumber (for native PDFs) or
Claude Haiku vision (for scanned PDFs / images). Stores extracted
fields back on the policy row.
"""
import io
import json
import os
import logging

import httpx
import pdfplumber
import anthropic

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

EXTRACT_PROMPT = """Extract the following fields from this insurance declaration page.
Return a JSON object only — no explanation, no markdown, just the JSON.

Fields:
- insurer (string)
- policy_number (string)
- effective_date (YYYY-MM-DD or null)
- expiration_date (YYYY-MM-DD or null)
- dwelling_coverage (number in dollars or null)
- liability_coverage (number in dollars or null)
- deductible (number in dollars or null)

Use null for any field not found."""


def _validate(extracted: dict, submitted: dict) -> dict:
    from datetime import date
    flags = []

    # Check expiration — use extracted date if available, fall back to submitted
    exp_str = extracted.get("expiration_date") or submitted.get("expiration_date")
    if exp_str:
        try:
            if date.fromisoformat(exp_str) < date.today():
                flags.append(f"Policy is expired — document shows expiration {exp_str}")
        except ValueError:
            pass

    # Cross-check submitted vs extracted fields
    def _norm(s): return (s or "").strip().lower()

    sub_insurer = _norm(submitted.get("insurer"))
    ext_insurer = _norm(extracted.get("insurer"))
    if sub_insurer and ext_insurer and sub_insurer not in ext_insurer and ext_insurer not in sub_insurer:
        flags.append(f"Insurer mismatch — entered '{submitted['insurer']}', document shows '{extracted['insurer']}'")

    sub_num = _norm(submitted.get("policy_number"))
    ext_num = _norm(extracted.get("policy_number"))
    if sub_num and ext_num and sub_num != ext_num:
        flags.append(f"Policy number mismatch — entered '{submitted['policy_number']}', document shows '{extracted['policy_number']}'")

    sub_exp = _norm(submitted.get("expiration_date"))
    ext_exp = _norm(extracted.get("expiration_date"))
    if sub_exp and ext_exp and sub_exp != ext_exp:
        flags.append(f"Expiration date mismatch — entered '{submitted['expiration_date']}', document shows '{extracted['expiration_date']}'")

    return {"passed": len(flags) == 0, "flags": flags}


async def parse_dec_page(document_url: str, submitted: dict | None = None) -> dict | None:
    if not ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY not set — skipping dec page parsing")
        return None

    try:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.get(document_url)
            resp.raise_for_status()
            content = resp.content
            content_type = resp.headers.get("content-type", "")

        client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

        is_pdf = "pdf" in content_type or document_url.lower().endswith(".pdf")

        if is_pdf:
            # Extract text with pdfplumber; fall back to vision if text is sparse
            text = _extract_pdf_text(content)
            if len(text.strip()) > 100:
                result = await _parse_with_text(client, text)
            else:
                result = await _parse_with_vision(client, content, "image/jpeg")
        else:
            # Image file — go straight to vision
            media_type = content_type if content_type.startswith("image/") else "image/jpeg"
            result = await _parse_with_vision(client, content, media_type)

        if result:
            result["validation"] = _validate(result, submitted or {})
        return result

    except Exception as e:
        logger.error(f"Dec page parsing failed for {document_url}: {e}")
        return None


def _extract_pdf_text(content: bytes) -> str:
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)


async def _parse_with_text(client: anthropic.AsyncAnthropic, text: str) -> dict | None:
    msg = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": f"{EXTRACT_PROMPT}\n\nDec page text:\n{text[:5000]}"
        }],
    )
    return _parse_response(msg.content[0].text)


async def _parse_with_vision(
    client: anthropic.AsyncAnthropic, content: bytes, media_type: str
) -> dict | None:
    import base64
    b64 = base64.standard_b64encode(content).decode()
    msg = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                {"type": "text", "text": EXTRACT_PROMPT},
            ],
        }],
    )
    return _parse_response(msg.content[0].text)


def _parse_response(text: str) -> dict | None:
    try:
        # Strip markdown code fences if present
        text = text.strip()
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:])
            text = text.rsplit("```", 1)[0]
        return json.loads(text.strip())
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Claude response as JSON: {e}\nResponse: {text}")
        return None
