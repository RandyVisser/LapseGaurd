"""
Unit list import: turn a property manager's real spreadsheet (any column
names, CSV or Excel, messy dates) into rows that fit our units schema.

The flow is two-step so the PM can see what we understood before committing:
  1. preview — parse the file, let Claude map their columns to our fields,
     normalize a sample, and surface issues.
  2. commit — apply the (possibly PM-adjusted) mapping to every row and insert.

Everything degrades gracefully: if the AI mapping is unavailable, a heuristic
alias match is used; a single bad row never aborts the whole import.
"""
import csv
import io
import json
import logging
import os
import re
from datetime import date, datetime

import anthropic

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Fields a PM can map their columns onto. unit_number is the only required one.
SCHEMA_FIELDS = [
    {"key": "unit_number", "label": "Unit number", "required": True,
     "hint": "unit / apt number, e.g. 4B, 101, PH2"},
    {"key": "owner_primary", "label": "Primary owner name", "hint": "full name of the main owner"},
    {"key": "email_primary", "label": "Primary owner email"},
    {"key": "owner_secondary", "label": "Secondary owner name"},
    {"key": "email_secondary", "label": "Secondary owner email"},
    {"key": "street_address", "label": "Street address", "hint": "street only, no unit number"},
    {"key": "city", "label": "City"},
    {"key": "state", "label": "State", "hint": "2-letter code"},
    {"key": "zip", "label": "ZIP"},
    {"key": "purchase_date", "label": "Purchase date"},
]
FIELD_KEYS = [f["key"] for f in SCHEMA_FIELDS]

# Heuristic fallback: normalized header substring → field. Order matters
# (more specific first) so "owner email" maps to email, not owner name.
_HEURISTICS = [
    ("email_secondary", ["secondary email", "email 2", "email2", "co-owner email", "second email"]),
    ("owner_secondary", ["secondary name", "secondary owner", "co-owner", "owner 2", "second owner", "joint owner"]),
    ("email_primary", ["primary email", "owner email", "email 1", "email1", "e-mail", "email"]),
    ("owner_primary", ["primary name", "owner name", "owner", "resident", "name", "member"]),
    ("unit_number", ["unit number", "unit #", "unit no", "unit", "apt", "apartment", "suite"]),
    ("street_address", ["street address", "address", "street", "property address"]),
    ("city", ["city", "town"]),
    ("state", ["state", "st", "province"]),
    ("zip", ["zip", "postal", "zipcode", "zip code"]),
    ("purchase_date", ["purchase date", "purchased", "closing date", "acquired", "sale date"]),
]

_MAX_PREVIEW_ROWS = 12
_MAX_ROWS = 5000


def parse_upload(filename: str, content: bytes) -> tuple[list[str], list[dict]]:
    """Parse a CSV or XLSX upload into (headers, rows-as-dicts). Raises
    ValueError with a friendly message on unreadable input."""
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        return _parse_xlsx(content)
    return _parse_csv(content)


def _parse_csv(content: bytes) -> tuple[list[str], list[dict]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    headers = [h.strip() for h in (reader.fieldnames or []) if h and h.strip()]
    if not headers:
        raise ValueError("That file has no column headers we could read.")
    rows = []
    for raw in reader:
        rows.append({(k or "").strip(): (v or "").strip() for k, v in raw.items() if k})
        if len(rows) >= _MAX_ROWS:
            break
    if not rows:
        raise ValueError("That file has headers but no data rows.")
    return headers, rows


def _parse_xlsx(content: bytes) -> tuple[list[str], list[dict]]:
    import openpyxl
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise ValueError("We couldn't open that Excel file. Try saving it as CSV.")
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        raise ValueError("That spreadsheet is empty.")
    headers = [str(h).strip() if h is not None else "" for h in header_row]
    headers = [h for h in headers if h]
    if not headers:
        raise ValueError("That spreadsheet's first row has no column headers.")
    rows = []
    for values in rows_iter:
        if values is None or all(v is None or str(v).strip() == "" for v in values):
            continue
        row = {}
        for h, v in zip(header_row, values):
            if h is None or str(h).strip() == "":
                continue
            row[str(h).strip()] = _cell_to_str(v)
        rows.append(row)
        if len(rows) >= _MAX_ROWS:
            break
    if not rows:
        raise ValueError("That spreadsheet has headers but no data rows.")
    return headers, rows


def _cell_to_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))  # avoid "101.0" for numeric unit/zip cells
    return str(v).strip()


# ── Date normalization ────────────────────────────────────────────────────────

_DATE_FORMATS = [
    "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%m-%d-%y",
    "%d/%m/%Y", "%b %d, %Y", "%B %d, %Y", "%m/%d/%Y %H:%M:%S", "%Y/%m/%d",
]


