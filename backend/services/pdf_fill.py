"""
Pre-fill association forms with a unit owner's details.

The uploaded forms are flat PDFs (no AcroForm fields), so we overlay the
owner's values at fixed coordinates on top of the pre-printed labels. Each
supported form is described by a coordinate map keyed on its ``doc_type``.

Coordinates are PDF points with a bottom-left origin (US Letter = 612x792).
The y values are text baselines positioned just to the right of the printed
labels in the form's UNIT-OWNER header block.
"""
from __future__ import annotations

import io
import logging

logger = logging.getLogger(__name__)

_PAGE_H = 792  # US Letter height in points

# doc_type -> list of (x, y_baseline, data_key)
_SPRINKLER_FIELDS = [
    (135, _PAGE_H - 124.2 + 2, "date"),            # DATE
    (135, _PAGE_H - 179.0 + 2, "name"),            # NAME
    (135, _PAGE_H - 195.8 + 2, "address"),         # ADDRESS
    (135, _PAGE_H - 212.7 + 2, "unit_number"),     # UNIT #
    (135, _PAGE_H - 229.5 + 2, "city_state_zip"),  # CITY, ST, ZIP
]

# Forms we know how to pre-fill. Add new entries here as more fillable forms
# are introduced; the doc_type must match what AdminDocuments stores.
_FORM_FIELDS = {
    "Sprinkler Alarm Form": _SPRINKLER_FIELDS,
}


def is_fillable(doc_type: str | None) -> bool:
    """True when we have a coordinate map for this form's doc_type."""
    return bool(doc_type) and doc_type in _FORM_FIELDS


def fill_form(template_bytes: bytes, doc_type: str, data: dict) -> bytes | None:
    """Overlay ``data`` onto the form template and return the merged PDF bytes,
    or None if the doc_type isn't a known fillable form."""
    fields = _FORM_FIELDS.get(doc_type)
    if not fields:
        return None

    # Imported lazily so the rest of the app doesn't hard-depend on these.
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
    from pypdf import PdfReader, PdfWriter

    overlay_buf = io.BytesIO()
    c = canvas.Canvas(overlay_buf, pagesize=letter)
    c.setFont("Helvetica", 10)
    c.setFillColorRGB(0.0, 0.0, 0.55)  # dark blue, clearly "filled in"
    for x, y, key in fields:
        value = str(data.get(key) or "").strip()
        if value:
            c.drawString(x, y, value)
    c.save()
    overlay_buf.seek(0)

    base = PdfReader(io.BytesIO(template_bytes))
    overlay = PdfReader(overlay_buf)
    writer = PdfWriter()
    # Overlay lands on the first page (the form header); keep any other pages.
    first = base.pages[0]
    first.merge_page(overlay.pages[0])
    writer.add_page(first)
    for page in base.pages[1:]:
        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
