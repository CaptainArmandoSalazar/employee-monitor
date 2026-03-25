# REPLACE entire file:
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.core.security import verify_password
from app.core.exceptions import NotFoundException, ConflictException, ForbiddenException
from app.models.employee import Employee
from app.schemas.employee import EmployeeCreate, EmployeeUpdate, EmployeeOut
from app.schemas.password import PasswordChangeRequest, AdminPasswordResetRequest
from app.services import employee_service
from app.api.deps import (
    get_current_employee, require_super_admin,
    require_hr_or_above, require_manager_or_above
)

router = APIRouter(prefix="/employees", tags=["Employees"])

# Role creation rules
CREATION_RULES = {
    "super_admin": ["super_admin", "hr", "manager", "employee"],
    "hr":          ["hr", "manager", "employee"],
    "manager":     ["employee"],
    "employee":    [],
}


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager_or_above),
):
    allowed = CREATION_RULES.get(current.role, [])
    if payload.role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Your role '{current.role}' cannot create role '{payload.role}'"
        )
    # Manager can only create employees assigned to themselves
    if current.role == "manager":
        payload.manager_id = current.employee_id

    try:
        emp = employee_service.create_employee(db, payload, created_by=current.employee_id)
    except ConflictException as e:
        raise e
    return EmployeeOut.model_validate(emp)


@router.get("", response_model=List[EmployeeOut])
def list_employees(
    role: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    active_only: bool = Query(True),
    manager_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager_or_above),
):
    status_filter = True if active_only else None

    if current.role == "manager":
        # Managers only see their own employees
        emps = employee_service.list_employees_by_role(
            db, role=role, department=department,
            status=status_filter, manager_id=current.employee_id,
            skip=skip, limit=limit
        )
    elif current.role == "hr":
        # HR sees everyone except super_admin
        if role == "super_admin":
            raise HTTPException(status_code=403, detail="HR cannot view super admins")
        emps = employee_service.list_employees_by_role(
            db, role=role, department=department,
            status=status_filter, manager_id=manager_id,
            skip=skip, limit=limit
        )
        emps = [e for e in emps if e.role != "super_admin"]
    else:
        # super_admin sees all
        emps = employee_service.list_employees_by_role(
            db, role=role, department=department,
            status=status_filter, manager_id=manager_id,
            skip=skip, limit=limit
        )
    return [EmployeeOut.model_validate(e) for e in emps]


@router.get("/me", response_model=EmployeeOut)
def get_my_profile(current_employee: Employee = Depends(get_current_employee)):
    return EmployeeOut.model_validate(current_employee)


@router.post("/me/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_my_password(
    payload: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    if not verify_password(payload.current_password, current_employee.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    employee_service.change_password(db, current_employee.employee_id, payload.new_password)


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    # super_admin: see all
    # hr: see all except super_admin
    # manager: see only their employees + themselves
    # employee: only themselves
    try:
        emp = employee_service.get_by_id(db, employee_id)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))

    if current_employee.role == "super_admin":
        pass
    elif current_employee.role == "hr":
        if emp.role == "super_admin":
            raise HTTPException(status_code=403, detail="Access denied")
    elif current_employee.role == "manager":
        if emp.employee_id != current_employee.employee_id and emp.manager_id != current_employee.employee_id:
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        if emp.employee_id != current_employee.employee_id:
            raise HTTPException(status_code=403, detail="Access denied")

    return EmployeeOut.model_validate(emp)


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: UUID,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager_or_above),
):
    try:
        target = employee_service.get_by_id(db, employee_id)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Permission check
    if current.role == "manager" and target.manager_id != current.employee_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current.role == "hr" and target.role == "super_admin":
        raise HTTPException(status_code=403, detail="HR cannot modify super admins")

    try:
        emp = employee_service.update_employee(db, employee_id, payload)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    return EmployeeOut.model_validate(emp)


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager_or_above),
):
    try:
        target = employee_service.get_by_id(db, employee_id)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))

    if current.role == "manager" and target.manager_id != current.employee_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current.role == "hr" and target.role == "super_admin":
        raise HTTPException(status_code=403, detail="HR cannot deactivate super admins")

    try:
        employee_service.deactivate(db, employee_id)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch("/{employee_id}/reactivate", response_model=EmployeeOut)
def reactivate_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_hr_or_above),
):
    try:
        employee_service.reactivate(db, employee_id)
        emp = employee_service.get_by_id(db, employee_id)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    return EmployeeOut.model_validate(emp)


@router.post("/{employee_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def admin_reset_password(
    employee_id: UUID,
    payload: AdminPasswordResetRequest,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager_or_above),
):
    try:
        target = employee_service.get_by_id(db, employee_id)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))

    if current.role == "manager" and target.manager_id != current.employee_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current.role == "hr" and target.role == "super_admin":
        raise HTTPException(status_code=403, detail="HR cannot reset super admin password")

    try:
        employee_service.change_password(db, employee_id, payload.new_password)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))