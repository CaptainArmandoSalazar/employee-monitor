from typing import List
from sqlalchemy.orm import Session

from app.models.permission import Permission, RolePermission

ALL_ROLES = ["super_admin", "hr", "manager", "employee"]
EDITABLE_ROLES = ["hr", "manager", "employee"]   # super_admin is always full access

PERMISSION_CATALOG = [
    {
        "module": "Employees",
        "permissions": [
            {"key": "employee.view", "label": "View employees",
             "description": "See employee lists and profiles inside their scope (HR: everyone except Super Admins; others: direct reports)."},
            {"key": "employee.update", "label": "Edit employees",
             "description": "Change name, department and assigned manager."},
            {"key": "employee.change_role", "label": "Change roles",
             "description": "Move an employee to another role. Limited to roles the user is allowed to create."},
            {"key": "employee.deactivate", "label": "Deactivate accounts",
             "description": "Disable an employee account."},
            {"key": "employee.reactivate", "label": "Reactivate accounts",
             "description": "Enable a disabled account."},
            {"key": "employee.reset_password", "label": "Reset passwords",
             "description": "Set a new password for another person."},
        ],
    },
    {
        "module": "Account creation",
        "permissions": [
            {"key": "employee.create.super_admin", "label": "Create Super Admin accounts", "description": "Add new Super Admins."},
            {"key": "employee.create.hr", "label": "Create HR accounts", "description": "Add new HR users."},
            {"key": "employee.create.manager", "label": "Create Manager accounts", "description": "Add new Managers."},
            {"key": "employee.create.employee", "label": "Create Employee accounts", "description": "Add new Employees."},
        ],
    },
    {
        "module": "Sessions and reports",
        "permissions": [
            {"key": "session.view", "label": "View other people's sessions",
             "description": "See clock-in and clock-out history of people inside their scope."},
            {"key": "summary.view", "label": "View productivity summaries",
             "description": "See active time, idle time, top apps and websites summaries."},
        ],
    },
    {
        "module": "Monitoring data",
        "permissions": [
            {"key": "activity.view", "label": "App activity logs", "description": "Which apps were used and for how long."},
            {"key": "website.view", "label": "Website logs", "description": "Which websites were visited and for how long."},
            {"key": "keystroke.view", "label": "Keystroke logs",
             "description": "Raw typed text and counts. Very sensitive: may contain passwords and private messages."},
            {"key": "metrics.view", "label": "CPU, memory and network speed", "description": "System metrics and speed history."},
            {"key": "device.view", "label": "Device and network info", "description": "Device details, IP, WiFi name and MAC address."},
        ],
    },
    {
        "module": "System",
        "permissions": [
            {"key": "settings.view", "label": "Settings page", "description": "Version, changelog and update controls."},
        ],
    },
]

ALL_PERMISSION_KEYS: List[str] = [
    p["key"] for m in PERMISSION_CATALOG for p in m["permissions"]
]

# Applied only once, on the very first start. After that the Super Admin owns these values.
DEFAULT_ROLE_PERMISSIONS = {
    "hr": [
        "employee.view", "employee.update", "employee.change_role",
        "employee.deactivate", "employee.reactivate", "employee.reset_password",
        "employee.create.hr", "employee.create.manager", "employee.create.employee",
        "session.view", "summary.view",
        "activity.view", "website.view", "metrics.view", "device.view",
        "settings.view",
    ],
    "manager": [
        "employee.view", "employee.update", "employee.deactivate", "employee.reset_password",
        "employee.create.employee",
        "session.view", "summary.view", "metrics.view", "device.view",
    ],
    "employee": [],
}


def get_permission_keys_for_role(db: Session, role: str) -> List[str]:
    if role == "super_admin":
        return list(ALL_PERMISSION_KEYS)
    rows = db.query(RolePermission.permission_key).filter(RolePermission.role == role).all()
    return [r[0] for r in rows]


def has_permission(db: Session, employee, permission_key: str) -> bool:
    if employee.role == "super_admin":
        return True
    return (
        db.query(RolePermission)
        .filter(
            RolePermission.role == employee.role,
            RolePermission.permission_key == permission_key,
        )
        .first()
        is not None
    )


def seed_permissions(db: Session) -> None:
    """Keep the permissions table in sync with the catalog. Defaults are written only on first run."""
    existing = {p.permission_key: p for p in db.query(Permission).all()}
    first_run = len(existing) == 0

    for module in PERMISSION_CATALOG:
        for item in module["permissions"]:
            row = existing.get(item["key"])
            if row is None:
                db.add(Permission(
                    permission_key=item["key"],
                    module=module["module"],
                    label=item["label"],
                    description=item["description"],
                ))
            else:
                row.module = module["module"]
                row.label = item["label"]
                row.description = item["description"]
    db.commit()

    if first_run:
        for role, keys in DEFAULT_ROLE_PERMISSIONS.items():
            for key in keys:
                db.add(RolePermission(role=role, permission_key=key))
        db.commit()