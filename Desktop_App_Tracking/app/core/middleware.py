import time
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.utils.logger import get_logger

logger = get_logger("request")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Logs every request with method, path, status code, and duration."""

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000

        # Skip health-check noise
        if request.url.path not in ("/", "/health"):
            logger.info(
                f"{request.method} {request.url.path} "
                f"→ {response.status_code} "
                f"[{duration_ms:.1f}ms]"
            )
        return response
