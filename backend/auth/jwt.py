import os
import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError, PyJWKSetError
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")

# Fetches Supabase's public signing keys from the JWKS endpoint and caches them.
# Handles ES256 (ECC P-256) and survives key rotation automatically.
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")
    return _jwks_client


security = HTTPBearer(auto_error=False)


class AuthUser:
    def __init__(self, sub: str, email: str, role: str, hoa_id: str | None = None):
        self.sub = sub
        self.email = email
        self.role = role  # "hoa_admin" or "tenant"
        self.hoa_id = hoa_id


def decode_token(token: str) -> dict:
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            options={"verify_aud": False},
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except (PyJWKClientError, PyJWKSetError) as e:
        raise HTTPException(status_code=401, detail=f"JWKS error: {e}")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Auth error: {e}")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
) -> AuthUser:
    # In local dev without Supabase, allow a mock header for testing
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_token(credentials.credentials)
    sub = payload.get("sub", "")
    email = payload.get("email", "")
    app_meta = payload.get("app_metadata", {}) or {}
    user_meta = payload.get("user_metadata", {}) or {}
    role = app_meta.get("role") or user_meta.get("role", "tenant")
    hoa_id = app_meta.get("hoa_id") or user_meta.get("hoa_id")

    return AuthUser(sub=sub, email=email, role=role, hoa_id=hoa_id)


async def require_hoa_admin(user: AuthUser = Security(get_current_user)) -> AuthUser:
    if user.role not in ("hoa_admin", "super_user", "property_manager"):
        raise HTTPException(status_code=403, detail="HOA admin access required")
    return user


async def require_super_user(user: AuthUser = Security(get_current_user)) -> AuthUser:
    if user.role != "super_user":
        raise HTTPException(status_code=403, detail="Super user access required")
    return user


async def require_tenant(user: AuthUser = Security(get_current_user)) -> AuthUser:
    if user.role != "tenant":
        raise HTTPException(status_code=403, detail="Tenant access required")
    return user
