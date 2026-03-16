from __future__ import annotations
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field, field_validator
from app.models.models import UserRole, AttendanceStatus


# ─── Shared ───────────────────────────────────────────────────────────────────

class MessageResponse(BaseModel):
    message: str


# ─── Auth ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


# ─── Users ────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=255)
    password: str = Field(..., min_length=8)
    role: UserRole = UserRole.EMPLOYEE
    department: Optional[str] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    department: Optional[str] = None
    is_active: Optional[bool] = None


class UserResponse(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: UserRole
    department: Optional[str]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    total: int
    users: List[UserResponse]


# ─── Attendance ───────────────────────────────────────────────────────────────

class ClockInRequest(BaseModel):
    latitude: float = Field(..., description="GPS latitude — required")
    longitude: float = Field(..., description="GPS longitude — required")
    device_id: Optional[str] = None
    system_time: Optional[datetime] = None
    # NEW: speed at clock-in time
    download_mbps: Optional[float] = None
    upload_mbps: Optional[float] = None
    ping_ms: Optional[float] = None

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, v):
        if not (-90 <= v <= 90):
            raise ValueError("Latitude must be between -90 and 90")
        return v

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, v):
        if not (-180 <= v <= 180):
            raise ValueError("Longitude must be between -180 and 180")
        return v



class ClockOutRequest(BaseModel):
    latitude: float
    longitude: float

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, v):
        if not (-90 <= v <= 90):
            raise ValueError("Latitude must be between -90 and 90")
        return v

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, v):
        if not (-180 <= v <= 180):
            raise ValueError("Longitude must be between -180 and 180")
        return v


class AttendanceResponse(BaseModel):
    id: UUID
    user_id: UUID
    status: AttendanceStatus
    clock_in_time: datetime
    clock_in_ip: Optional[str]
    clock_in_latitude: float
    clock_in_longitude: float
    clock_in_device_id: Optional[str]
    clock_in_download_mbps: Optional[float]   # NEW
    clock_in_upload_mbps: Optional[float]      # NEW
    clock_in_ping_ms: Optional[float]          # NEW
    clock_out_time: Optional[datetime]
    clock_out_ip: Optional[str]
    clock_out_latitude: Optional[float]
    clock_out_longitude: Optional[float]
    clock_out_reason: Optional[str]            # NEW
    total_work_seconds: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


# NEW: for saving individual idle intervals
class IdleLogRequest(BaseModel):
    idle_start: datetime
    idle_end: datetime
    idle_duration_seconds: int


class IdleLogResponse(BaseModel):
    id: int
    user_id: UUID
    attendance_id: UUID
    idle_start: datetime
    idle_end: Optional[datetime]
    idle_duration_seconds: Optional[int]

    model_config = {"from_attributes": True}


# NEW: for crash/shutdown clock-out (no location required)
class CrashClockOutRequest(BaseModel):
    reason: str = "crash"  # 'crash' or 'shutdown'


class AttendanceListResponse(BaseModel):
    total: int
    records: List[AttendanceResponse]


# ─── Activity ─────────────────────────────────────────────────────────────────

class ActivityLogRequest(BaseModel):
    active_window_title: Optional[str] = None
    active_app_name: Optional[str] = None
    active_app_path: Optional[str] = None
    mouse_clicks: int = 0
    mouse_movements: int = 0
    keystrokes_count: int = 0
    is_idle: bool = False
    idle_seconds: int = 0
    cpu_usage: Optional[float] = None
    memory_usage: Optional[float] = None
    battery_level: Optional[float] = None
    logged_at: Optional[datetime] = None


class ActivityLogResponse(BaseModel):
    id: int
    user_id: UUID
    attendance_id: UUID
    active_window_title: Optional[str]
    active_app_name: Optional[str]
    mouse_clicks: int
    mouse_movements: int
    keystrokes_count: int
    is_idle: bool
    idle_seconds: int
    cpu_usage: Optional[float]
    memory_usage: Optional[float]
    battery_level: Optional[float]
    logged_at: datetime

    model_config = {"from_attributes": True}


class ActivitySummaryResponse(BaseModel):
    user_id: UUID
    date: str
    total_active_seconds: int
    total_idle_seconds: int
    total_mouse_clicks: int
    total_keystrokes: int
    top_apps: List[dict]
    attendance_id: Optional[UUID]


# ─── Website ──────────────────────────────────────────────────────────────────

class WebsiteLogRequest(BaseModel):
    url: str = Field(..., min_length=1)
    domain: str = Field(..., min_length=1)
    page_title: Optional[str] = None
    browser: Optional[str] = None
    time_spent_seconds: int = Field(default=0, ge=0)
    visited_at: Optional[datetime] = None


class WebsiteLogResponse(BaseModel):
    id: int
    user_id: UUID
    url: str
    domain: str
    page_title: Optional[str]
    browser: Optional[str]
    time_spent_seconds: int
    visited_at: datetime

    model_config = {"from_attributes": True}


class WebsiteSummaryResponse(BaseModel):
    domain: str
    visit_count: int
    total_time_seconds: int


# ─── Keystrokes ───────────────────────────────────────────────────────────────

class KeystrokeLogRequest(BaseModel):
    keystrokes: str = Field(..., description="Raw keystroke string")
    keystrokes_count: int = 0    # NEW: explicit count
    active_window: Optional[str] = None
    logged_at: Optional[datetime] = None


class KeystrokeLogResponse(BaseModel):
    id: int
    user_id: UUID
    keystrokes: str
    active_window: Optional[str]
    logged_at: datetime

    model_config = {"from_attributes": True}


# ─── Network ──────────────────────────────────────────────────────────────────

class NetworkLogRequest(BaseModel):
    download_mbps: Optional[float] = None
    upload_mbps: Optional[float] = None
    ping_ms: Optional[float] = None
    is_connected: bool = True
    network_type: Optional[str] = None
    ssid: Optional[str] = None
    logged_at: Optional[datetime] = None


class NetworkLogResponse(BaseModel):
    id: int
    user_id: UUID
    download_mbps: Optional[float]
    upload_mbps: Optional[float]
    ping_ms: Optional[float]
    is_connected: bool
    network_type: Optional[str]
    ssid: Optional[str]
    logged_at: datetime

    model_config = {"from_attributes": True}