from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from uuid import UUID
from datetime import date

from app.core.database import get_db
from app.models.employee import Employee
from app.models.device import DeviceInfo, Device
from app.models.network import NetworkInfo
from app.schemas.tracking import (
    ActivityLogOut, WebsiteLogOut, KeystrokeOut,
    SystemMetricOut, NetworkSpeedOut,
)
from app.schemas.device import DeviceInfoOut, NetworkInfoOut, DeviceMasterOut
from app.schemas.session import SessionOut
from app.services import tracking_service, session_service, analytics_service
from app.api.deps import require_admin
from app.api.deps import require_super_admin, require_hr_or_above, require_manager_or_above
from app.services import employee_service as emp_svc

router = APIRouter(prefix="/admin", tags=["Admin"])


# ── Overview ──────────────────────────────────────────────
@router.get("/summary")
def team_summary(
    target_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager_or_above),
):
    if current.role == "manager":
        # Only their employees + themselves
        ids = emp_svc.get_manageable_employee_ids(db, current)
        employees = [db.query(Employee).filter(Employee.employee_id == eid).first() for eid in ids]
        employees = [e for e in employees if e]
        return [analytics_service.get_employee_summary(db, e.employee_id, target_date) for e in employees]
    elif current.role == "hr":
        # All except super_admin
        all_emps = db.query(Employee).filter(
            Employee.status == True,
            Employee.role != "super_admin"
        ).all()
        return [analytics_service.get_employee_summary(db, e.employee_id, target_date) for e in all_emps]
    else:
        # super_admin: all
        return analytics_service.get_all_employees_summary(db, target_date)


@router.get("/summary/{employee_id}")
def employee_summary(
    employee_id: UUID,
    target_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager_or_above),
):
    target = db.query(Employee).filter(Employee.employee_id == employee_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Access checks
    if current.role == "hr" and target.role == "super_admin":
        raise HTTPException(status_code=403, detail="HR cannot view super admin activity")
    if current.role == "manager":
        ids = emp_svc.get_manageable_employee_ids(db, current)
        if employee_id not in ids:
            raise HTTPException(status_code=403, detail="Access denied")

    return analytics_service.get_employee_summary(db, employee_id, target_date)



@router.get("/session-metrics/{session_id}")
def session_metrics(
    session_id: UUID,
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    return analytics_service.get_avg_system_metrics(db, session_id)


# ── Sessions ──────────────────────────────────────────────
@router.get("/sessions", response_model=List[SessionOut])
def admin_sessions(
    employee_id: Optional[UUID] = Query(None),
    session_date: Optional[date] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_manager_or_above),
):
    # Determine visible employee ids
    if current.role in ("super_admin", "hr"):
        if current.role == "hr" and employee_id:
            # HR cannot see super_admin sessions
            target = db.query(Employee).filter(Employee.employee_id == employee_id).first()
            if target and target.role == "super_admin":
                raise HTTPException(status_code=403, detail="Access denied")
        sessions = session_service.get_sessions(
            db, employee_id=employee_id, session_date=session_date,
            status=status, skip=skip, limit=limit,
        )
        if current.role == "hr":
            # Filter out super_admin sessions
            super_admin_ids = {
                e.employee_id for e in
                db.query(Employee).filter(Employee.role == "super_admin").all()
            }
            sessions = [s for s in sessions if s.employee_id not in super_admin_ids]
    else:
        # Manager: only their employees
        visible_ids = emp_svc.get_manageable_employee_ids(db, current)
        if employee_id and employee_id not in visible_ids:
            raise HTTPException(status_code=403, detail="Access denied")
        filter_id = employee_id if employee_id else None
        sessions = session_service.get_sessions(
            db, employee_id=filter_id, session_date=session_date,
            status=status, skip=skip, limit=limit,
        )
        sessions = [s for s in sessions if s.employee_id in visible_ids]

    return [SessionOut.model_validate(s) for s in sessions]


# ── Activity Logs ─────────────────────────────────────────
@router.get("/activity", response_model=List[ActivityLogOut])
def admin_activity(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    logs = tracking_service.get_activity_logs(db, employee_id, session_id, skip, limit)
    return [ActivityLogOut.model_validate(l) for l in logs]


# ── Website Logs ──────────────────────────────────────────
@router.get("/website", response_model=List[WebsiteLogOut])
def admin_website(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    logs = tracking_service.get_website_logs(db, employee_id, session_id, skip, limit)
    return [WebsiteLogOut.model_validate(l) for l in logs]


# ── Keystroke Logs ────────────────────────────────────────
@router.get("/keystrokes", response_model=List[KeystrokeOut])
def admin_keystrokes(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    logs = tracking_service.get_keystroke_logs(db, employee_id, session_id, skip, limit)
    return [KeystrokeOut.model_validate(l) for l in logs]


# ── System Metrics ────────────────────────────────────────
@router.get("/system-metrics", response_model=List[SystemMetricOut])
def admin_system_metrics(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    logs = tracking_service.get_system_metrics(db, employee_id, session_id, skip, limit)
    return [SystemMetricOut.model_validate(l) for l in logs]


# ── Network Speed ─────────────────────────────────────────
@router.get("/network-speed", response_model=List[NetworkSpeedOut])
def admin_network_speed(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    logs = tracking_service.get_network_speed_logs(db, employee_id, session_id, skip, limit)
    return [NetworkSpeedOut.model_validate(l) for l in logs]


# ── Device Info ───────────────────────────────────────────
@router.get("/device-info", response_model=List[DeviceInfoOut])
def admin_device_info(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    q = db.query(DeviceInfo)
    if employee_id:
        q = q.filter(DeviceInfo.employee_id == employee_id)
    if session_id:
        q = q.filter(DeviceInfo.session_id == session_id)
    return [DeviceInfoOut.model_validate(d) for d in q.offset(skip).limit(limit).all()]


# ── Network Info ──────────────────────────────────────────
@router.get("/network-info", response_model=List[NetworkInfoOut])
def admin_network_info(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    q = db.query(NetworkInfo)
    if employee_id:
        q = q.filter(NetworkInfo.employee_id == employee_id)
    if session_id:
        q = q.filter(NetworkInfo.session_id == session_id)
    return [NetworkInfoOut.model_validate(n) for n in q.offset(skip).limit(limit).all()]


# ── Devices Master ────────────────────────────────────────
@router.get("/devices", response_model=List[DeviceMasterOut])
def admin_devices(
    employee_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    q = db.query(Device)
    if employee_id:
        q = q.filter(Device.employee_id == employee_id)
    return [DeviceMasterOut.model_validate(d) for d in q.offset(skip).limit(limit).all()]
