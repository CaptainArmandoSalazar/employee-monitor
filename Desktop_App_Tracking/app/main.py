import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from app.core.config import settings
from app.core.database import engine, SessionLocal, Base
from app.core.middleware import RequestLoggingMiddleware

# Register all ORM models before create_all
from app.models import (  # noqa: F401
    employee, session, device, network,
    activity, system_metrics, keystroke, website,
)

from app.api.routes import (
    auth,
    employee as emp_router,
    session as session_router,
    tracking,
    admin,
)
from app.services.auth_service import seed_default_admin
from app.workers.background_tasks import run_background_tasks
from app.utils.logger import get_logger

logger = get_logger(__name__)
from sqlalchemy.exc import IntegrityError


# ── Lifespan ───────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting Employee Monitor API...")

    # Create / verify tables
    try:
        Base.metadata.create_all(bind=engine, checkfirst=True)
        logger.info("✅ Database tables verified")
    except IntegrityError:
        logger.info("✅ Tables already exist, skipping creation")

    # Seed default admin
    db = SessionLocal()
    try:
        seed_default_admin(db, settings)
    finally:
        db.close()

    # Background task worker
    task = asyncio.create_task(run_background_tasks())

    yield

    task.cancel()
    logger.info("👋 Shutting down")


# ── App ────────────────────────────────────────────────────
app = FastAPI(
    title="Employee Monitor API",
    description=(
        "Production-ready backend for the Employee Monitoring desktop application.\n\n"
        "**Default admin credentials:** `admin@avdevs.com` / `1234`\n\n"
        "Use `POST /api/v1/auth/login` to get a JWT token, then click **Authorize** above."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# ── Middleware ─────────────────────────────────────────────
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # Lock down in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global exception handlers ──────────────────────────────
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = [
        {"field": ".".join(str(l) for l in e["loc"]), "message": e["msg"]}
        for e in exc.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"success": False, "message": "Validation error", "errors": errors},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"success": False, "message": "Internal server error"},
    )


# ── Routers ────────────────────────────────────────────────
PREFIX = "/api/v1"

app.include_router(auth.router,                 prefix=PREFIX)
app.include_router(emp_router.router,           prefix=PREFIX)
app.include_router(session_router.router,       prefix=PREFIX)
app.include_router(tracking.router,             prefix=PREFIX)
app.include_router(admin.router,                prefix=PREFIX)


# ── Health ─────────────────────────────────────────────────
@app.get("/", tags=["Health"], include_in_schema=False)
def root():
    return {"status": "ok", "service": "Employee Monitor API", "version": "1.0.0"}


@app.get("/health", tags=["Health"])
def health():
    return {"status": "healthy"}
