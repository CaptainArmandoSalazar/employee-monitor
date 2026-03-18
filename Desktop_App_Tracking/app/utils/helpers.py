from datetime import datetime, timezone
import uuid


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


def seconds_to_hms(seconds: int) -> str:
    if not seconds:
        return "0h 0m 0s"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h}h {m}m {s}s"
