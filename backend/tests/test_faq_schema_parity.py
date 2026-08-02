"""
Guard: the FAQPage JSON-LD in frontend/index.html must match the FAQ actually
rendered by Landing.jsx.

schema.org (and Google's structured-data rules) require the marked-up answer to
be visible on the page. Because the markup lives in a static <head> — so that
crawlers which don't run JS can read it — and the visible copy lives in a React
component, the two drift silently whenever someone tunes the wording. That has
already happened once: "We read each declaration page" became "Our AI reads each
declaration page" on the page while the schema kept the old sentence.

Nothing about this is caught by a build, a lint, or a rendered page. Hence a test.
"""
import html
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
LANDING = REPO / "frontend" / "src" / "pages" / "Landing.jsx"
INDEX = REPO / "frontend" / "index.html"


def _clean(text: str) -> str:
    """Visible text: strip inline tags (the FAQ answers carry contextual links),
    unescape entities, collapse whitespace."""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", text))).strip()


def _page_faqs() -> dict[str, str]:
    pairs = re.findall(r"<summary>(.*?)</summary>\s*<p>(.*?)</p>", LANDING.read_text(), re.S)
    return {_clean(q): _clean(a) for q, a in pairs}


def _schema_faqs() -> dict[str, str]:
    for block in re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', INDEX.read_text(), re.S
    ):
        data = json.loads(block)
        for node in data.get("@graph", [data]):
            if node.get("@type") == "FAQPage":
                return {
                    _clean(e["name"]): _clean(e["acceptedAnswer"]["text"])
                    for e in node["mainEntity"]
                }
    raise AssertionError("No FAQPage node found in index.html")


class TestFaqSchemaParity:
    def test_same_questions(self):
        page, schema = set(_page_faqs()), set(_schema_faqs())
        assert page == schema, (
            f"On the page but not in the schema: {sorted(page - schema)}\n"
            f"In the schema but not on the page: {sorted(schema - page)}\n"
            "Google requires marked-up FAQ answers to be visible on the page."
        )

    def test_same_answers(self):
        page, schema = _page_faqs(), _schema_faqs()
        drifted = [q for q in schema if q in page and page[q] != schema[q]]
        assert not drifted, (
            "FAQ answers differ between Landing.jsx and the JSON-LD in "
            f"index.html: {drifted}. Update the schema to match the visible copy "
            "(including curly apostrophes — keep them byte-identical)."
        )

    def test_the_faq_is_not_empty(self):
        assert len(_page_faqs()) >= 4, "Landing FAQ parser found too few items — did the markup change?"
