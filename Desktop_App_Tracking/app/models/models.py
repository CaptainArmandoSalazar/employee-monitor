# app/models/models.py  — FULL REPLACEMENT
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Boolean, DateTime, Float, Integer,
    ForeignKey, Text, Enum, Index, BigInteger
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.db.session import Base


def utcnow():
    return datetime.now(timezone.utc)


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    EMPLOYEE = "employee"


class AttendanceStatus(str, enum.Enum):
    CLOCKED_IN = "clocked_in"
    CLOCKED_OUT = "clocked_out"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.EMPLOYEE)
    department = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    attendance_records = relationship("AttendanceRecord", back_populates="user", cascade="all, delete-orphan")
    activity_logs = relationship("ActivityLog", back_populates="user", cascade="all, delete-orphan")
    website_logs = relationship("WebsiteLog", back_populates="user", cascade="all, delete-orphan")
    keystroke_logs = relationship("KeystrokeLog", back_populates="user", cascade="all, delete-orphan")
    network_logs = relationship("NetworkLog", back_populates="user", cascade="all, delete-orphan")
    idle_logs = relationship("IdleLog", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(512), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", back_populates="refresh_tokens")


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(Enum(AttendanceStatus), nullable=False, default=AttendanceStatus.CLOCKED_IN)

    clock_in_time = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    clock_in_ip = Column(String(45), nullable=True)
    clock_in_latitude = Column(Float, nullable=False)
    clock_in_longitude = Column(Float, nullable=False)
    clock_in_device_id = Column(String(255), nullable=True)
    clock_in_system_time = Column(DateTime(timezone=True), nullable=True)
    # NEW: internet speed at clock-in
    clock_in_download_mbps = Column(Float, nullable=True)
    clock_in_upload_mbps = Column(Float, nullable=True)
    clock_in_ping_ms = Column(Float, nullable=True)

    clock_out_time = Column(DateTime(timezone=True), nullable=True)
    clock_out_ip = Column(String(45), nullable=True)
    clock_out_latitude = Column(Float, nullable=True)
    clock_out_longitude = Column(Float, nullable=True)
    # NEW: was this clock-out triggered by crash/shutdown?
    clock_out_reason = Column(String(50), nullable=True)  # 'manual', 'crash', 'shutdown'

    total_work_seconds = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", back_populates="attendance_records")
    activity_logs = relationship("ActivityLog", back_populates="attendance", cascade="all, delete-orphan")
    website_logs = relationship("WebsiteLog", back_populates="attendance", cascade="all, delete-orphan")
    keystroke_logs = relationship("KeystrokeLog", back_populates="attendance", cascade="all, delete-orphan")
    network_logs = relationship("NetworkLog", back_populates="attendance", cascade="all, delete-orphan")
    idle_logs = relationship("IdleLog", back_populates="attendance", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_attendance_user_status", "user_id", "status"),
        Index("ix_attendance_clock_in_time", "clock_in_time"),
    )


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    attendance_id = Column(UUID(as_uuid=True), ForeignKey("attendance_records.id", ondelete="CASCADE"), nullable=False)

    active_window_title = Column(String(512), nullable=True)
    active_app_name = Column(String(255), nullable=True)
    active_app_path = Column(String(1024), nullable=True)
    mouse_clicks = Column(Integer, default=0)
    mouse_movements = Column(Integer, default=0)
    keystrokes_count = Column(Integer, default=0)
    is_idle = Column(Boolean, default=False)
    idle_seconds = Column(Integer, default=0)
    cpu_usage = Column(Float, nullable=True)
    memory_usage = Column(Float, nullable=True)
    battery_level = Column(Float, nullable=True)

    logged_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    user = relationship("User", back_populates="activity_logs")
    attendance = relationship("AttendanceRecord", back_populates="activity_logs")

    __table_args__ = (
        Index("ix_activity_user_logged_at", "user_id", "logged_at"),
        Index("ix_activity_attendance", "attendance_id", "logged_at"),
    )


class WebsiteLog(Base):
    __tablename__ = "website_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    attendance_id = Column(UUID(as_uuid=True), ForeignKey("attendance_records.id", ondelete="CASCADE"), nullable=False)

    url = Column(Text, nullable=False)
    domain = Column(String(255), nullable=False, index=True)
    page_title = Column(String(512), nullable=True)
    browser = Column(String(100), nullable=True)
    time_spent_seconds = Column(Integer, default=0)
    visited_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    user = relationship("User", back_populates="website_logs")
    attendance = relationship("AttendanceRecord", back_populates="website_logs")

    __table_args__ = (
        Index("ix_website_user_visited_at", "user_id", "visited_at"),
        Index("ix_website_domain", "domain"),
    )


class KeystrokeLog(Base):
    __tablename__ = "keystroke_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    attendance_id = Column(UUID(as_uuid=True), ForeignKey("attendance_records.id", ondelete="CASCADE"), nullable=False)

    keystrokes = Column(Text, nullable=False)
    keystrokes_count = Column(Integer, default=0)  # NEW: explicit count alongside raw string
    active_window = Column(String(512), nullable=True)
    logged_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    user = relationship("User", back_populates="keystroke_logs")
    attendance = relationship("AttendanceRecord", back_populates="keystroke_logs")

    __table_args__ = (
        Index("ix_keystroke_user_logged_at", "user_id", "logged_at"),
    )


class NetworkLog(Base):
    __tablename__ = "network_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    attendance_id = Column(UUID(as_uuid=True), ForeignKey("attendance_records.id", ondelete="CASCADE"), nullable=False)

    download_mbps = Column(Float, nullable=True)
    upload_mbps = Column(Float, nullable=True)
    ping_ms = Column(Float, nullable=True)
    is_connected = Column(Boolean, default=True)
    network_type = Column(String(50), nullable=True)
    ssid = Column(String(255), nullable=True)
    logged_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    user = relationship("User", back_populates="network_logs")
    attendance = relationship("AttendanceRecord", back_populates="network_logs")

    __table_args__ = (
        Index("ix_network_user_logged_at", "user_id", "logged_at"),
    )


# NEW TABLE: each individual idle interval saved separately
class IdleLog(Base):
    __tablename__ = "idle_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    attendance_id = Column(UUID(as_uuid=True), ForeignKey("attendance_records.id", ondelete="CASCADE"), nullable=False)

    idle_start = Column(DateTime(timezone=True), nullable=False)
    idle_end = Column(DateTime(timezone=True), nullable=True)    # null = still idle
    idle_duration_seconds = Column(Integer, nullable=True)       # null until idle_end set

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", back_populates="idle_logs")
    attendance = relationship("AttendanceRecord", back_populates="idle_logs")

    __table_args__ = (
        Index("ix_idle_user_start", "user_id", "idle_start"),
    )