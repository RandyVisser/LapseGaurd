"""
Supabase Storage helpers for private buckets.

Documents (dec pages, HOA files) live in private buckets, so they can't be
read by URL. Reads go through short-lived signed URLs; server-side fetches
(hashing, AI parsing) authenticate with the service-role key, which bypasses
storage RLS.

Stored document values may be a bare object path ("{unit_id}/{ts}.pdf") or a
legacy full public URL — object_path() normalizes either to a bare path, so
existing rows keep working after the buckets flip to private.
"""
import logging
import os

import httpx

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

DEFAULT_SIGN_EXPIRY = 60 * 60 * 4  # 4 hours — long enough that an open page stays valid


def object_path(stored: str | None, bucket: str) -> str | None:
    """Normalize a stored document value (bare path or legacy full URL) to a
    bare object path within the bucket. Returns None for falsy input."""
    if not stored:
        return None
    value = stored.strip()
    marker = f"/{bucket}/"
    if marker in value:
        value = value.split(marker, 1)[1]
    # strip any query string (e.g. a stored signed URL token) and leading slash
    value = value.split("?", 1)[0].lstrip("/")
    # path-traversal guard — paths are server-constructed elsewhere, but stored
    # values are client-influenced, so never let ".." through
    if ".." in value:
        return None
    return value or None


async def signed_url(stored: str | None, bucket: str, expires_in: int = DEFAULT_SIGN_EXPIRY) -> str | None:
    """Return a short-lived signed URL for a stored document, or None.

    Falls back to a public URL when no service-role key is configured (local
    dev with public buckets) so development keeps working unchanged."""
    path = object_path(stored, bucket)
    if not path:
        return None
    if not SUPABASE_URL:
        return stored
    if not SERVICE_ROLE_KEY:
        return f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}"
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            resp = await http.post(
                f"{SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path}",
                headers={
                    "apikey": SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                },
                json={"expiresIn": expires_in},
            )
            resp.raise_for_status()
            signed = resp.json().get("signedURL")
        if not signed:
            return None
        return f"{SUPABASE_URL}/storage/v1{signed}"
    except Exception as e:
        logger.error("Failed to sign %s/%s: %s", bucket, path, e)
        return None


async def fetch_bytes(stored: str | None, bucket: str) -> tuple[bytes, str] | None:
    """Fetch a document's bytes server-side using the service-role key (works on
    private buckets). Returns (content, content_type) or None.

    Falls back to an unauthenticated GET when no service-role key is set."""
    path = object_path(stored, bucket)
    if not path or not SUPABASE_URL:
        return None
    headers = {}
    if SERVICE_ROLE_KEY:
        headers = {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        }
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}"
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.get(url, headers=headers)
            resp.raise_for_status()
            return resp.content, resp.headers.get("content-type", "")
    except Exception as e:
        logger.error("Failed to fetch %s/%s: %s", bucket, path, e)
        return None
