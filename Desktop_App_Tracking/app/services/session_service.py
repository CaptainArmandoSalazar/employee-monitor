import uuid
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional, List
from uuid import UUID

from app.models.session import Session as SessionModel
from app.models.device import DeviceInfo, Device
from app.models.network import NetworkInfo
from app.schemas.session import ClockInRequest, ClockOutRequest
from app.schemas.device import DeviceInfoCreate, NetworkInfoCreate
from app.utils.helpers import utcnow
from app.utils.logger import get_logger

logger = get_logger(__name__)


def get_active_session(db: Session, employee_id: UUID) -> Optional[SessionModel]:
    return (
        db.query(SessionModel)
        .filter(
            SessionModel.employee_id == employee_id,
            SessionModel.session_status == "active",
        )
        .first()
    )


def clock_in(db: Session, employee_id: UUID, payload: ClockInRequest) -> SessionModel:
    # Prevent double clock-in
    existing = get_active_session(db, employee_id)
    if existing:
        logger.info(f"Employee {employee_id} already has active session {existing.session_id}")
        return existing

    now = utcnow()
    session = SessionModel(
        session_id=uuid.uuid4(),
        employee_id=employee_id,
        date=date.today(),
        clock_in=now,
        session_status="active",
        ip_address=payload.ip_address,
        location=payload.location,
        latitude=payload.latitude,
        longitude=payload.longitude,
        city=payload.city,
        country=payload.country,
        network_speed_start=payload.network_speed_start,
        device_id=payload.device_id,
        total_active_time=0,
        total_idle_time=0,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.info(f"Clock-in: employee={employee_id} session={session.session_id}")
    return session


def clock_out(db: Session, employee_id: UUID, payload: ClockOutRequest) -> SessionModel:
    session = (
        db.query(SessionModel)
        .filter(
            SessionModel.session_id == payload.session_id,
            SessionModel.employee_id == employee_id,
        )
        .first()
    )
    if not session:
        raise ValueError("Session not found or does not belong to this employee")
    if session.session_status == "completed":
        return session

    session.clock_out = utcnow()
    session.session_status = "completed"
    session.total_active_time = payload.total_active_time or 0
    session.total_idle_time = payload.total_idle_time or 0
    db.commit()
    db.refresh(session)
    logger.info(f"Clock-out: employee={employee_id} session={session.session_id}")
    return session


def save_device_info(db: Session, employee_id: UUID, payload: DeviceInfoCreate) -> DeviceInfo:
    record = DeviceInfo(
        id=uuid.uuid4(),
        session_id=payload.session_id,
        employee_id=employee_id,
        device_id=payload.device_id,
        device_name=payload.device_name,
        os=payload.os,
        cpu=payload.cpu,
        ram=payload.ram,
        storage_total=payload.storage_total,
        storage_free=payload.storage_free,
        captured_at=utcnow(),
    )
    db.add(record)

    # Upsert into devices master
    if payload.device_id:
        existing_device = db.query(Device).filter(Device.device_id == payload.device_id).first()
        if existing_device:
            existing_device.last_seen = utcnow()
            existing_device.status = "active"
        else:
            db.add(
                Device(
                    device_id=payload.device_id,
                    employee_id=employee_id,
                    device_name=payload.device_name,
                    os=payload.os,
                    first_seen=utcnow(),
                    last_seen=utcnow(),
                    status="active",
                )
            )
    db.commit()
    db.refresh(record)
    return record


def save_network_info(db: Session, employee_id: UUID, payload: NetworkInfoCreate) -> NetworkInfo:
    record = NetworkInfo(
        id=uuid.uuid4(),
        session_id=payload.session_id,
        employee_id=employee_id,
        ip_address=payload.ip_address,
        connection_type=payload.connection_type,
        ssid=payload.ssid,
        mac_address=payload.mac_address,
        captured_at=utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_sessions(
    db: Session,
    employee_id: Optional[UUID] = None,
    session_date: Optional[date] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
) -> List[SessionModel]:
    q = db.query(SessionModel)
    if employee_id:
        q = q.filter(SessionModel.employee_id == employee_id)
    if session_date:
        q = q.filter(SessionModel.date == session_date)
    if status:
        q = q.filter(SessionModel.session_status == status)
    return q.order_by(desc(SessionModel.clock_in)).offset(skip).limit(limit).all()
