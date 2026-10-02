# REPLACE entire file:
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.core.security import decode_token
from app.models.employee import Employee
from app.core.permissions import has_permission
bearer_scheme = HTTPBearer()


def get_current_employee(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Employee:
    token = credentials.credentials
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    employee_id = payload.get("sub")
    if not employee_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    try:
        employee_uuid = UUID(str(employee_id))
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    employee = db.query(Employee).filter(Employee.employee_id == employee_uuid).first()
    if not employee or not employee.status:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Employee not found or inactive")
    return employee


def require_super_admin(employee: Employee = Depends(get_current_employee)) -> Employee:
    if employee.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super Admin access required")
    return employee


def require_hr_or_above(employee: Employee = Depends(get_current_employee)) -> Employee:
    if employee.role not in ("super_admin", "hr"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="HR or above access required")
    return employee


def require_manager_or_above(employee: Employee = Depends(get_current_employee)) -> Employee:
    if employee.role not in ("super_admin", "hr", "manager"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager or above access required")
    return employee


def require_permission(permission_key: str):
    """Dependency factory: allows the request only if the user's role has this permission."""
    def checker(
        employee: Employee = Depends(get_current_employee),
        db: Session = Depends(get_db),
    ) -> Employee:
        if not has_permission(db, employee, permission_key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission_key}",
            )
        return employee
    return checker