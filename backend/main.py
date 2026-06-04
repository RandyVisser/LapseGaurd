import asyncpg
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from models.db import get_pool
from routes.hoa import router as hoa_router
from routes.units import router as units_router
from routes.documents import router as documents_router
from routes.alerts import router as alerts_router
from routes.tenants import router as tenants_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield


app = FastAPI(title="LapseGuard API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(hoa_router)
app.include_router(units_router)
app.include_router(documents_router)
app.include_router(alerts_router)
app.include_router(tenants_router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/me/debug")
async def debug_token(credentials: HTTPAuthorizationCredentials | None = Security(HTTPBearer(auto_error=False))):
    if not credentials:
        return {"error": "no token"}
    import jwt as pyjwt
    try:
        unverified = pyjwt.decode(credentials.credentials, options={"verify_signature": False})
        return {"payload": unverified}
    except Exception as e:
        return {"error": str(e)}
