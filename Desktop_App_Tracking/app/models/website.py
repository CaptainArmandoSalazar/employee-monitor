import uuid
from sqlalchemy import Column, String, Integer, Text, TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.utils.helpers import utcnow


class WebsiteLog(Base):
    __tablename__ = "website_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.session_id"), nullable=False)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("employees.employee_id"), nullable=False)
    url = Column(Text, nullable=True)
    domain = Column(String, nullable=True)
    title = Column(Text, nullable=True)
    duration = Column(Integer, default=0)   # seconds
    timestamp = Column(TIMESTAMP, default=utcnow)

    session = relationship("Session", back_populates="website_logs")
    employee = relationship("Employee", back_populates="website_logs")
