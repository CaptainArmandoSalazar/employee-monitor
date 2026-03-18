from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import date

from app.core.database import get_db
from app.models.employee import Employee
from app.models.device import DeviceInfo
from app.models.network import NetworkInfo
from app.schemas.session import ClockInRequest, ClockOutRequest, SessionOut
from app.schemas.device import DeviceInfoCreate, DeviceInfoOut, NetworkInfoCreate, NetworkInfoOut
from app.services import session_service
from app.api.deps import get_current_employee, require_admin

router = APIRouter(prefix="/sessions", tags=["Sessions"])


@router.post("/clock-in", response_model=SessionOut)
def clock_in(
    payload: ClockInRequest,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    session = session_service.clock_in(db, current_employee.employee_id, payload)
    return SessionOut.model_validate(session)


@router.post("/clock-out", response_model=SessionOut)
def clock_out(
    payload: ClockOutRequest,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    try:
        session = session_service.clock_out(db, current_employee.employee_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return SessionOut.model_validate(session)


@router.get("/active", response_model=Optional[SessionOut])
def get_active_session(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    session = session_service.get_active_session(db, current_employee.employee_id)
    if not session:
        return None
    return SessionOut.model_validate(session)


@router.get("/my", response_model=List[SessionOut])
def get_my_sessions(
    session_date: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    sessions = session_service.get_sessions(
        db,
        employee_id=current_employee.employee_id,
        session_date=session_date,
        skip=skip,
        limit=limit,
    )
    return [SessionOut.model_validate(s) for s in sessions]


@router.get("", response_model=List[SessionOut])
def list_all_sessions(
    employee_id: Optional[UUID] = Query(None),
    session_date: Optional[date] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    sessions = session_service.get_sessions(
        db,
        employee_id=employee_id,
        session_date=session_date,
        status=status,
        skip=skip,
        limit=limit,
    )
    return [SessionOut.model_validate(s) for s in sessions]


@router.get("/{session_id}", response_model=SessionOut)
def get_session(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    from app.models.session import Session as SessionModel
    session = db.query(SessionModel).filter(SessionModel.session_id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if current_employee.role != "admin" and session.employee_id != current_employee.employee_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return SessionOut.model_validate(session)


# ── Device + Network info captured at clock-in ──────────────
@router.post("/device-info", response_model=DeviceInfoOut)
def save_device_info(
    payload: DeviceInfoCreate,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    record = session_service.save_device_info(db, current_employee.employee_id, payload)
    return DeviceInfoOut.model_validate(record)


@router.post("/network-info", response_model=NetworkInfoOut)
def save_network_info(
    payload: NetworkInfoCreate,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    record = session_service.save_network_info(db, current_employee.employee_id, payload)
    return NetworkInfoOut.model_validate(record)


# ── GET device-info for a session (own sessions only for employees) ──
@router.get("/{session_id}/device-info", response_model=List[DeviceInfoOut])
def get_session_device_info(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    """Return device info records for a session. Employees can only query their own sessions."""
    from app.models.session import Session as SessionModel
    session = db.query(SessionModel).filter(SessionModel.session_id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if current_employee.role != "admin" and session.employee_id != current_employee.employee_id:
        raise HTTPException(status_code=403, detail="Access denied")
    records = db.query(DeviceInfo).filter(DeviceInfo.session_id == session_id).all()
    return [DeviceInfoOut.model_validate(r) for r in records]


# ── GET network-info for a session (own sessions only for employees) ──
@router.get("/{session_id}/network-info", response_model=List[NetworkInfoOut])
def get_session_network_info(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    """Return network info records for a session. Employees can only query their own sessions."""
    from app.models.session import Session as SessionModel
    session = db.query(SessionModel).filter(SessionModel.session_id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if current_employee.role != "admin" and session.employee_id != current_employee.employee_id:
        raise HTTPException(status_code=403, detail="Access denied")
    records = db.query(NetworkInfo).filter(NetworkInfo.session_id == session_id).all()
    return [NetworkInfoOut.model_validate(r) for r in records]