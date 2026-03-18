from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.models.employee import Employee
from app.schemas.tracking import (
    ActivityLogCreate, ActivityLogOut, ActivityBatch,
    WebsiteLogCreate, WebsiteLogOut, WebsiteBatch,
    KeystrokeCreate, KeystrokeOut,
    SystemMetricCreate, SystemMetricOut,
    NetworkSpeedCreate, NetworkSpeedOut,
)
from app.services import tracking_service
from app.api.deps import get_current_employee

router = APIRouter(prefix="/tracking", tags=["Tracking"])


# ── Activity ──────────────────────────────────────────────
@router.post("/activity", response_model=ActivityLogOut)
def log_activity(
    payload: ActivityLogCreate,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    record = tracking_service.save_activity(db, current_employee.employee_id, payload)
    return ActivityLogOut.model_validate(record)


@router.post("/activity/batch")
def log_activity_batch(
    payload: ActivityBatch,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    count = tracking_service.save_activity_batch(db, current_employee.employee_id, payload.logs)
    return {"saved": count}


@router.get("/activity", response_model=List[ActivityLogOut])
def get_activity(
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    logs = tracking_service.get_activity_logs(
        db,
        employee_id=current_employee.employee_id,
        session_id=session_id,
        skip=skip,
        limit=limit,
    )
    return [ActivityLogOut.model_validate(l) for l in logs]


# ── Website ───────────────────────────────────────────────
@router.post("/website", response_model=WebsiteLogOut)
def log_website(
    payload: WebsiteLogCreate,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    record = tracking_service.save_website(db, current_employee.employee_id, payload)
    return WebsiteLogOut.model_validate(record)


@router.post("/website/batch")
def log_website_batch(
    payload: WebsiteBatch,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    count = tracking_service.save_website_batch(db, current_employee.employee_id, payload.logs)
    return {"saved": count}


@router.get("/website", response_model=List[WebsiteLogOut])
def get_website(
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    logs = tracking_service.get_website_logs(
        db,
        employee_id=current_employee.employee_id,
        session_id=session_id,
        skip=skip,
        limit=limit,
    )
    return [WebsiteLogOut.model_validate(l) for l in logs]


# ── Keystrokes ────────────────────────────────────────────
@router.post("/keystrokes", response_model=KeystrokeOut)
def log_keystrokes(
    payload: KeystrokeCreate,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    record = tracking_service.save_keystroke(db, current_employee.employee_id, payload)
    return KeystrokeOut.model_validate(record)


@router.get("/keystrokes", response_model=List[KeystrokeOut])
def get_keystrokes(
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    logs = tracking_service.get_keystroke_logs(
        db,
        employee_id=current_employee.employee_id,
        session_id=session_id,
        skip=skip,
        limit=limit,
    )
    return [KeystrokeOut.model_validate(l) for l in logs]


# ── System Metrics ────────────────────────────────────────
@router.post("/system-metrics", response_model=SystemMetricOut)
def log_system_metrics(
    payload: SystemMetricCreate,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    record = tracking_service.save_system_metric(db, current_employee.employee_id, payload)
    return SystemMetricOut.model_validate(record)


@router.get("/system-metrics", response_model=List[SystemMetricOut])
def get_system_metrics(
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    logs = tracking_service.get_system_metrics(
        db,
        employee_id=current_employee.employee_id,
        session_id=session_id,
        skip=skip,
        limit=limit,
    )
    return [SystemMetricOut.model_validate(l) for l in logs]


# ── Network Speed ─────────────────────────────────────────
@router.post("/network-speed", response_model=NetworkSpeedOut)
def log_network_speed(
    payload: NetworkSpeedCreate,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    record = tracking_service.save_network_speed(db, current_employee.employee_id, payload)
    return NetworkSpeedOut.model_validate(record)


@router.get("/network-speed", response_model=List[NetworkSpeedOut])
def get_network_speed(
    session_id: Optional[UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    logs = tracking_service.get_network_speed_logs(
        db,
        employee_id=current_employee.employee_id,
        session_id=session_id,
        skip=skip,
        limit=limit,
    )
    return [NetworkSpeedOut.model_validate(l) for l in logs]
