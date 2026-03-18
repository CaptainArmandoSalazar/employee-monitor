import uuid
from sqlalchemy import Column, String, Integer, Boolean, Text, TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.utils.helpers import utcnow


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.session_id"), nullable=False)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("employees.employee_id"), nullable=False)
    app_name = Column(String, nullable=True)
    window_title = Column(Text, nullable=True)
    start_time = Column(TIMESTAMP, nullable=True)
    end_time = Column(TIMESTAMP, nullable=True)
    duration = Column(Integer, default=0)   # seconds
    is_idle = Column(Boolean, default=False)

    session = relationship("Session", back_populates="activity_logs")
    employee = relationship("Employee", back_populates="activity_logs")
