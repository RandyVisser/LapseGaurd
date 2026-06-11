"""Tests for the inbound email webhook helpers (signature check, attachment pick)."""
import base64
import hashlib
import hmac
import time

from routes.inbound import _verify_svix_signature, _pick_attachment


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
