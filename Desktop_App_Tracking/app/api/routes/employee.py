from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.core.security import verify_password
from app.core.permissions import has_permission, ALL_ROLES
from app.models.employee import Employee
from app.schemas.employee import EmployeeCreate, EmployeeUpdate, EmployeeOut
from app.schemas.password import PasswordChangeRequest, AdminPasswordResetRequest
from app.services import employee_service
from app.services.access_service import can_manage_account, can_view_account, is_last_super_admin
from app.api.deps import get_current_employee, require_permission

router = APIRouter(prefix="/employees", tags=["Employees"])


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    current: Employee = Depends(get_current_employee),
):
    if payload.role not in ALL_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    if not has_permission(db, current, f"employee.create.{payload.role}"):
        raise HTTPException(
            status_code=403,
            detail=f"You do not have permission to create a '{payload.role}' account",
        )
    # Everyone except Super Admin and HR can only create people who report to themselves
    if current.role not in ("super_admin", "hr"):
        payload.manager_id = current.employee_id

    emp = employee_service.create_employee(db, payload, created_by=current.employee_id)
    return EmployeeOut.model_validate(emp)


@router.get("", response_model=List[EmployeeOut])
def list_employees(
    role: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    active_only: bool = Query(True),
    manager_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("employee.view")),
):
    status_filter = True if active_only else None

    if current.role == "super_admin":
        emps = employee_service.list_employees_by_role(
            db, role=role, department=department, status=status_filter,
            manager_id=manager_id, skip=skip, limit=limit,
        )
    elif current.role == "hr":
        if role == "super_admin":
            raise HTTPException(status_code=403, detail="HR cannot view super admins")
        emps = employee_service.list_employees_by_role(
            db, role=role, department=department, status=status_filter,
            manager_id=manager_id, skip=skip, limit=limit,
        )
        emps = [e for e in emps if e.role != "super_admin"]
    else:
        # everyone else sees only their own direct reports
        emps = employee_service.list_employees_by_role(
            db, role=role, department=department, status=status_filter,
            manager_id=current.employee_id, skip=skip, limit=limit,
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
    current: Employee = Depends(get_current_employee),
):
    emp = employee_service.get_by_id(db, employee_id)
    if emp.employee_id != current.employee_id:
        if not has_permission(db, current, "employee.view") or not can_view_account(current, emp):
            raise HTTPException(status_code=403, detail="Access denied")
    return EmployeeOut.model_validate(emp)


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: UUID,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("employee.update")),
):
    target = employee_service.get_by_id(db, employee_id)
    if not can_manage_account(current, target):
        raise HTTPException(status_code=403, detail="Access denied")

    changes = payload.model_dump(exclude_unset=True)

    # Role change: needs the change-role permission AND permission to create the new role
    new_role = changes.get("role")
    if new_role is not None and new_role != target.role:
        if new_role not in ALL_ROLES:
            raise HTTPException(status_code=400, detail="Invalid role")
        if not (
            has_permission(db, current, "employee.change_role")
            and has_permission(db, current, f"employee.create.{new_role}")
        ):
            raise HTTPException(status_code=403, detail="You cannot assign this role")
        if is_last_super_admin(db, target):
            raise HTTPException(status_code=400, detail="At least one active Super Admin must remain")

    # Status change through this route needs the matching permission
    new_status = changes.get("status")
    if new_status is not None and new_status != target.status:
        needed = "employee.reactivate" if new_status else "employee.deactivate"
        if not has_permission(db, current, needed):
            raise HTTPException(status_code=403, detail=f"Permission required: {needed}")
        if not new_status:
            if target.employee_id == current.employee_id:
                raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
            if is_last_super_admin(db, target):
                raise HTTPException(status_code=400, detail="At least one active Super Admin must remain")

    emp = employee_service.update_employee(db, employee_id, payload)
    return EmployeeOut.model_validate(emp)


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("employee.deactivate")),
):
    target = employee_service.get_by_id(db, employee_id)
    if not can_manage_account(current, target):
        raise HTTPException(status_code=403, detail="Access denied")
    if target.employee_id == current.employee_id:
        raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
    if is_last_super_admin(db, target):
        raise HTTPException(status_code=400, detail="At least one active Super Admin must remain")
    employee_service.deactivate(db, employee_id)


@router.patch("/{employee_id}/reactivate", response_model=EmployeeOut)
def reactivate_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("employee.reactivate")),
):
    target = employee_service.get_by_id(db, employee_id)
    if not can_manage_account(current, target):
        raise HTTPException(status_code=403, detail="Access denied")
    employee_service.reactivate(db, employee_id)
    emp = employee_service.get_by_id(db, employee_id)
    return EmployeeOut.model_validate(emp)


@router.post("/{employee_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def admin_reset_password(
    employee_id: UUID,
    payload: AdminPasswordResetRequest,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("employee.reset_password")),
):
    target = employee_service.get_by_id(db, employee_id)
    if not can_manage_account(current, target):
        raise HTTPException(status_code=403, detail="Access denied")
    if target.employee_id == current.employee_id:
        raise HTTPException(status_code=400, detail="Use 'Change Password' for your own account")
    employee_service.change_password(db, employee_id, payload.new_password)