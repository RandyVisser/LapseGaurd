import os
import jwt
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# SUPABASE_JWT_SECRET is the HS256 signing secret for user access tokens.
# Found in Supabase → Settings → JWT Keys (left nav).
# Note: Supabase's newer sb_publishable_/sb_secret_ API keys are separate —
# those are for initializing the client SDK, not for verifying user tokens.
# User access tokens are still standard HS256 JWTs regardless of key format.
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "super-secret-jwt-token-for-dev")

security = HTTPBearer(auto_error=False)


class AuthUser:
    def __init__(self, sub: str, email: str, role: str, hoa_id: str | None = None):
        self.sub = sub
        self.email = email
        self.role = role  # "hoa_admin" or "tenant"
        self.hoa_id = hoa_id


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
) -> AuthUser:
    # In local dev without Supabase, allow a mock header for testing
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_token(credentials.credentials)
    sub = payload.get("sub", "")
    email = payload.get("email", "")
    meta = payload.get("user_metadata", {}) or payload.get("app_metadata", {})
    role = meta.get("role", "tenant")
    hoa_id = meta.get("hoa_id")

    return AuthUser(sub=sub, email=email, role=role, hoa_id=hoa_id)


async def require_hoa_admin(user: AuthUser = Security(get_current_user)) -> AuthUser:
    if user.role != "hoa_admin":
        raise HTTPException(status_code=403, detail="HOA admin access required")
    return user


async def require_tenant(user: AuthUser = Security(get_current_user)) -> AuthUser:
    if user.role != "tenant":
        raise HTTPException(status_code=403, detail="Tenant access required")
    return user
