from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.dependencies import get_current_user, get_current_admin
from app.core.security import get_password_hash
from app.models.models import User, UserRole
from app.schemas.schemas import (
    UserCreate, UserUpdate, UserResponse, UserListResponse, MessageResponse
)

router = APIRouter(prefix="/employees", tags=["Employees"])


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=get_password_hash(payload.password),
        role=payload.role,
        department=payload.department,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("", response_model=UserListResponse)
def list_employees(
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    query = db.query(User)
    if role:
        query = query.filter(User.role == role)
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    else:
        query = query.filter(User.is_active == True)
    total = query.count()
    users = query.order_by(User.created_at.desc()).offset(skip).limit(limit).all()
    return UserListResponse(total=total, users=users)


@router.get("/me", response_model=UserResponse)
def get_my_profile(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/{employee_id}", response_model=UserResponse)
def get_employee(
    employee_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Employees can only view themselves
    if current_user.role == UserRole.EMPLOYEE and str(current_user.id) != employee_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    user = db.query(User).filter(User.id == employee_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return user


@router.patch("/{employee_id}", response_model=UserResponse)
def update_employee(
    employee_id: str,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Employees can only update themselves; admins can update anyone
    if current_user.role == UserRole.EMPLOYEE and str(current_user.id) != employee_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    user = db.query(User).filter(User.id == employee_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    update_data = payload.model_dump(exclude_unset=True)
    # Prevent employees from changing is_active
    if current_user.role == UserRole.EMPLOYEE:
        update_data.pop("is_active", None)

    for field, value in update_data.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{employee_id}", response_model=MessageResponse)
def deactivate_employee(
    employee_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    user = db.query(User).filter(User.id == employee_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    db.delete(user)
    db.commit()
    return MessageResponse(message="Employee deleted successfully")


@router.get("/{employee_id}/live", response_model=dict)
def get_employee_live(
    employee_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    from app.models.models import AttendanceRecord, AttendanceStatus, ActivityLog, NetworkLog
    from sqlalchemy import desc

    user = db.query(User).filter(User.id == employee_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Current attendance
    attendance = db.query(AttendanceRecord).filter(
        AttendanceRecord.user_id == employee_id,
        AttendanceRecord.status == AttendanceStatus.CLOCKED_IN,
    ).first()

    # Latest activity log
    latest_activity = db.query(ActivityLog).filter(
        ActivityLog.user_id == employee_id,
    ).order_by(desc(ActivityLog.logged_at)).first()

    # Latest network log
    latest_network = db.query(NetworkLog).filter(
        NetworkLog.user_id == employee_id,
    ).order_by(desc(NetworkLog.logged_at)).first()

    is_clocked_in = attendance is not None
    is_idle = latest_activity.is_idle if latest_activity else False

    return {
        "is_clocked_in": is_clocked_in,
        "attendance_id": str(attendance.id) if attendance else None,
        "clock_in_time": attendance.clock_in_time.isoformat() if attendance else None,
        "clock_in_latitude": attendance.clock_in_latitude if attendance else None,
        "clock_in_longitude": attendance.clock_in_longitude if attendance else None,
        "active_window": latest_activity.active_window_title if latest_activity else None,
        "active_app": latest_activity.active_app_name if latest_activity else None,
        "is_idle": latest_activity.is_idle if latest_activity else False,
        "last_seen": latest_activity.logged_at.isoformat() if latest_activity else None,
        "download_mbps": latest_network.download_mbps if latest_network else None,
        "upload_mbps": latest_network.upload_mbps if latest_network else None,
        "ping_ms": latest_network.ping_ms if latest_network else None,
    }