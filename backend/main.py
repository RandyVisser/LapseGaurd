import os
import asyncpg
import sentry_sdk
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Error monitoring — no-op locally when SENTRY_DSN is unset.
# send_default_pii stays off: requests carry owner names/addresses.
_SENTRY_DSN = os.environ.get("SENTRY_DSN", "")
if _SENTRY_DSN:
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        environment=os.environ.get("RAILWAY_ENVIRONMENT_NAME", "production"),
        traces_sample_rate=0.1,
        send_default_pii=False,
    )

from models.db import get_pool
from routes.hoa import router as hoa_router
from routes.units import router as units_router
from routes.documents import router as documents_router
from routes.alerts import router as alerts_router
from routes.tenants import router as tenants_router
from routes.onboarding import router as onboarding_router
from routes.inbound import router as inbound_router
from routes.feedback import router as feedback_router
from routes.billing import router as billing_router
from routes.pm_team import router as pm_team_router
from routes.analytics import router as analytics_router
from routes.rentals import router as rentals_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield


app = FastAPI(title="LapseGuard API", lifespan=lifespan)

_origins_env = os.environ.get("ALLOWED_ORIGINS", "")
_allowed_origins = [o.strip() for o in _origins_env.split(",") if o.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(hoa_router)
app.include_router(units_router)
app.include_router(documents_router)
app.include_router(alerts_router)
app.include_router(tenants_router)
app.include_router(onboarding_router)
app.include_router(inbound_router)
app.include_router(feedback_router)
app.include_router(billing_router)
app.include_router(pm_team_router)
app.include_router(analytics_router)
app.include_router(rentals_router)


def _cors_headers(request: Request) -> dict:
    # Exception-handler responses bypass CORSMiddleware; without these the
    # browser masks the error as a CORS failure
    origin = request.headers.get("origin", "")
    if origin and (origin in _allowed_origins or "*" in _allowed_origins):
        return {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true"}
    return {}


@app.exception_handler(asyncpg.exceptions.DataError)
async def data_error_handler(request: Request, exc: asyncpg.exceptions.DataError):
    # Malformed input reaching a typed query (most often a non-UUID path param
    # like /invite/sample or /hoa/__all__/...). Bad request, not a server fault —
    # safety net so these never surface as 500s on any endpoint.
    return JSONResponse(status_code=400, content={"detail": "Invalid request"},
                        headers=_cors_headers(request))


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    import logging
    sentry_sdk.capture_exception(exc)
    logging.getLogger("uvicorn.error").exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=_cors_headers(request),
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
