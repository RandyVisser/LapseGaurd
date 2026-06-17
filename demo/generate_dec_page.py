"""
Generate demo/sample-dec-page.pdf — a text-based HO-6 declarations page for the
product walk-through. Issued to Maria Garcia (Unit 204) and built to PASS the
demo requirements (Coverage A >= $50k, Coverage E >= $300k, wind included,
named insured + property address matching the unit).

Run:  python3 demo/generate_dec_page.py
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

OUT = "demo/sample-dec-page.pdf"
W, H = letter


def line(c, y):
    c.setStrokeColorRGB(0.8, 0.82, 0.85)
    c.line(0.75 * inch, y, W - 0.75 * inch, y)


def main():
    c = canvas.Canvas(OUT, pagesize=letter)
    left = 0.75 * inch
    right = W - 0.75 * inch
    y = H - 0.8 * inch

    # ── Header ────────────────────────────────────────────────────────────
    c.setFont("Helvetica-Bold", 16)
    c.drawString(left, y, "Tower Hill Prime Insurance Company")
    y -= 16
    c.setFont("Helvetica", 9)
    c.drawString(left, y, "7300 Corporate Center Drive, Suite 600  ·  Miami, FL 33126  ·  (800) 555-0147")
    y -= 22
    c.setFont("Helvetica-Bold", 13)
    c.drawString(left, y, "HOMEOWNERS POLICY DECLARATIONS")
    c.setFont("Helvetica", 10)
    c.drawRightString(right, y, "Form HO-6 — Condominium Unit-Owners")
    y -= 10
    line(c, y)
    y -= 22

    # ── Policy / insured block ────────────────────────────────────────────
    def field(label, value, *, bold_value=True, dy=16):
        nonlocal y
        c.setFont("Helvetica", 9)
        c.setFillColorRGB(0.4, 0.43, 0.47)
        c.drawString(left, y, label)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold" if bold_value else "Helvetica", 10)
        c.drawString(left + 2.1 * inch, y, value)
        y -= dy

    field("Policy Number", "THP-HO6-2026-104872")
    field("Policy Type", "HO-6 Condominium Unit-Owners")
    field("Policy Period", "01/15/2026 to 01/15/2027  (12:01 AM Standard Time)")
    field("Named Insured", "Maria Garcia")
    field("Insured Location", "1420 Seabreeze Blvd, Apt 204, Clearwater, FL 33767")
    field("Mailing Address", "1420 Seabreeze Blvd, Apt 204, Clearwater, FL 33767")

    y -= 6
    line(c, y)
    y -= 22

    # ── Coverages ─────────────────────────────────────────────────────────
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "SECTION I — PROPERTY COVERAGES")
    y -= 18

    coverages = [
        ("Coverage A — Dwelling (Unit / Building Items)", "$75,000"),
        ("Coverage C — Personal Property", "$35,000"),
        ("Coverage D — Loss of Use", "$15,000"),
        ("Loss Assessment Coverage", "$50,000"),
    ]
    for label, amount in coverages:
        c.setFont("Helvetica", 10)
        c.drawString(left + 0.1 * inch, y, label)
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(right, y, amount)
        y -= 15

    y -= 8
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "SECTION II — LIABILITY COVERAGES")
    y -= 18
    for label, amount in [
        ("Coverage E — Personal Liability (each occurrence)", "$300,000"),
        ("Coverage F — Medical Payments to Others", "$5,000"),
    ]:
        c.setFont("Helvetica", 10)
        c.drawString(left + 0.1 * inch, y, label)
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(right, y, amount)
        y -= 15

    y -= 8
    line(c, y)
    y -= 20

    # ── Wind / deductibles ────────────────────────────────────────────────
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "WINDSTORM / HURRICANE & DEDUCTIBLES")
    y -= 18
    for label, amount in [
        ("Windstorm / Hurricane Coverage", "INCLUDED"),
        ("Hurricane Deductible", "2% of Coverage A"),
        ("All Other Perils Deductible", "$1,000"),
    ]:
        c.setFont("Helvetica", 10)
        c.drawString(left + 0.1 * inch, y, label)
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(right, y, amount)
        y -= 15

    y -= 8
    line(c, y)
    y -= 20

    # ── Additional interest ───────────────────────────────────────────────
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "ADDITIONAL INTEREST / ADDITIONAL INSURED")
    y -= 16
    c.setFont("Helvetica", 10)
    c.drawString(left + 0.1 * inch, y, "Sunset Villas Condominium Association, Inc.")
    y -= 14
    c.drawString(left + 0.1 * inch, y, "1420 Seabreeze Blvd, Clearwater, FL 33767")
    y -= 22
    line(c, y)
    y -= 20

    # ── Premium ───────────────────────────────────────────────────────────
    c.setFont("Helvetica", 10)
    c.drawString(left, y, "Total Annual Premium")
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(right, y, "$842.00")
    y -= 30

    # ── Footer ────────────────────────────────────────────────────────────
    c.setFont("Helvetica-Oblique", 8)
    c.setFillColorRGB(0.45, 0.48, 0.52)
    c.drawString(left, y, "This declarations page is a fictional sample created for a product demonstration. Not a real insurance contract.")

    c.showPage()
    c.save()
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
