from pydantic import BaseModel, model_validator
from typing import Optional, List
from uuid import UUID
from datetime import datetime, timezone


class UtcModel(BaseModel):
    """Turns any timezone-aware datetime into plain UTC so every row is stored the same way."""

    @model_validator(mode="after")
    def _to_naive_utc(self):
        for name, value in list(self.__dict__.items()):
            if isinstance(value, datetime) and value.tzinfo is not None:
                setattr(self, name, value.astimezone(timezone.utc).replace(tzinfo=None))
        return self

# ── Activity ──────────────────────────────────────────────
class ActivityLogCreate(UtcModel):
    session_id: UUID
    app_name: Optional[str] = None
    window_title: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration: Optional[int] = 0
    is_idle: Optional[bool] = False


class ActivityLogOut(BaseModel):
    id: UUID
    session_id: UUID
    employee_id: UUID
    app_name: Optional[str]
    window_title: Optional[str]
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    duration: Optional[int]
    is_idle: Optional[bool]

    class Config:
        from_attributes = True


# ── Website ───────────────────────────────────────────────
class WebsiteLogCreate(UtcModel):
    session_id: UUID
    url: Optional[str] = None
    domain: Optional[str] = None
    title: Optional[str] = None
    duration: Optional[int] = 0
    timestamp: Optional[datetime] = None


class WebsiteLogOut(BaseModel):
    id: UUID
    session_id: UUID
    employee_id: UUID
    url: Optional[str]
    domain: Optional[str]
    title: Optional[str]
    duration: Optional[int]
    timestamp: Optional[datetime]

    class Config:
        from_attributes = True


# ── Keystrokes ────────────────────────────────────────────
class KeystrokeCreate(UtcModel):
    session_id: UUID
    keys_pressed_count: int = 0
    raw_keystrokes: Optional[str] = None
    timestamp: Optional[datetime] = None


class KeystrokeOut(BaseModel):
    id: UUID
    session_id: UUID
    employee_id: UUID
    keys_pressed_count: int
    raw_keystrokes: Optional[str]  # ← ADD THIS
    timestamp: Optional[datetime]

    class Config:
        from_attributes = True


# ── System Metrics ────────────────────────────────────────
class SystemMetricCreate(UtcModel):
    session_id: UUID
    cpu_usage: Optional[float] = None
    memory_usage: Optional[float] = None
    timestamp: Optional[datetime] = None


class SystemMetricOut(BaseModel):
    id: UUID
    session_id: UUID
    employee_id: UUID
    cpu_usage: Optional[float]
    memory_usage: Optional[float]
    timestamp: Optional[datetime]

    class Config:
        from_attributes = True


# ── Network Speed ─────────────────────────────────────────
class NetworkSpeedCreate(UtcModel):
    session_id: UUID
    download_speed: Optional[float] = None
    upload_speed: Optional[float] = None
    ping: Optional[float] = None
    timestamp: Optional[datetime] = None


class NetworkSpeedOut(BaseModel):
    id: UUID
    session_id: UUID
    employee_id: UUID
    download_speed: Optional[float]
    upload_speed: Optional[float]
    ping: Optional[float]
    timestamp: Optional[datetime]

    class Config:
        from_attributes = True


# ── Bulk helpers (desktop app sends batches) ──────────────
class ActivityBatch(BaseModel):
    logs: List[ActivityLogCreate]


class WebsiteBatch(BaseModel):
    logs: List[WebsiteLogCreate]
