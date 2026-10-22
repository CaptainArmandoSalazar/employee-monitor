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

ROLE_PERMISSION_KEYS = {
    "hr": set(ALL_PERMISSION_KEYS),
    "manager": {
        "employee.view",
        "employee.create.employee",
        "employee.deactivate",
        "employee.reactivate",
    },
    "employee": {"employee.view"},
}

REQUIRED_ROLE_PERMISSIONS = {
    "manager": {"employee.view"},
    "employee": {"employee.view"},
}

SCOPED_VIEW_PERMISSIONS = {
    "employee.view",
    "session.view",
    "summary.view",
    "activity.view",
    "website.view",
    "keystroke.view",
    "metrics.view",
    "device.view",
}

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
        "employee.view", "employee.create.employee", "employee.deactivate",
        "employee.reactivate",
    ],
    "employee": ["employee.view"],
}


def get_permission_keys_for_role(db: Session, role: str) -> List[str]:
    if role == "super_admin":
        return list(ALL_PERMISSION_KEYS)
    rows = db.query(RolePermission.permission_key).filter(RolePermission.role == role).all()
    allowed = ROLE_PERMISSION_KEYS.get(role, set())
    granted = {r[0] for r in rows if r[0] in allowed}
    return sorted(granted | REQUIRED_ROLE_PERMISSIONS.get(role, set()))


def get_permission_catalog_for_role(role: str):
    if role == "hr":
        return PERMISSION_CATALOG

    if role == "manager":
        labels = {
            "employee.view": (
                "View own and team data",
                "See your own data and data for employees who report directly to you.",
            ),
            "employee.create.employee": (
                "Add employees to your team",
                "Create employee accounts assigned to you.",
            ),
            "employee.deactivate": (
                "Deactivate your employees",
                "Deactivate employees who report directly to you.",
            ),
            "employee.reactivate": (
                "Reactivate your employees",
                "Reactivate employees who report directly to you.",
            ),
        }
        modules = [
            {"module": "Data access", "permissions": ["employee.view"]},
            {
                "module": "Team management",
                "permissions": [
                    "employee.create.employee",
                    "employee.deactivate",
                    "employee.reactivate",
                ],
            },
        ]
    elif role == "employee":
        labels = {
            "employee.view": (
                "View my own data",
                "See only your own profile, sessions, and tracking data.",
            ),
        }
        modules = [{"module": "My data", "permissions": ["employee.view"]}]
    else:
        return []

    permission_items = {
        item["key"]: item
        for module in PERMISSION_CATALOG
        for item in module["permissions"]
    }
    return [
        {
            "module": module["module"],
            "permissions": [
                {
                    **permission_items[key],
                    "label": labels[key][0],
                    "description": labels[key][1],
                    "required": key in REQUIRED_ROLE_PERMISSIONS.get(role, set()),
                }
                for key in module["permissions"]
            ],
        }
        for module in modules
    ]


def has_permission(db: Session, employee, permission_key: str) -> bool:
    if employee.role == "super_admin":
        return True
    if (
        employee.role in ("manager", "employee")
        and permission_key in SCOPED_VIEW_PERMISSIONS
        and permission_key != "employee.view"
    ):
        return (
            db.query(RolePermission)
            .filter(
                RolePermission.role == employee.role,
                RolePermission.permission_key == "employee.view",
            )
            .first()
            is not None
        )
    if permission_key not in ROLE_PERMISSION_KEYS.get(employee.role, set()):
        return False
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
    else:
        for role in ("manager", "employee"):
            db.query(RolePermission).filter(
                RolePermission.role == role,
                ~RolePermission.permission_key.in_(ROLE_PERMISSION_KEYS[role]),
            ).delete(synchronize_session=False)
        for role, keys in REQUIRED_ROLE_PERMISSIONS.items():
            for key in keys:
                exists = db.query(RolePermission).filter(
                    RolePermission.role == role,
                    RolePermission.permission_key == key,
                ).first()
                if not exists:
                    db.add(RolePermission(role=role, permission_key=key))
        db.commit()