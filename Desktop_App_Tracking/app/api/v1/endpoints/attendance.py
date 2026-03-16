# app/api/v1/endpoints/attendance.py — FULL REPLACEMENT
from datetime import datetime, timezone, date
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date

from app.db.session import get_db
from app.core.dependencies import get_current_user, get_current_admin, get_client_ip
from app.models.models import AttendanceRecord, AttendanceStatus, User
from app.schemas.schemas import (
    ClockInRequest, ClockOutRequest, CrashClockOutRequest,
    AttendanceResponse, AttendanceListResponse, MessageResponse
)

router = APIRouter(prefix="/attendance", tags=["Attendance"])


def _get_active_session(user_id, db: Session) -> AttendanceRecord | None:
    return db.query(AttendanceRecord).filter(
        AttendanceRecord.user_id == user_id,
        AttendanceRecord.status == AttendanceStatus.CLOCKED_IN,
    ).first()


@router.post("/clock-in", response_model=AttendanceResponse, status_code=status.HTTP_201_CREATED)
def clock_in(
    payload: ClockInRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if _get_active_session(current_user.id, db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already clocked in. Please clock out first.",
        )

    record = AttendanceRecord(
        user_id=current_user.id,
        status=AttendanceStatus.CLOCKED_IN,
        clock_in_time=datetime.now(timezone.utc),
        clock_in_ip=get_client_ip(request),
        clock_in_latitude=payload.latitude,
        clock_in_longitude=payload.longitude,
        clock_in_device_id=payload.device_id,
        clock_in_system_time=payload.system_time,
        # NEW: save speed at clock-in
        clock_in_download_mbps=payload.download_mbps,
        clock_in_upload_mbps=payload.upload_mbps,
        clock_in_ping_ms=payload.ping_ms,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.post("/clock-out", response_model=AttendanceResponse)
def clock_out(
    payload: ClockOutRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = _get_active_session(current_user.id, db)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are not clocked in.",
        )

    now = datetime.now(timezone.utc)
    clock_in_aware = record.clock_in_time.replace(tzinfo=timezone.utc) if record.clock_in_time.tzinfo is None else record.clock_in_time
    total_seconds = int((now - clock_in_aware).total_seconds())

    record.status = AttendanceStatus.CLOCKED_OUT
    record.clock_out_time = now
    record.clock_out_ip = get_client_ip(request)
    record.clock_out_latitude = payload.latitude
    record.clock_out_longitude = payload.longitude
    record.total_work_seconds = total_seconds
    record.clock_out_reason = "manual"

    db.commit()
    db.refresh(record)
    return record


# NEW: crash/shutdown clock-out — no location, called automatically on system events
@router.post("/clock-out/crash", response_model=AttendanceResponse)
def crash_clock_out(
    payload: CrashClockOutRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = _get_active_session(current_user.id, db)
    if not record:
        # Already clocked out — not an error, just idempotent
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not clocked in.",
        )

    now = datetime.now(timezone.utc)
    clock_in_aware = record.clock_in_time.replace(tzinfo=timezone.utc) if record.clock_in_time.tzinfo is None else record.clock_in_time
    total_seconds = int((now - clock_in_aware).total_seconds())

    record.status = AttendanceStatus.CLOCKED_OUT
    record.clock_out_time = now
    record.clock_out_ip = get_client_ip(request)
    # No location for crash clock-out
    record.clock_out_latitude = None
    record.clock_out_longitude = None
    record.total_work_seconds = total_seconds
    record.clock_out_reason = payload.reason  # 'crash' or 'shutdown'

    db.commit()
    db.refresh(record)
    return record


@router.get("/today", response_model=AttendanceListResponse)
def get_today_attendance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    today = date.today()
    records = db.query(AttendanceRecord).filter(
        cast(AttendanceRecord.clock_in_time, Date) == today
    ).all()
    return AttendanceListResponse(total=len(records), records=records)


@router.get("/history", response_model=AttendanceListResponse)
def get_attendance_history(
    user_id: str = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(AttendanceRecord)

    if current_user.role.value == "employee":
        query = query.filter(AttendanceRecord.user_id == current_user.id)
    elif user_id:
        query = query.filter(AttendanceRecord.user_id == user_id)

    total = query.count()
    records = query.order_by(AttendanceRecord.clock_in_time.desc()).offset(skip).limit(limit).all()
    return AttendanceListResponse(total=total, records=records)


@router.get("/me/status", response_model=dict)
def get_my_clock_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = _get_active_session(current_user.id, db)
    if record:
        return {
            "is_clocked_in": True,
            "attendance_id": str(record.id),
            "clock_in_time": record.clock_in_time.isoformat(),
        }
    return {"is_clocked_in": False, "attendance_id": None, "clock_in_time": None}