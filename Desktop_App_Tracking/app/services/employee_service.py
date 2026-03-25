"""
Employee CRUD helpers extracted from the route layer so they can be
reused by other services (e.g. seeding, tests) without importing FastAPI.
"""
import uuid
from datetime import date
from typing import Optional, List
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.core.security import hash_password
from app.core.exceptions import ConflictException, NotFoundException
from app.schemas.employee import EmployeeCreate, EmployeeUpdate
from app.utils.helpers import utcnow
from app.utils.logger import get_logger

logger = get_logger(__name__)


def get_by_id(db: Session, employee_id: UUID) -> Employee:
    emp = db.query(Employee).filter(Employee.employee_id == employee_id).first()
    if not emp:
        raise NotFoundException(f"Employee {employee_id} not found")
    return emp


def get_by_email(db: Session, email: str) -> Optional[Employee]:
    return db.query(Employee).filter(Employee.email == email).first()


def list_employees(
    db: Session,
    role: Optional[str] = None,
    department: Optional[str] = None,
    status: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50,
) -> List[Employee]:
    q = db.query(Employee)
    if role:
        q = q.filter(Employee.role == role)
    if department:
        q = q.filter(Employee.department == department)
    if status is not None:
        q = q.filter(Employee.status == status)
    return q.order_by(Employee.employee_name).offset(skip).limit(limit).all()

def list_employees_by_role(
    db: Session,
    role: Optional[str] = None,
    department: Optional[str] = None,
    status: Optional[bool] = None,
    manager_id: Optional[UUID] = None,
    skip: int = 0,
    limit: int = 50,
) -> List[Employee]:
    q = db.query(Employee)
    if role:
        if isinstance(role, list):
            q = q.filter(Employee.role.in_(role))
        else:
            q = q.filter(Employee.role == role)
    if department:
        q = q.filter(Employee.department == department)
    if status is not None:
        q = q.filter(Employee.status == status)
    if manager_id is not None:
        q = q.filter(Employee.manager_id == manager_id)
    return q.order_by(Employee.employee_name).offset(skip).limit(limit).all()


def get_manageable_employee_ids(db: Session, requester: Employee) -> Optional[List[UUID]]:
    """
    Returns list of employee_ids visible to the requester.
    Returns None meaning 'all' for super_admin/hr.
    """
    if requester.role in ("super_admin", "hr"):
        return None  # can see all (except super_admin for hr — filtered elsewhere)
    if requester.role == "manager":
        managed = db.query(Employee.employee_id).filter(
            Employee.manager_id == requester.employee_id
        ).all()
        ids = [r[0] for r in managed]
        ids.append(requester.employee_id)  # can see own sessions too
        return ids
    # plain employee — only themselves
    return [requester.employee_id]

def create_employee(
    db: Session,
    payload: EmployeeCreate,
    created_by: Optional[UUID] = None,
) -> Employee:
    if get_by_email(db, payload.email):
        raise ConflictException(f"Email '{payload.email}' is already registered")

    emp = Employee(
        employee_id=uuid.uuid4(),
        employee_name=payload.employee_name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        department=payload.department,
        role=payload.role,
        created_by=created_by,
        manager_id=payload.manager_id,
        date_of_joining=payload.date_of_joining or date.today(),
        status=True,
        created_at=utcnow(),
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    logger.info(f"Created employee {emp.email} (role={emp.role})")
    return emp



def update_employee(db: Session, employee_id: UUID, payload: EmployeeUpdate) -> Employee:
    emp = get_by_id(db, employee_id)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(emp, field, value)
    db.commit()
    db.refresh(emp)
    logger.info(f"Updated employee {emp.email}")
    return emp


def change_password(db: Session, employee_id: UUID, new_password: str) -> None:
    emp = get_by_id(db, employee_id)
    emp.password_hash = hash_password(new_password)
    db.commit()
    logger.info(f"Password changed for {emp.email}")


def deactivate(db: Session, employee_id: UUID) -> None:
    emp = get_by_id(db, employee_id)
    emp.status = False
    db.commit()
    logger.info(f"Deactivated employee {emp.email}")


def reactivate(db: Session, employee_id: UUID) -> None:
    emp = get_by_id(db, employee_id)
    emp.status = True
    db.commit()
    logger.info(f"Reactivated employee {emp.email}")
