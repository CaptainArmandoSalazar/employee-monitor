import uuid
from sqlalchemy import Column, String, Boolean, Date, TIMESTAMP, Text , ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.utils.helpers import utcnow


class Employee(Base):
    __tablename__ = "employees"

    employee_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    department = Column(String)
    role = Column(String, default="employee")  # admin / employee
    created_by = Column(UUID(as_uuid=True), nullable=True)
    manager_id = Column(UUID(as_uuid=True), ForeignKey("employees.employee_id"), nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    date_of_joining = Column(Date, nullable=True)
    status = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP, default=utcnow)

    # Relationships
    managed_employees = relationship(
    "Employee",
    foreign_keys=[manager_id],
    primaryjoin="Employee.manager_id == Employee.employee_id",
    lazy="dynamic",
    viewonly=True,
)
    sessions = relationship("Session", back_populates="employee", lazy="dynamic")
    activity_logs = relationship("ActivityLog", back_populates="employee", lazy="dynamic")
    website_logs = relationship("WebsiteLog", back_populates="employee", lazy="dynamic")
    keystrokes = relationship("Keystroke", back_populates="employee", lazy="dynamic")
    system_metrics = relationship("SystemMetric", back_populates="employee", lazy="dynamic")
    network_speed_logs = relationship("NetworkSpeedLog", back_populates="employee", lazy="dynamic")
    device_info = relationship("DeviceInfo", back_populates="employee", lazy="dynamic")
    network_info = relationship("NetworkInfo", back_populates="employee", lazy="dynamic")
    devices = relationship("Device", back_populates="employee", lazy="dynamic")
