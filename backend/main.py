import os
import asyncpg
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from models.db import get_pool
from routes.hoa import router as hoa_router
from routes.units import router as units_router
from routes.documents import router as documents_router
from routes.alerts import router as alerts_router
from routes.tenants import router as tenants_router
from routes.onboarding import router as onboarding_router


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


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/debug/policy/{policy_id}")
async def debug_policy(policy_id: str):
    import json as _json
    from models.db import get_pool
    from models.schemas import PolicyStatus
    pool = await get_pool()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            """SELECT p.status, p.extracted_data,
                      h.ho6_coverage_a_min, h.ho6_coverage_e_min, h.ho6_wind_required
               FROM policies p
               JOIN tenants t ON t.id = p.tenant_id
               JOIN units u ON u.id = t.unit_id
               JOIN hoas h ON h.id = u.hoa_id
               WHERE p.id = $1""",
            policy_id,
        )
        if not r:
            return {"error": "not found"}
        ext = _json.loads(r["extracted_data"]) if isinstance(r["extracted_data"], str) else (r["extracted_data"] or {})
        validation = ext.get("validation") or {}
        dwelling = ext.get("dwelling_coverage")
        a_min = r["ho6_coverage_a_min"]
        return {
            "db_status": r["status"],
            "extracted_data_type": type(r["extracted_data"]).__name__,
            "dwelling_coverage": dwelling,
            "dwelling_coverage_type": type(dwelling).__name__,
            "ho6_coverage_a_min": a_min,
            "ho6_coverage_a_min_type": type(a_min).__name__,
            "validation_passed": validation.get("passed"),
            "validation_passed_type": type(validation.get("passed")).__name__,
            "validation_passed_is_False": validation.get("passed") is False,
            "coverage_check": float(dwelling) < float(a_min) if dwelling is not None and a_min is not None else "skipped",
        }


@app.get("/debug/routes")
async def debug_routes():
    routes = []
    for route in app.routes:
        if hasattr(route, "methods") and hasattr(route, "path"):
            routes.append({"path": route.path, "methods": sorted(route.methods)})
    return sorted(routes, key=lambda r: r["path"])
