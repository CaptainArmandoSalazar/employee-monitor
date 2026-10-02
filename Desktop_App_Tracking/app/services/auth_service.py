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
    """Create the initial super admin only when explicit bootstrap credentials are configured."""
    email = (cfg.DEFAULT_ADMIN_EMAIL or "").strip()
    password = (cfg.DEFAULT_ADMIN_PASSWORD or "").strip()

    if not email or not password:
        logger.warning(
            "No default super admin configured. Set DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD in the environment before startup."
        )
        return

    existing = db.query(Employee).filter(Employee.email == email).first()
    if existing:
        if existing.role == "admin":
            existing.role = "super_admin"
            db.commit()
            logger.info(f"✅ Migrated admin role to super_admin: {email}")
        return

    import uuid
    from datetime import date
    admin = Employee(
        employee_id=uuid.uuid4(),
        employee_name=cfg.DEFAULT_ADMIN_NAME,
        email=email,
        password_hash=hash_password(password),
        department=cfg.DEFAULT_ADMIN_DEPARTMENT,
        role="super_admin",
        status=True,
        date_of_joining=date.today(),
    )
    db.add(admin)
    db.commit()
    logger.info(f"✅ Default super_admin seeded: {email}")
