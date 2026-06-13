"""Tests for object_path normalization — the backwards-compat seam that lets
legacy full URLs and new bare paths both resolve to a clean object key."""
from services.storage import object_path

BUCKET = "policy-documents"
SUPA = "https://ykbjvmqdkczqyzyylwxo.supabase.co"


class TestObjectPath:
    def test_bare_path_unchanged(self):
        assert object_path("abc-unit/1234.pdf", BUCKET) == "abc-unit/1234.pdf"

    def test_legacy_public_url(self):
        url = f"{SUPA}/storage/v1/object/public/{BUCKET}/abc-unit/1234.pdf"
        assert object_path(url, BUCKET) == "abc-unit/1234.pdf"

    def test_authenticated_url(self):
        url = f"{SUPA}/storage/v1/object/{BUCKET}/abc-unit/1234.pdf"
        assert object_path(url, BUCKET) == "abc-unit/1234.pdf"

    def test_signed_url_strips_token(self):
        url = f"{SUPA}/storage/v1/object/sign/{BUCKET}/abc/1234.pdf?token=eyJhbGc"
        assert object_path(url, BUCKET) == "abc/1234.pdf"

    def test_query_string_stripped_on_bare_path(self):
        assert object_path("abc/1234.pdf?x=1", BUCKET) == "abc/1234.pdf"

    def test_leading_slash_stripped(self):
        assert object_path("/abc/1234.pdf", BUCKET) == "abc/1234.pdf"

    def test_path_traversal_rejected(self):
        assert object_path("../../etc/passwd", BUCKET) is None
        assert object_path(f"{SUPA}/storage/v1/object/public/{BUCKET}/../secret", BUCKET) is None

    def test_none_and_empty(self):
        assert object_path(None, BUCKET) is None
        assert object_path("", BUCKET) is None

    def test_wrong_bucket_marker_treated_as_path(self):
        # A URL for a different bucket has no policy-documents marker, so it
        # falls through as a literal key — harmless (404s), never a foreign fetch
        url = f"{SUPA}/storage/v1/object/public/other-bucket/x.pdf"
        result = object_path(url, BUCKET)
        assert result == url  # unchanged; _require_storage_url rejects it (has ://)

    def test_foreign_url_kept_for_rejection(self):
        # object_path doesn't reject foreign URLs itself; it returns them with
        # scheme intact so the caller's guard can 422 them
        assert "://" in object_path("http://evil.example/x", BUCKET)
