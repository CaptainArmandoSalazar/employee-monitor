from datetime import datetime, timezone, date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date, desc

from app.db.session import get_db
from app.core.dependencies import get_current_user, get_current_admin
from app.models.models import (
    ActivityLog, WebsiteLog, KeystrokeLog, NetworkLog,
    AttendanceRecord, AttendanceStatus, User, IdleLog
)
from app.schemas.schemas import (
    ActivityLogRequest, ActivityLogResponse,
    WebsiteLogRequest, WebsiteLogResponse, WebsiteSummaryResponse,
    KeystrokeLogRequest, KeystrokeLogResponse,
    NetworkLogRequest, NetworkLogResponse,
    ActivitySummaryResponse, MessageResponse,
    IdleLogRequest, IdleLogResponse   # ADD these
)

router = APIRouter(prefix="/activity", tags=["Activity Monitoring"])


def _require_active_session(user_id, db: Session) -> AttendanceRecord:
    record = db.query(AttendanceRecord).filter(
        AttendanceRecord.user_id == user_id,
        AttendanceRecord.status == AttendanceStatus.CLOCKED_IN,
    ).first()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must be clocked in to log activity.",
        )
    return record


# ─── Activity Log ─────────────────────────────────────────────────────────────

@router.post("/log", response_model=ActivityLogResponse, status_code=status.HTTP_201_CREATED)
def log_activity(
    payload: ActivityLogRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    attendance = _require_active_session(current_user.id, db)

    log = ActivityLog(
        user_id=current_user.id,
        attendance_id=attendance.id,
        active_window_title=payload.active_window_title,
        active_app_name=payload.active_app_name,
        active_app_path=payload.active_app_path,
        mouse_clicks=payload.mouse_clicks,
        mouse_movements=payload.mouse_movements,
        keystrokes_count=payload.keystrokes_count,
        is_idle=payload.is_idle,
        idle_seconds=payload.idle_seconds,
        cpu_usage=payload.cpu_usage,
        memory_usage=payload.memory_usage,
        battery_level=payload.battery_level,
        logged_at=payload.logged_at or datetime.now(timezone.utc),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


# ─── Website Tracking ─────────────────────────────────────────────────────────

@router.post("/website", response_model=WebsiteLogResponse, status_code=status.HTTP_201_CREATED)
def log_website(
    payload: WebsiteLogRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    attendance = _require_active_session(current_user.id, db)

    log = WebsiteLog(
        user_id=current_user.id,
        attendance_id=attendance.id,
        url=payload.url,
        domain=payload.domain,
        page_title=payload.page_title,
        browser=payload.browser,
        time_spent_seconds=payload.time_spent_seconds,
        visited_at=payload.visited_at or datetime.now(timezone.utc),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/websites", response_model=List[WebsiteSummaryResponse])
def get_website_summary(
    user_id: Optional[str] = None,
    target_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Determine which user's data
    if current_user.role.value == "employee":
        uid = current_user.id
    else:
        uid = user_id or current_user.id

    query = db.query(
        WebsiteLog.domain,
        func.count(WebsiteLog.id).label("visit_count"),
        func.sum(WebsiteLog.time_spent_seconds).label("total_time_seconds"),
    ).filter(WebsiteLog.user_id == uid)

    if target_date:
        d = date.fromisoformat(target_date)
        query = query.filter(cast(WebsiteLog.visited_at, Date) == d)

    results = query.group_by(WebsiteLog.domain).order_by(desc("total_time_seconds")).limit(50).all()

    return [
        WebsiteSummaryResponse(
            domain=r.domain,
            visit_count=r.visit_count,
            total_time_seconds=r.total_time_seconds or 0,
        )
        for r in results
    ]


# ─── Keystroke Tracking ───────────────────────────────────────────────────────

@router.post("/keystrokes", response_model=KeystrokeLogResponse, status_code=status.HTTP_201_CREATED)
def log_keystrokes(
    payload: KeystrokeLogRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    attendance = _require_active_session(current_user.id, db)

    log = KeystrokeLog(
        user_id=current_user.id,
        attendance_id=attendance.id,
        keystrokes=payload.keystrokes,
        keystrokes_count=payload.keystrokes_count or len(payload.keystrokes),  # NEW
        active_window=payload.active_window,
        logged_at=payload.logged_at or datetime.now(timezone.utc),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


# ADD this new endpoint at the end of activity.py:
@router.post("/idle", response_model=IdleLogResponse, status_code=status.HTTP_201_CREATED)
def log_idle_interval(
    payload: IdleLogRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save a single completed idle interval. Called each time user returns from idle."""
    attendance = _require_active_session(current_user.id, db)

    log = IdleLog(
        user_id=current_user.id,
        attendance_id=attendance.id,
        idle_start=payload.idle_start,
        idle_end=payload.idle_end,
        idle_duration_seconds=payload.idle_duration_seconds,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/idle", response_model=List[IdleLogResponse])
def get_idle_logs(
    user_id: Optional[str] = None,
    target_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role.value == "employee":
        uid = current_user.id
    else:
        uid = user_id or current_user.id

    query = db.query(IdleLog).filter(IdleLog.user_id == uid)
    if target_date:
        d = date.fromisoformat(target_date)
        query = query.filter(cast(IdleLog.idle_start, Date) == d)

    return query.order_by(IdleLog.idle_start).all()


# ─── Network Speed ────────────────────────────────────────────────────────────

@router.post("/network", response_model=NetworkLogResponse, status_code=status.HTTP_201_CREATED)
def log_network(
    payload: NetworkLogRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    attendance = _require_active_session(current_user.id, db)

    log = NetworkLog(
        user_id=current_user.id,
        attendance_id=attendance.id,
        download_mbps=payload.download_mbps,
        upload_mbps=payload.upload_mbps,
        ping_ms=payload.ping_ms,
        is_connected=payload.is_connected,
        network_type=payload.network_type,
        ssid=payload.ssid,
        logged_at=payload.logged_at or datetime.now(timezone.utc),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


# ─── Summary ──────────────────────────────────────────────────────────────────

@router.get("/summary", response_model=ActivitySummaryResponse)
def get_activity_summary(
    user_id: Optional[str] = None,
    target_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role.value == "employee":
        uid = current_user.id
    else:
        uid = user_id or current_user.id

    query_date = date.fromisoformat(target_date) if target_date else date.today()

    # Get attendance for that day
    from sqlalchemy import desc
    attendance = db.query(AttendanceRecord).filter(
        AttendanceRecord.user_id == employee_id,
        AttendanceRecord.status == AttendanceStatus.CLOCKED_IN,
    ).order_by(desc(AttendanceRecord.clock_in_time)).first()

    attendance_id = attendance.id if attendance else None

    # Activity aggregates
    base_q = db.query(ActivityLog).filter(
        ActivityLog.user_id == uid,
        cast(ActivityLog.logged_at, Date) == query_date,
    )

    agg = base_q.with_entities(
        func.sum(ActivityLog.idle_seconds).label("total_idle"),
        func.sum(ActivityLog.mouse_clicks).label("total_clicks"),
        func.sum(ActivityLog.keystrokes_count).label("total_keys"),
        func.count(ActivityLog.id).label("log_count"),
    ).first()

    # Top apps
    top_apps_q = db.query(
        ActivityLog.active_app_name,
        func.count(ActivityLog.id).label("count")
    ).filter(
        ActivityLog.user_id == uid,
        cast(ActivityLog.logged_at, Date) == query_date,
        ActivityLog.active_app_name.isnot(None),
    ).group_by(ActivityLog.active_app_name).order_by(desc("count")).limit(10).all()

    total_logs = agg.log_count or 0
    total_idle = agg.total_idle or 0
    # Estimate active seconds (1 log ≈ 1 interval, typically 30s or 60s)
    total_active = max(0, total_logs * 30 - total_idle)

    return ActivitySummaryResponse(
        user_id=uid,
        date=str(query_date),
        total_active_seconds=total_active,
        total_idle_seconds=total_idle,
        total_mouse_clicks=agg.total_clicks or 0,
        total_keystrokes=agg.total_keys or 0,
        top_apps=[{"app": r.active_app_name, "count": r.count} for r in top_apps_q],
        attendance_id=attendance_id,
    )
    
@router.get("/employee/{employee_id}/today", response_model=dict)
def get_employee_today(
    employee_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    from datetime import date
    from sqlalchemy import cast, Date, desc, func

    today = date.today()

    # Attendance today
    attendance = db.query(AttendanceRecord).filter(
        AttendanceRecord.user_id == employee_id,
        cast(AttendanceRecord.clock_in_time, Date) == today,
    ).order_by(desc(AttendanceRecord.clock_in_time)).first()

    # Activity aggregates
    agg = db.query(
        func.sum(ActivityLog.idle_seconds).label("total_idle"),
        func.sum(ActivityLog.mouse_clicks).label("total_clicks"),
        func.sum(ActivityLog.keystrokes_count).label("total_keys"),
        func.count(ActivityLog.id).label("log_count"),
    ).filter(
        ActivityLog.user_id == employee_id,
        cast(ActivityLog.logged_at, Date) == today,
    ).first()

    # Top apps
    top_apps = db.query(
        ActivityLog.active_app_name,
        func.count(ActivityLog.id).label("count")
    ).filter(
        ActivityLog.user_id == employee_id,
        cast(ActivityLog.logged_at, Date) == today,
        ActivityLog.active_app_name.isnot(None),
    ).group_by(ActivityLog.active_app_name).order_by(desc("count")).limit(5).all()

    # Website summary today
    websites = db.query(
        WebsiteLog.domain,
        func.count(WebsiteLog.id).label("visit_count"),
        func.sum(WebsiteLog.time_spent_seconds).label("total_time"),
    ).filter(
        WebsiteLog.user_id == employee_id,
        cast(WebsiteLog.visited_at, Date) == today,
    ).group_by(WebsiteLog.domain).order_by(desc("total_time")).limit(10).all()

    # Idle logs today
    idle_logs = db.query(IdleLog).filter(
        IdleLog.user_id == employee_id,
        cast(IdleLog.idle_start, Date) == today,
    ).order_by(IdleLog.idle_start).all()

    total_logs = agg.log_count or 0
    total_idle = agg.total_idle or 0
    total_active = max(0, total_logs * 20 - total_idle)

    return {
        "date": str(today),
        "attendance": {
            "clock_in_time": attendance.clock_in_time.isoformat() if attendance else None,
            "clock_out_time": attendance.clock_out_time.isoformat() if attendance and attendance.clock_out_time else None,
            "total_work_seconds": attendance.total_work_seconds if attendance else None,
            "clock_in_latitude": attendance.clock_in_latitude if attendance else None,
            "clock_in_longitude": attendance.clock_in_longitude if attendance else None,
            "clock_in_download_mbps": attendance.clock_in_download_mbps if attendance else None,
            "status": attendance.status.value if attendance else "not_clocked_in",
        },
        "activity": {
            "total_active_seconds": total_active,
            "total_idle_seconds": total_idle,
            "total_mouse_clicks": agg.total_clicks or 0,
            "total_keystrokes": agg.total_keys or 0,
            "top_apps": [{"app": r.active_app_name, "count": r.count} for r in top_apps],
        },
        "websites": [
            {"domain": r.domain, "visit_count": r.visit_count, "total_time_seconds": r.total_time or 0}
            for r in websites
        ],
        "idle_periods": [
            {
                "start": il.idle_start.isoformat(),
                "end": il.idle_end.isoformat() if il.idle_end else None,
                "duration_seconds": il.idle_duration_seconds,
            }
            for il in idle_logs
        ],
    }