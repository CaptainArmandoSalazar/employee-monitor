from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import Optional, List
from uuid import UUID
from datetime import date, datetime

from app.models.session import Session as SessionModel
from app.models.activity import ActivityLog
from app.models.website import WebsiteLog
from app.models.keystroke import Keystroke
from app.models.system_metrics import SystemMetric
from app.models.employee import Employee
from app.models.network import NetworkInfo
from app.services.access_service import scope_condition
from app.utils.helpers import seconds_to_hms, utcnow


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


def get_live_dashboard(db: Session, current: Employee):
    employees = (
        db.query(Employee)
        .filter(Employee.status == True, scope_condition(current, Employee.employee_id))  # noqa: E712
        .all()
    )
    active_sessions = (
        db.query(SessionModel)
        .filter(SessionModel.session_status == "active", scope_condition(current, SessionModel.employee_id))
        .all()
    )
    online_ids = {s.employee_id for s in active_sessions}

    active_employee_ids = {s.employee_id for s in active_sessions}
    idle_employee_ids = {
        row[0]
        for row in db.query(ActivityLog.employee_id)
        .filter(ActivityLog.is_idle == True, scope_condition(current, ActivityLog.employee_id))
        .group_by(ActivityLog.employee_id)
        .all()
    }

    employee_rows = []
    for employee in employees:
        last_session = (
            db.query(SessionModel)
            .filter(SessionModel.employee_id == employee.employee_id)
            .order_by(desc(SessionModel.clock_in))
            .first()
        )
        employee_rows.append({
            "employee_id": str(employee.employee_id),
            "employee_name": employee.employee_name,
            "status": "online" if employee.employee_id in online_ids else "offline",
            "current_session_active": employee.employee_id in active_employee_ids,
            "last_seen": last_session.clock_in.isoformat() if last_session and last_session.clock_in else None,
            "is_idle": employee.employee_id in idle_employee_ids,
        })

    return {
        "total_employees": len(employees),
        "online_employees": len(online_ids),
        "active_sessions": len(active_sessions),
        "idle_employees": len(idle_employee_ids),
        "employees": employee_rows,
    }


def get_activity_timeline(db: Session, current: Employee, employee_id: Optional[UUID] = None, target_date: Optional[date] = None):
    q = db.query(ActivityLog).filter(scope_condition(current, ActivityLog.employee_id))
    if employee_id:
        q = q.filter(ActivityLog.employee_id == employee_id)
    if target_date:
        day_start = datetime.combine(target_date, datetime.min.time())
        day_end = day_start.replace(hour=23, minute=59, second=59)
        q = q.filter(ActivityLog.start_time >= day_start, ActivityLog.start_time <= day_end)

    buckets = {}
    for row in q.all():
        bucket_key = (row.start_time or utcnow()).strftime("%Y-%m-%d %H:00")
        if bucket_key not in buckets:
            buckets[bucket_key] = {"time": bucket_key, "duration_seconds": 0, "apps": set()}
        buckets[bucket_key]["duration_seconds"] += int(row.duration or 0)
        if row.app_name:
            buckets[bucket_key]["apps"].add(row.app_name)

    timeline = []
    for bucket in sorted(buckets.values(), key=lambda b: b["time"]):
        timeline.append({
            "time": bucket["time"],
            "duration_seconds": bucket["duration_seconds"],
            "app_count": len(bucket["apps"]),
            "top_apps": sorted(bucket["apps"])[:5],
        })
    return timeline


def get_idle_analysis(db: Session, current: Employee, employee_id: Optional[UUID] = None, target_date: Optional[date] = None):
    q = db.query(ActivityLog).filter(ActivityLog.is_idle == True, scope_condition(current, ActivityLog.employee_id))
    if employee_id:
        q = q.filter(ActivityLog.employee_id == employee_id)
    if target_date:
        day_start = datetime.combine(target_date, datetime.min.time())
        day_end = day_start.replace(hour=23, minute=59, second=59)
        q = q.filter(ActivityLog.start_time >= day_start, ActivityLog.start_time <= day_end)

    results = []
    grouped = {}
    for row in q.all():
        employee = row.employee
        key = str(row.employee_id)
        if key not in grouped:
            grouped[key] = {
                "employee_id": str(row.employee_id),
                "employee_name": employee.employee_name if employee else "Unknown",
                "idle_seconds": 0,
                "idle_events": 0,
            }
        grouped[key]["idle_seconds"] += int(row.duration or 0)
        grouped[key]["idle_events"] += 1

    for item in grouped.values():
        risk_level = "low"
        if item["idle_seconds"] >= 3600:
            risk_level = "high"
        elif item["idle_seconds"] >= 1800:
            risk_level = "medium"
        item["risk_level"] = risk_level
        item["idle_minutes"] = round(item["idle_seconds"] / 60, 2)
        results.append(item)
    return sorted(results, key=lambda r: r["idle_seconds"], reverse=True)


def get_network_risk(db: Session, current: Employee, employee_id: Optional[UUID] = None, target_date: Optional[date] = None):
    q = db.query(NetworkInfo).filter(scope_condition(current, NetworkInfo.employee_id))
    if employee_id:
        q = q.filter(NetworkInfo.employee_id == employee_id)
    if target_date:
        day_start = datetime.combine(target_date, datetime.min.time())
        day_end = day_start.replace(hour=23, minute=59, second=59)
        q = q.filter(NetworkInfo.captured_at >= day_start, NetworkInfo.captured_at <= day_end)

    findings = []
    for row in q.all():
        ssid = (row.ssid or "").lower()
        issues = []
        if any(token in ssid for token in ["public", "hotspot", "guest", "free", "airport"]):
            issues.append("public_or_guest_wifi")
        if row.connection_type and row.connection_type.lower() in {"mobile", "unknown"}:
            issues.append("untrusted_connection_type")
        if row.ip_address and row.ip_address.startswith("169.254."):
            issues.append("link_local_ip")
        if not issues:
            continue
        if row.employee:
            employee_name = row.employee.employee_name
        else:
            employee_name = "Unknown"
        findings.append({
            "employee_id": str(row.employee_id),
            "employee_name": employee_name,
            "ssid": row.ssid,
            "connection_type": row.connection_type,
            "ip_address": row.ip_address,
            "captured_at": row.captured_at.isoformat() if row.captured_at else None,
            "risk_level": "high" if len(issues) >= 2 else "medium",
            "issues": issues,
        })
    return findings
