import uuid
from sqlalchemy import Column, String, Float, TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.utils.helpers import utcnow


class NetworkInfo(Base):
    __tablename__ = "network_info"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.session_id"), nullable=False)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("employees.employee_id"), nullable=False)
    ip_address = Column(String, nullable=True)
    connection_type = Column(String, nullable=True)
    ssid = Column(String, nullable=True)
    mac_address = Column(String, nullable=True)
    captured_at = Column(TIMESTAMP, default=utcnow)

    session = relationship("Session", back_populates="network_info")
    employee = relationship("Employee", back_populates="network_info")


class NetworkSpeedLog(Base):
    __tablename__ = "network_speed_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.session_id"), nullable=False)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("employees.employee_id"), nullable=False)
    download_speed = Column(Float, nullable=True)
    upload_speed = Column(Float, nullable=True)
    ping = Column(Float, nullable=True)
    timestamp = Column(TIMESTAMP, default=utcnow)

    session = relationship("Session", back_populates="network_speed_logs")
    employee = relationship("Employee", back_populates="network_speed_logs")
