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


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    import logging
    sentry_sdk.capture_exception(exc)
    logging.getLogger("uvicorn.error").exception("Unhandled error on %s %s", request.method, request.url.path)
    # Include CORS headers manually — responses from exception handlers bypass
    # CORSMiddleware, and without them the browser masks the 500 as a CORS error
    origin = request.headers.get("origin", "")
    headers = {}
    if origin and (origin in _allowed_origins or "*" in _allowed_origins):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=headers,
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