def flexible_date(s) -> str | None:
    """Parse a date in any common spreadsheet format → ISO string, or None.
    Never raises — unparseable input just yields None."""
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


# ── Column mapping ────────────────────────────────────────────────────────────

def heuristic_mapping(headers: list[str]) -> dict:
    """Best-effort field → header guess using name aliases. Each header maps to
    at most one field; each field to at most one header."""
    mapping: dict[str, str] = {}
    used: set[str] = set()
    norm = {h: re.sub(r"[^a-z0-9 ]", " ", h.lower()).strip() for h in headers}
    for field, aliases in _HEURISTICS:
        if field in mapping:
            continue
        for alias in aliases:
            hit = next((h for h in headers if h not in used and (
                norm[h] == alias or norm[h].replace(" ", "") == alias.replace(" ", "")
                or alias in norm[h])), None)
            if hit:
                mapping[field] = hit
                used.add(hit)
                break
    return mapping


async def ai_suggest_mapping(headers: list[str], sample_rows: list[dict]) -> dict:
    """Ask Claude to map the spreadsheet's columns to our schema fields. Falls
    back to the heuristic mapping if the AI is unavailable or returns garbage."""
    fallback = heuristic_mapping(headers)
    if not ANTHROPIC_API_KEY:
        return fallback
    fields_desc = "\n".join(
        f"- {f['key']}: {f['label']}" + (f" ({f['hint']})" if f.get('hint') else "")
        for f in SCHEMA_FIELDS
    )
    sample = [{h: r.get(h, "") for h in headers} for r in sample_rows[:5]]
    prompt = (
        "You map spreadsheet columns to a fixed schema for a condo unit list.\n"
        "Return ONLY a JSON object whose keys are schema field names and whose "
        "values are the EXACT column header string that best fits, or null if no "
        "column fits. Each column header may be used at most once. Do not invent "
        "headers.\n\n"
        f"Schema fields:\n{fields_desc}\n\n"
        f"Column headers: {json.dumps(headers)}\n\n"
        f"Sample rows: {json.dumps(sample, default=str)}\n\n"
        "JSON mapping:"
    )
    try:
        client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        msg = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        text = msg.content[0].text.strip()
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:]).rsplit("```", 1)[0]
        proposed = json.loads(text.strip())
    except Exception as e:
        logger.warning("AI column mapping failed, using heuristic: %s", e)
        return fallback

    # Keep only valid field→real-header pairs; ignore hallucinated headers
    valid_headers = set(headers)
    mapping: dict[str, str] = {}
    used: set[str] = set()
    for field in FIELD_KEYS:
        col = proposed.get(field)
        if isinstance(col, str) and col in valid_headers and col not in used:
            mapping[field] = col
            used.add(col)
    # Fill any field the AI missed with the heuristic guess (if its column is free)
    for field, col in fallback.items():
        if field not in mapping and col not in used:
            mapping[field] = col
            used.add(col)
    return mapping


# ── Row normalization ─────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_row(raw: dict, mapping: dict) -> tuple[dict, list[str]]:
    """Apply the field→column mapping to one raw row and clean the values.
    Returns (normalized_field_dict, issues). Issues are human-readable strings;
    a row with a 'missing unit number' issue will be skipped on commit."""
    out: dict = {}
    issues: list[str] = []

    def val(field):
        col = mapping.get(field)
        return (raw.get(col) or "").strip() if col else ""

    unit = val("unit_number")
    street_override = None
    # If the unit number is embedded in the address ("123 Main St Apt 4B") and
    # no dedicated column mapped, pull it out and strip it from the street
    if not unit and mapping.get("street_address"):
        street, embedded = _split_unit(val("street_address"))
        if embedded:
            unit = embedded
            street_override = street
    out["unit_number"] = unit or None
    if not unit:
        issues.append("no unit number — will be skipped")

    for field in ("owner_primary", "owner_secondary", "city"):
        out[field] = val(field) or None
    out["street_address"] = street_override or (val("street_address") or None)

    state = val("state").upper()
    if state and len(state) > 2:
        state = _STATE_ABBR.get(state.lower(), state[:2].upper())
    out["state"] = state or None

    zip_v = val("zip")
    out["zip"] = (zip_v.split("-")[0].strip() or None) if zip_v else None

    for field in ("email_primary", "email_secondary"):
        e = val(field)
        if e and not _EMAIL_RE.match(e):
            issues.append(f"'{e}' doesn't look like a valid email")
            out[field] = e  # keep it; admin can fix — don't silently drop
        else:
            out[field] = e or None

    pd_raw = val("purchase_date")
    if pd_raw:
        iso = flexible_date(pd_raw)
        if iso:
            out["purchase_date"] = iso
        else:
            issues.append(f"couldn't read purchase date '{pd_raw}'")
            out["purchase_date"] = None
    else:
        out["purchase_date"] = None

    return out, issues


