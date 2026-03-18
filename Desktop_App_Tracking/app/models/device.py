import uuid
from sqlalchemy import Column, String, Integer, TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.utils.helpers import utcnow


class DeviceInfo(Base):
    __tablename__ = "device_info"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.session_id"), nullable=False)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("employees.employee_id"), nullable=False)
    device_id = Column(String, nullable=True)
    device_name = Column(String, nullable=True)
    os = Column(String, nullable=True)
    cpu = Column(String, nullable=True)
    ram = Column(String, nullable=True)
    storage_total = Column(Integer, nullable=True)
    storage_free = Column(Integer, nullable=True)
    captured_at = Column(TIMESTAMP, default=utcnow)

    session = relationship("Session", back_populates="device_info")
    employee = relationship("Employee", back_populates="device_info")


class Device(Base):
    __tablename__ = "devices"

    device_id = Column(String, primary_key=True)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("employees.employee_id"), nullable=False)
    device_name = Column(String, nullable=True)
    os = Column(String, nullable=True)
    first_seen = Column(TIMESTAMP, default=utcnow)
    last_seen = Column(TIMESTAMP, default=utcnow, onupdate=utcnow)
    status = Column(String, default="active")

    employee = relationship("Employee", back_populates="devices")
