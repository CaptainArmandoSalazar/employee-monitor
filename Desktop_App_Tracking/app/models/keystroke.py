import uuid
from sqlalchemy import Column, Integer, Text, TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.utils.helpers import utcnow


class Keystroke(Base):
    __tablename__ = "keystrokes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("sessions.session_id"), nullable=False)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("employees.employee_id"), nullable=False)
    keys_pressed_count = Column(Integer, default=0)
    raw_keystrokes = Column(Text, nullable=True)
    timestamp = Column(TIMESTAMP, default=utcnow)

    session = relationship("Session", back_populates="keystrokes")
    employee = relationship("Employee", back_populates="keystrokes")
