from fastapi import APIRouter, Depends, Query
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

router = APIRouter(prefix="/admin", tags=["Admin"])


# ── Overview ──────────────────────────────────────────────
@router.get("/summary")
def team_summary(
    target_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    return analytics_service.get_all_employees_summary(db, target_date)


@router.get("/summary/{employee_id}")
def employee_summary(
    employee_id: UUID,
    target_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
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
    _: Employee = Depends(require_admin),
):
    sessions = session_service.get_sessions(
        db, employee_id=employee_id, session_date=session_date,
        status=status, skip=skip, limit=limit,
    )
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
