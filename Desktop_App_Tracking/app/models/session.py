import uuid
from sqlalchemy import Column, String, Integer, Float, Date, TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base


class Session(Base):
    __tablename__ = "sessions"

    session_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("employees.employee_id"), nullable=False)
    date = Column(Date)
    clock_in = Column(TIMESTAMP)
    clock_out = Column(TIMESTAMP, nullable=True)
    total_active_time = Column(Integer, default=0)   # seconds
    total_idle_time = Column(Integer, default=0)     # seconds
    session_status = Column(String, default="active")  # active / completed

    # Captured at clock-in
    ip_address = Column(String, nullable=True)
    location = Column(String, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    city = Column(String, nullable=True)
    country = Column(String, nullable=True)
    network_speed_start = Column(Float, nullable=True)
    last_heartbeat = Column(TIMESTAMP, nullable=True)
    device_id = Column(String, nullable=True)

    # Relationships
    employee = relationship("Employee", back_populates="sessions")
    activity_logs = relationship("ActivityLog", back_populates="session", lazy="dynamic")
    website_logs = relationship("WebsiteLog", back_populates="session", lazy="dynamic")
    keystrokes = relationship("Keystroke", back_populates="session", lazy="dynamic")
    system_metrics = relationship("SystemMetric", back_populates="session", lazy="dynamic")
    network_speed_logs = relationship("NetworkSpeedLog", back_populates="session", lazy="dynamic")
    device_info = relationship("DeviceInfo", back_populates="session", lazy="dynamic")
    network_info = relationship("NetworkInfo", back_populates="session", lazy="dynamic")