def _split_unit(raw: str) -> tuple[str | None, str | None]:
    raw = (raw or "").strip()
    m = re.search(r"\b(APT|UNIT|STE|SUITE|PH|#)\s*(\S+)", raw, re.IGNORECASE)
    if m:
        ident = m.group(2)
        unit = ident if m.group(1).upper() != "PH" else f"PH{ident}"
        street = raw[: m.start()].strip().rstrip(",")
        return street or None, unit or None
    return raw or None, None


def build_preview(headers: list[str], rows: list[dict], mapping: dict) -> dict:
    """Normalize a sample for the preview screen and summarize issues across all
    rows, without committing anything."""
    preview = []
    missing_unit = invalid_email = bad_date = 0
    for raw in rows:
        norm, issues = normalize_row(raw, mapping)
        for i in issues:
            if "unit number" in i:
                missing_unit += 1
            elif "email" in i:
                invalid_email += 1
            elif "date" in i:
                bad_date += 1
        if len(preview) < _MAX_PREVIEW_ROWS:
            preview.append({"data": norm, "issues": issues})
    summary = []
    if missing_unit:
        summary.append(f"{missing_unit} row(s) have no unit number and will be skipped")
    if invalid_email:
        summary.append(f"{invalid_email} email(s) look invalid (kept for you to fix)")
    if bad_date:
        summary.append(f"{bad_date} purchase date(s) couldn't be read")
    return {
        "fields": SCHEMA_FIELDS,
        "headers": headers,
        "mapping": mapping,
        "preview": preview,
        "total_rows": len(rows),
        "importable": sum(1 for r in rows if normalize_row(r, mapping)[0]["unit_number"]),
        "issues": summary,
    }


_STATE_ABBR = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
    "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO",
    "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
    "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}


# ── Add-Emails wizard: match an uploaded list onto EXISTING units ─────────────

def _norm_unit_key(s: str | None) -> str:
    """Same normalization as routes.hoa._norm_unit (kept here so the planner is
    importable without the route module): '204', 'Apt 204', '#204' all match."""
    s = (s or "").strip().upper()
    s = re.sub(r"^(APT|UNIT|STE|SUITE|#)\.?\s*", "", s)
    return s.replace("#", "").strip()


def _norm_addr_key(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().upper())


_CONTACT_TITLES = {"property manager", "admin"}
_CONTACT_UNIT_NUMBERS = {"PM", "ADMIN"}


def _is_owner_unit(u: dict) -> bool:
    """Real owner units only: not a PM/ADMIN contact row and not a renter
    sub-unit (parent_unit_id set) — those must never receive owner emails."""
    if u.get("parent_unit_id"):
        return False
    if (u.get("assoc_title") or "").strip().lower() in _CONTACT_TITLES:
        return False
    if _norm_unit_key(u.get("unit_number")) in _CONTACT_UNIT_NUMBERS:
        return False
    return True


def _is_blank_email(v: str | None) -> bool:
    """Empty or an @condo.insure placeholder — safe to fill in."""
    v = (v or "").strip().lower()
    return not v or v.endswith("@condo.insure")


