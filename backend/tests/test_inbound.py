"""Tests for the inbound email webhook helpers (signature check, attachment pick,
multi-unit disambiguation)."""
import base64
import hashlib
import hmac
import time

from routes.inbound import (
    _verify_svix_signature,
    _pick_attachment,
    _match_by_subject,
    _match_by_address,
)


def _sign(secret_b64: str, msg_id: str, timestamp: str, body: bytes) -> str:
    key = base64.b64decode(secret_b64)
    signed = f"{msg_id}.{timestamp}.".encode() + body
    return base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()


SECRET_RAW = base64.b64encode(b"test-secret-key-for-webhooks").decode()
SECRET = f"whsec_{SECRET_RAW}"


def _headers(body: bytes, msg_id="msg_1", timestamp=None, sig=None):
    ts = timestamp or str(int(time.time()))
    return {
        "svix-id": msg_id,
        "svix-timestamp": ts,
        "svix-signature": sig or f"v1,{_sign(SECRET_RAW, msg_id, ts, body)}",
    }


class TestSvixVerification:
    def test_valid_signature_passes(self):
        body = b'{"type": "email.received"}'
        assert _verify_svix_signature(SECRET, _headers(body), body) is True

    def test_tampered_body_fails(self):
        body = b'{"type": "email.received"}'
        headers = _headers(body)
        assert _verify_svix_signature(SECRET, headers, b'{"type": "evil"}') is False

    def test_wrong_secret_fails(self):
        body = b"{}"
        wrong = f"whsec_{base64.b64encode(b'other-key').decode()}"
        assert _verify_svix_signature(wrong, _headers(body), body) is False

    def test_missing_headers_fail(self):
        assert _verify_svix_signature(SECRET, {}, b"{}") is False

    def test_stale_timestamp_fails(self):
        body = b"{}"
        old_ts = str(int(time.time()) - 3600)
        msg_id = "msg_1"
        headers = {
            "svix-id": msg_id,
            "svix-timestamp": old_ts,
            "svix-signature": f"v1,{_sign(SECRET_RAW, msg_id, old_ts, body)}",
        }
        assert _verify_svix_signature(SECRET, headers, body) is False

    def test_multiple_signatures_one_valid(self):
        body = b"{}"
        ts = str(int(time.time()))
        good = _sign(SECRET_RAW, "msg_1", ts, body)
        headers = {
            "svix-id": "msg_1",
            "svix-timestamp": ts,
            "svix-signature": f"v1,bogus= v1,{good}",
        }
        assert _verify_svix_signature(SECRET, headers, body) is True


class TestPickAttachment:
    def test_prefers_pdf_over_image(self):
        atts = [
            {"filename": "photo.jpg", "content_type": "image/jpeg"},
            {"filename": "dec.pdf", "content_type": "application/pdf"},
        ]
        assert _pick_attachment(atts)["filename"] == "dec.pdf"

    def test_pdf_by_filename_when_no_content_type(self):
        atts = [{"filename": "dec.PDF", "content_type": ""}]
        assert _pick_attachment(atts)["filename"] == "dec.PDF"

    def test_image_fallback(self):
        atts = [{"filename": "scan.png", "content_type": "image/png"}]
        assert _pick_attachment(atts)["filename"] == "scan.png"

    def test_no_usable_attachment(self):
        assert _pick_attachment([{"filename": "notes.txt", "content_type": "text/plain"}]) is None
        assert _pick_attachment([]) is None


UNITS = [
    {"unit_number": "1002", "street_address": "123 Ocean Blvd"},
    {"unit_number": "204", "street_address": "456 Palm Ave"},
]


class TestMatchBySubject:
    def test_unit_number_in_subject(self):
        hits = _match_by_subject("Dec page for Unit 1002", UNITS)
        assert len(hits) == 1 and hits[0]["unit_number"] == "1002"

    def test_unit_with_hash_prefix(self):
        hits = _match_by_subject("Insurance #204", UNITS)
        assert len(hits) == 1 and hits[0]["unit_number"] == "204"

    def test_no_unit_in_subject(self):
        assert _match_by_subject("My insurance documents", UNITS) == []

    def test_partial_number_does_not_match(self):
        # "100" must not match unit 1002
        assert _match_by_subject("Unit 100", UNITS) == []

    def test_empty_subject(self):
        assert _match_by_subject("", UNITS) == []


class TestMatchByAddress:
    def test_unit_and_street_match(self):
        hits = _match_by_address("123 Ocean Blvd Unit 1002, Naples FL 34102", UNITS)
        assert len(hits) == 1 and hits[0]["unit_number"] == "1002"

    def test_unit_number_alone_matches(self):
        hits = _match_by_address("Apt 204, Tampa FL", UNITS)
        assert len(hits) == 1 and hits[0]["unit_number"] == "204"

    def test_street_number_breaks_tie(self):
        # Two units in different buildings — street number resolves it
        same_unit = [
            {"unit_number": "101", "street_address": "123 Ocean Blvd"},
            {"unit_number": "101", "street_address": "456 Palm Ave"},
        ]
        hits = _match_by_address("456 Palm Ave Unit 101", same_unit)
        assert len(hits) == 1 and hits[0]["street_address"] == "456 Palm Ave"

    def test_no_match(self):
        assert _match_by_address("999 Nowhere St Unit 77", UNITS) == []

    def test_empty_address(self):
        assert _match_by_address("", UNITS) == []
