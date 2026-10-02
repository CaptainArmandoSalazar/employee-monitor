from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session
from typing import Optional, List
from uuid import UUID
from datetime import date

from app.core.database import get_db
from app.models.employee import Employee
from app.models.session import Session as SessionModel
from app.models.activity import ActivityLog
from app.models.website import WebsiteLog
from app.models.keystroke import Keystroke
from app.models.system_metrics import SystemMetric
from app.models.device import DeviceInfo, Device
from app.models.network import NetworkInfo, NetworkSpeedLog
from app.schemas.tracking import (
    ActivityLogOut, WebsiteLogOut, KeystrokeOut,
    SystemMetricOut, NetworkSpeedOut,
)
from app.schemas.device import DeviceInfoOut, NetworkInfoOut, DeviceMasterOut
from app.schemas.session import SessionOut
from app.services import analytics_service
from app.services.access_service import scope_condition, can_access_employee_data
from app.api.deps import require_permission

router = APIRouter(prefix="/admin", tags=["Admin"])


def _scoped_list(db, current, model, order_col, employee_id, session_id, skip, limit):
    """Shared query: only rows belonging to people the user may see, newest first."""
    q = db.query(model).filter(scope_condition(current, model.employee_id))
    if employee_id:
        q = q.filter(model.employee_id == employee_id)
    if session_id:
        q = q.filter(model.session_id == session_id)
    return q.order_by(desc(order_col)).offset(skip).limit(limit).all()


# ── Summaries ─────────────────────────────────────────────
@router.get("/summary")
def team_summary(
    target_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("summary.view")),
):
    employees = (
        db.query(Employee)
        .filter(Employee.status == True, scope_condition(current, Employee.employee_id))  # noqa: E712
        .all()
    )
    return [analytics_service.get_employee_summary(db, e.employee_id, target_date) for e in employees]


@router.get("/summary/{employee_id}")
def employee_summary(
    employee_id: UUID,
    target_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("summary.view")),
):
    target = db.query(Employee).filter(Employee.employee_id == employee_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not can_access_employee_data(db, current, employee_id):
        raise HTTPException(status_code=403, detail="Access denied")
    return analytics_service.get_employee_summary(db, employee_id, target_date)


@router.get("/session-metrics/{session_id}")
def session_metrics(
    session_id: UUID,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("metrics.view")),
):
    session = db.query(SessionModel).filter(SessionModel.session_id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not can_access_employee_data(db, current, session.employee_id):
        raise HTTPException(status_code=403, detail="Access denied")
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
    current: Employee = Depends(require_permission("session.view")),
):
    if employee_id and not can_access_employee_data(db, current, employee_id):
        raise HTTPException(status_code=403, detail="Access denied")

    q = db.query(SessionModel).filter(scope_condition(current, SessionModel.employee_id))
    if employee_id:
        q = q.filter(SessionModel.employee_id == employee_id)
    if session_date:
        q = q.filter(SessionModel.date == session_date)
    if status:
        q = q.filter(SessionModel.session_status == status)
    sessions = q.order_by(desc(SessionModel.clock_in)).offset(skip).limit(limit).all()
    return [SessionOut.model_validate(s) for s in sessions]


# ── Monitoring data ───────────────────────────────────────
@router.get("/activity", response_model=List[ActivityLogOut])
def admin_activity(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("activity.view")),
):
    rows = _scoped_list(db, current, ActivityLog, ActivityLog.start_time, employee_id, session_id, skip, limit)
    return [ActivityLogOut.model_validate(r) for r in rows]


@router.get("/website", response_model=List[WebsiteLogOut])
def admin_website(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("website.view")),
):
    rows = _scoped_list(db, current, WebsiteLog, WebsiteLog.timestamp, employee_id, session_id, skip, limit)
    return [WebsiteLogOut.model_validate(r) for r in rows]


@router.get("/keystrokes", response_model=List[KeystrokeOut])
def admin_keystrokes(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=5000),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("keystroke.view")),
):
    rows = _scoped_list(db, current, Keystroke, Keystroke.timestamp, employee_id, session_id, skip, limit)
    return [KeystrokeOut.model_validate(r) for r in rows]


@router.get("/keystroke-totals")
def admin_keystroke_totals(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("keystroke.view")),
):
    """Total keystrokes per session, calculated in the database (no row limit)."""
    q = (
        db.query(Keystroke.session_id, func.coalesce(func.sum(Keystroke.keys_pressed_count), 0))
        .filter(scope_condition(current, Keystroke.employee_id))
    )
    if employee_id:
        q = q.filter(Keystroke.employee_id == employee_id)
    if session_id:
        q = q.filter(Keystroke.session_id == session_id)
    rows = q.group_by(Keystroke.session_id).all()
    return [{"session_id": str(r[0]), "total_keys": int(r[1])} for r in rows]


@router.get("/system-metrics", response_model=List[SystemMetricOut])
def admin_system_metrics(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("metrics.view")),
):
    rows = _scoped_list(db, current, SystemMetric, SystemMetric.timestamp, employee_id, session_id, skip, limit)
    return [SystemMetricOut.model_validate(r) for r in rows]


@router.get("/network-speed", response_model=List[NetworkSpeedOut])
def admin_network_speed(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("metrics.view")),
):
    rows = _scoped_list(db, current, NetworkSpeedLog, NetworkSpeedLog.timestamp, employee_id, session_id, skip, limit)
    return [NetworkSpeedOut.model_validate(r) for r in rows]


@router.get("/device-info", response_model=List[DeviceInfoOut])
def admin_device_info(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("device.view")),
):
    rows = _scoped_list(db, current, DeviceInfo, DeviceInfo.captured_at, employee_id, session_id, skip, limit)
    return [DeviceInfoOut.model_validate(r) for r in rows]


@router.get("/network-info", response_model=List[NetworkInfoOut])
def admin_network_info(
    employee_id: Optional[UUID] = Query(None),
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("device.view")),
):
    rows = _scoped_list(db, current, NetworkInfo, NetworkInfo.captured_at, employee_id, session_id, skip, limit)
    return [NetworkInfoOut.model_validate(r) for r in rows]


@router.get("/devices", response_model=List[DeviceMasterOut])
def admin_devices(
    employee_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current: Employee = Depends(require_permission("device.view")),
):
    q = db.query(Device).filter(scope_condition(current, Device.employee_id))
    if employee_id:
        q = q.filter(Device.employee_id == employee_id)
    return [DeviceMasterOut.model_validate(d) for d in q.offset(skip).limit(limit).all()]