def plan_email_fill(units: list[dict], rows: list[dict], mapping: dict,
                    overwrite: bool = False) -> dict:
    """Decide, row by row, what the Add-Emails wizard would do. Pure (no DB),
    so the preview endpoint, the commit endpoint and the tests all share it.

    Matching mirrors the importer's dedup key, (street_address, unit_number):
    unit numbers repeat across buildings, so a unit number alone is only
    trusted when exactly ONE owner unit in the association carries it.
      - file row has an address → exact (address, unit) match; if the unit
        number is unique in the association we still accept it when the
        association has a single street address on file (formatting noise
        like "Dr" vs "Drive"), otherwise it's refused as an address mismatch.
      - file row has no address → unit number must be unique, else AMBIGUOUS.
    Ambiguous rows are refused, never guessed.

    "Fill in" semantics: an email column is only written when the unit's
    current value is blank or a placeholder. A different existing email is a
    CONFLICT and is kept — unless overwrite=True, which the preview must make
    explicit to the admin.

    Returns {"rows": [...per input row...], "counts": {...},
             "updates": [{"unit_id", "email_primary"?, "email_secondary"?}]}."""
    owner_units = [u for u in units if _is_owner_unit(u)]
    by_key: dict = {}
    by_unit: dict = {}
    for u in owner_units:
        nu = _norm_unit_key(u.get("unit_number"))
        by_key.setdefault((_norm_addr_key(u.get("street_address")), nu), []).append(u)
        by_unit.setdefault(nu, []).append(u)
    distinct_addrs = {_norm_addr_key(u.get("street_address")) for u in owner_units
                      if _norm_addr_key(u.get("street_address"))}
    single_address = len(distinct_addrs) <= 1

    out_rows: list = []
    updates: list = []
    claimed: dict = {}  # unit_id -> index of the file row that claimed it
    counts = {k: 0 for k in ("fill", "replace", "unchanged", "conflict", "ambiguous",
                              "no_match", "no_email", "invalid", "duplicate")}

    for i, raw in enumerate(rows):
        norm, _issues = normalize_row(raw, mapping)
        unit = norm.get("unit_number")
        street = norm.get("street_address")
        email_p = (norm.get("email_primary") or "").strip() or None
        email_s = (norm.get("email_secondary") or "").strip() or None
        rec = {"row": i, "unit": unit, "street_address": street,
               "email_primary": email_p, "email_secondary": email_s,
               "status": None, "reason": None, "unit_id": None, "candidates": []}
        out_rows.append(rec)

        if not unit or (not email_p and not email_s):
            rec["status"], rec["reason"] = "no_email", ("no unit number" if not unit else "no email")
            counts["no_email"] += 1
            continue
        bad = [e for e in (email_p, email_s) if e and not _EMAIL_RE.match(e)]
        if bad:
            rec["status"], rec["reason"] = "invalid", f"'{bad[0]}' doesn't look like a valid email"
            counts["invalid"] += 1
            continue

        nu = _norm_unit_key(unit)
        candidates = by_unit.get(nu, [])
        match = None
        if street:
            exact = by_key.get((_norm_addr_key(street), nu), [])
            if len(exact) == 1:
                match = exact[0]
            elif len(exact) > 1:
                rec["status"] = "ambiguous"
                rec["reason"] = "more than one unit on file has this address and unit number"
                rec["candidates"] = [c.get("street_address") for c in exact]
            elif len(candidates) == 1 and (single_address or not _norm_addr_key(candidates[0].get("street_address"))):
                match = candidates[0]
            elif candidates:
                rec["status"] = "ambiguous" if len(candidates) > 1 else "no_match"
                rec["reason"] = (f"unit {unit} exists at a different address"
                                 if len(candidates) == 1 else
                                 f"unit {unit} exists at {len(candidates)} addresses, none matching this row")
                rec["candidates"] = [c.get("street_address") for c in candidates]
            else:
                rec["status"], rec["reason"] = "no_match", "no unit with this number"
        else:
            if len(candidates) == 1:
                match = candidates[0]
            elif len(candidates) > 1:
                rec["status"] = "ambiguous"
                rec["reason"] = (f"unit {unit} exists at {len(candidates)} addresses — "
                                 "add a street address column to tell them apart")
                rec["candidates"] = [c.get("street_address") for c in candidates]
            else:
                rec["status"], rec["reason"] = "no_match", "no unit with this number"

        if match is None:
            counts[rec["status"]] += 1
            continue

        uid = str(match["id"])
        rec["unit_id"] = uid
        rec["matched_address"] = match.get("street_address")
        if uid in claimed:
            rec["status"] = "duplicate"
            rec["reason"] = f"same unit as row {claimed[uid] + 1} of the file — first row wins"
            counts["duplicate"] += 1
            continue
        claimed[uid] = i

        upd: dict = {}
        changes = []  # per-field outcome
        for field, new in (("email_primary", email_p), ("email_secondary", email_s)):
            if not new:
                continue
            cur = (match.get(field) or "").strip()
            if cur.lower() == new.lower():
                changes.append("unchanged")
            elif _is_blank_email(cur):
                upd[field] = new
                changes.append("fill")
            elif overwrite:
                upd[field] = new
                changes.append("replace")
                rec.setdefault("replaces", {})[field] = cur
            else:
                changes.append("conflict")
                rec.setdefault("existing", {})[field] = cur

        if "replace" in changes:
            status = "replace"
        elif "fill" in changes:
            status = "fill"
        elif "conflict" in changes:
            status = "conflict"
        else:
            status = "unchanged"
        rec["status"] = status
        if status == "conflict":
            rec["reason"] = "unit already has a different email — kept"
        elif status == "unchanged":
            rec["reason"] = "already on file"
        counts[status] += 1
        if upd:
            updates.append({"unit_id": uid, **upd})

    return {"rows": out_rows, "counts": counts, "updates": updates}
