import uuid
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
from uuid import UUID
from datetime import date

from app.models.activity import ActivityLog
from app.models.website import WebsiteLog
from app.models.keystroke import Keystroke
from app.models.system_metrics import SystemMetric
from app.models.network import NetworkSpeedLog
from app.schemas.tracking import (
    ActivityLogCreate,
    WebsiteLogCreate,
    KeystrokeCreate,
    SystemMetricCreate,
    NetworkSpeedCreate,
)
from app.utils.helpers import utcnow
from app.utils.logger import get_logger

logger = get_logger(__name__)


# ── Activity ──────────────────────────────────────────────
def save_activity(db: Session, employee_id: UUID, payload: ActivityLogCreate) -> ActivityLog:
    record = ActivityLog(
        id=uuid.uuid4(),
        session_id=payload.session_id,
        employee_id=employee_id,
        app_name=payload.app_name,
        window_title=payload.window_title,
        start_time=payload.start_time,
        end_time=payload.end_time,
        duration=payload.duration or 0,
        is_idle=payload.is_idle or False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def save_activity_batch(db: Session, employee_id: UUID, logs: List[ActivityLogCreate]) -> int:
    records = [
        ActivityLog(
            id=uuid.uuid4(),
            session_id=log.session_id,
            employee_id=employee_id,
            app_name=log.app_name,
            window_title=log.window_title,
            start_time=log.start_time,
            end_time=log.end_time,
            duration=log.duration or 0,
            is_idle=log.is_idle or False,
        )
        for log in logs
    ]
    db.add_all(records)
    db.commit()
    return len(records)


def get_activity_logs(
    db: Session,
    employee_id: Optional[UUID] = None,
    session_id: Optional[UUID] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[ActivityLog]:
    q = db.query(ActivityLog)
    if employee_id:
        q = q.filter(ActivityLog.employee_id == employee_id)
    if session_id:
        q = q.filter(ActivityLog.session_id == session_id)
    return q.order_by(desc(ActivityLog.start_time)).offset(skip).limit(limit).all()


# ── Website ───────────────────────────────────────────────
def save_website(db: Session, employee_id: UUID, payload: WebsiteLogCreate) -> WebsiteLog:
    record = WebsiteLog(
        id=uuid.uuid4(),
        session_id=payload.session_id,
        employee_id=employee_id,
        url=payload.url,
        domain=payload.domain,
        title=payload.title,
        duration=payload.duration or 0,
        timestamp=payload.timestamp or utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def save_website_batch(db: Session, employee_id: UUID, logs: List[WebsiteLogCreate]) -> int:
    records = [
        WebsiteLog(
            id=uuid.uuid4(),
            session_id=log.session_id,
            employee_id=employee_id,
            url=log.url,
            domain=log.domain,
            title=log.title,
            duration=log.duration or 0,
            timestamp=log.timestamp or utcnow(),
        )
        for log in logs
    ]
    db.add_all(records)
    db.commit()
    return len(records)


def get_website_logs(
    db: Session,
    employee_id: Optional[UUID] = None,
    session_id: Optional[UUID] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[WebsiteLog]:
    q = db.query(WebsiteLog)
    if employee_id:
        q = q.filter(WebsiteLog.employee_id == employee_id)
    if session_id:
        q = q.filter(WebsiteLog.session_id == session_id)
    return q.order_by(desc(WebsiteLog.timestamp)).offset(skip).limit(limit).all()


# ── Keystrokes ────────────────────────────────────────────
def save_keystroke(db: Session, employee_id: UUID, payload: KeystrokeCreate) -> Keystroke:
    record = Keystroke(
        id=uuid.uuid4(),
        session_id=payload.session_id,
        employee_id=employee_id,
        keys_pressed_count=payload.keys_pressed_count,
        raw_keystrokes=payload.raw_keystrokes,
        timestamp=payload.timestamp or utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_keystroke_logs(
    db: Session,
    employee_id: Optional[UUID] = None,
    session_id: Optional[UUID] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[Keystroke]:
    q = db.query(Keystroke)
    if employee_id:
        q = q.filter(Keystroke.employee_id == employee_id)
    if session_id:
        q = q.filter(Keystroke.session_id == session_id)
    return q.order_by(desc(Keystroke.timestamp)).offset(skip).limit(limit).all()


# ── System Metrics ────────────────────────────────────────
def save_system_metric(db: Session, employee_id: UUID, payload: SystemMetricCreate) -> SystemMetric:
    record = SystemMetric(
        id=uuid.uuid4(),
        session_id=payload.session_id,
        employee_id=employee_id,
        cpu_usage=payload.cpu_usage,
        memory_usage=payload.memory_usage,
        timestamp=payload.timestamp or utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_system_metrics(
    db: Session,
    employee_id: Optional[UUID] = None,
    session_id: Optional[UUID] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[SystemMetric]:
    q = db.query(SystemMetric)
    if employee_id:
        q = q.filter(SystemMetric.employee_id == employee_id)
    if session_id:
        q = q.filter(SystemMetric.session_id == session_id)
    return q.order_by(desc(SystemMetric.timestamp)).offset(skip).limit(limit).all()


# ── Network Speed ─────────────────────────────────────────
def save_network_speed(db: Session, employee_id: UUID, payload: NetworkSpeedCreate) -> NetworkSpeedLog:
    record = NetworkSpeedLog(
        id=uuid.uuid4(),
        session_id=payload.session_id,
        employee_id=employee_id,
        download_speed=payload.download_speed,
        upload_speed=payload.upload_speed,
        ping=payload.ping,
        timestamp=payload.timestamp or utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_network_speed_logs(
    db: Session,
    employee_id: Optional[UUID] = None,
    session_id: Optional[UUID] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[NetworkSpeedLog]:
    q = db.query(NetworkSpeedLog)
    if employee_id:
        q = q.filter(NetworkSpeedLog.employee_id == employee_id)
    if session_id:
        q = q.filter(NetworkSpeedLog.session_id == session_id)
    return q.order_by(desc(NetworkSpeedLog.timestamp)).offset(skip).limit(limit).all()
