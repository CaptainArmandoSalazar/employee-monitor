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
from app.api.deps import get_current_employee, require_admin

router = APIRouter(prefix="/employees", tags=["Employees"])


# ── Create (admin only) ───────────────────────────────────
@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    admin: Employee = Depends(require_admin),
):
    try:
        emp = employee_service.create_employee(db, payload, created_by=admin.employee_id)
    except ConflictException as e:
        raise e
    return EmployeeOut.model_validate(emp)


# ── List all (admin only) ─────────────────────────────────
@router.get("", response_model=List[EmployeeOut])
def list_employees(
    role: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    active_only: bool = Query(True),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    emps = employee_service.list_employees(
        db,
        role=role,
        department=department,
        status=True if active_only else None,
        skip=skip,
        limit=limit,
    )
    return [EmployeeOut.model_validate(e) for e in emps]


# ── Own profile ───────────────────────────────────────────
@router.get("/me", response_model=EmployeeOut)
def get_my_profile(current_employee: Employee = Depends(get_current_employee)):
    return EmployeeOut.model_validate(current_employee)


# ── Self password change ──────────────────────────────────
@router.post("/me/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_my_password(
    payload: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    if not verify_password(payload.current_password, current_employee.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    employee_service.change_password(db, current_employee.employee_id, payload.new_password)


# ── Get by ID ─────────────────────────────────────────────
@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    if current_employee.role != "admin" and current_employee.employee_id != employee_id:
        raise ForbiddenException()
    try:
        emp = employee_service.get_by_id(db, employee_id)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    return EmployeeOut.model_validate(emp)


# ── Update (admin only) ───────────────────────────────────
@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: UUID,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    try:
        emp = employee_service.update_employee(db, employee_id, payload)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    return EmployeeOut.model_validate(emp)


# ── Deactivate (admin only) ───────────────────────────────
@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    try:
        employee_service.deactivate(db, employee_id)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Reactivate (admin only) ───────────────────────────────
@router.patch("/{employee_id}/reactivate", response_model=EmployeeOut)
def reactivate_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    try:
        employee_service.reactivate(db, employee_id)
        emp = employee_service.get_by_id(db, employee_id)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    return EmployeeOut.model_validate(emp)


# ── Admin resets any employee's password ─────────────────
@router.post("/{employee_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def admin_reset_password(
    employee_id: UUID,
    payload: AdminPasswordResetRequest,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    try:
        employee_service.change_password(db, employee_id, payload.new_password)
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
