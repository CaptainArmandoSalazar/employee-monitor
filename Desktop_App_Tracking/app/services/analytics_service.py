from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import Optional, List
from uuid import UUID
from datetime import date

from app.models.session import Session as SessionModel
from app.models.activity import ActivityLog
from app.models.website import WebsiteLog
from app.models.keystroke import Keystroke
from app.models.system_metrics import SystemMetric
from app.models.employee import Employee
from app.utils.helpers import seconds_to_hms


def get_employee_summary(db: Session, employee_id: UUID, target_date: Optional[date] = None):
    """Return a daily productivity summary for one employee."""
    q = db.query(SessionModel).filter(SessionModel.employee_id == employee_id)
    if target_date:
        q = q.filter(SessionModel.date == target_date)

    sessions = q.all()
    total_active = sum(s.total_active_time or 0 for s in sessions)
    total_idle = sum(s.total_idle_time or 0 for s in sessions)

    # Keystroke total
    ks_q = db.query(func.sum(Keystroke.keys_pressed_count)).filter(
        Keystroke.employee_id == employee_id
    )
    if target_date:
        session_ids = [s.session_id for s in sessions]
        if session_ids:
            ks_q = ks_q.filter(Keystroke.session_id.in_(session_ids))
    total_keys = ks_q.scalar() or 0

    # Top apps
    al_q = db.query(
        ActivityLog.app_name,
        func.sum(ActivityLog.duration).label("total_duration"),
    ).filter(ActivityLog.employee_id == employee_id)
    if target_date:
        session_ids = [s.session_id for s in sessions]
        if session_ids:
            al_q = al_q.filter(ActivityLog.session_id.in_(session_ids))
    top_apps = (
        al_q.group_by(ActivityLog.app_name)
        .order_by(desc("total_duration"))
        .limit(5)
        .all()
    )

    # Top domains
    wl_q = db.query(
        WebsiteLog.domain,
        func.sum(WebsiteLog.duration).label("total_duration"),
    ).filter(WebsiteLog.employee_id == employee_id)
    if target_date:
        session_ids = [s.session_id for s in sessions]
        if session_ids:
            wl_q = wl_q.filter(WebsiteLog.session_id.in_(session_ids))
    top_domains = (
        wl_q.group_by(WebsiteLog.domain)
        .order_by(desc("total_duration"))
        .limit(5)
        .all()
    )

    return {
        "employee_id": str(employee_id),
        "date": str(target_date) if target_date else "all-time",
        "total_sessions": len(sessions),
        "total_active_time": total_active,
        "total_active_time_human": seconds_to_hms(total_active),
        "total_idle_time": total_idle,
        "total_idle_time_human": seconds_to_hms(total_idle),
        "total_keystrokes": total_keys,
        "top_apps": [{"app": r[0], "duration_seconds": r[1]} for r in top_apps],
        "top_domains": [{"domain": r[0], "duration_seconds": r[1]} for r in top_domains],
    }


def get_all_employees_summary(db: Session, target_date: Optional[date] = None):
    """Summary for every employee — admin dashboard overview."""
    employees = db.query(Employee).filter(Employee.status == True).all()
    return [get_employee_summary(db, emp.employee_id, target_date) for emp in employees]


def get_avg_system_metrics(db: Session, session_id: UUID):
    row = db.query(
        func.avg(SystemMetric.cpu_usage).label("avg_cpu"),
        func.avg(SystemMetric.memory_usage).label("avg_memory"),
    ).filter(SystemMetric.session_id == session_id).first()
    return {
        "avg_cpu_usage": round(row.avg_cpu or 0, 2),
        "avg_memory_usage": round(row.avg_memory or 0, 2),
    }
