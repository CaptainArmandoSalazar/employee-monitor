from sqlalchemy.orm import Session
from typing import Optional
from app.models.employee import Employee
from app.core.security import verify_password, create_access_token, hash_password
from app.utils.logger import get_logger

logger = get_logger(__name__)


def authenticate_employee(db: Session, email: str, password: str) -> Optional[Employee]:
    employee = db.query(Employee).filter(Employee.email == email).first()
    if not employee:
        logger.warning(f"Login attempt for unknown email: {email}")
        return None
    if not verify_password(password, employee.password_hash):
        logger.warning(f"Invalid password for: {email}")
        return None
    if not employee.status:
        logger.warning(f"Disabled account login attempt: {email}")
        return None
    return employee


def create_token_for_employee(employee: Employee) -> str:
    return create_access_token(
        data={
            "sub": str(employee.employee_id),
            "email": employee.email,
            "role": employee.role,
        }
    )


# REPLACE seed_default_admin function:
def seed_default_admin(db: Session, cfg) -> None:
    """Create default super_admin if not present — called once at startup."""
    existing = db.query(Employee).filter(Employee.email == cfg.DEFAULT_ADMIN_EMAIL).first()
    if existing:
        # Migrate old 'admin' role to 'super_admin'
        if existing.role == "admin":
            existing.role = "super_admin"
            db.commit()
            logger.info(f"✅ Migrated admin role to super_admin: {cfg.DEFAULT_ADMIN_EMAIL}")
        return
    import uuid
    from datetime import date
    admin = Employee(
        employee_id=uuid.uuid4(),
        employee_name=cfg.DEFAULT_ADMIN_NAME,
        email=cfg.DEFAULT_ADMIN_EMAIL,
        password_hash=hash_password(cfg.DEFAULT_ADMIN_PASSWORD),
        department=cfg.DEFAULT_ADMIN_DEPARTMENT,
        role="super_admin",          # ← changed from "admin"
        status=True,
        date_of_joining=date.today(),
    )
    db.add(admin)
    db.commit()
    logger.info(f"✅ Default super_admin seeded: {cfg.DEFAULT_ADMIN_EMAIL}")
