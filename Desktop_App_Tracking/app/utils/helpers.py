from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
import uuid

from app.core.config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def local_today() -> date:
    """Today's date in the business time zone (not the server's own time zone)."""
    return datetime.now(ZoneInfo(settings.APP_TIMEZONE)).date()


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


def seconds_to_hms(seconds: int) -> str:
    if not seconds:
        return "0h 0m 0s"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h}h {m}m {s}s"
