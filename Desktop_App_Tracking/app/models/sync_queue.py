import json
import uuid
from sqlalchemy import Column, String, Integer, Text, TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.utils.helpers import utcnow


class OfflineSyncQueue(Base):
    __tablename__ = "offline_sync_queue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("employees.employee_id"), nullable=False)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.session_id"), nullable=True)
    event_type = Column(String, nullable=False)
    device_id = Column(String, nullable=True)
    payload = Column(Text, nullable=False, default="{}")
    status = Column(String, default="queued")
    retry_count = Column(Integer, default=0)
    last_error = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, default=utcnow)
    updated_at = Column(TIMESTAMP, default=utcnow, onupdate=utcnow)

    employee = relationship("Employee", back_populates="offline_sync_queue")
    session = relationship("Session", back_populates="offline_sync_queue")
