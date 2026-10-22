from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import (
    ALL_PERMISSION_KEYS, EDITABLE_ROLES, ROLE_PERMISSION_KEYS,
    REQUIRED_ROLE_PERMISSIONS,
    get_permission_catalog_for_role,
    get_permission_keys_for_role,
)
from app.models.employee import Employee
from app.models.permission import RolePermission
from app.api.deps import get_current_employee, require_super_admin
from app.utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/permissions", tags=["Permissions"])


class RolePermissionsUpdate(BaseModel):
    permissions: List[str]


@router.get("/me")
def my_permissions(
    db: Session = Depends(get_db),
    current: Employee = Depends(get_current_employee),
):
    """The app calls this to know which screens and buttons to show."""
    keys = get_permission_keys_for_role(db, current.role)
    return {
        "role": current.role,
        "is_super_admin": current.role == "super_admin",
        "permissions": sorted(keys),
    }


@router.get("/catalog")
def permission_catalog(
    role: str = Query("hr"),
    _: Employee = Depends(require_super_admin),
):
    if role not in EDITABLE_ROLES:
        raise HTTPException(status_code=400, detail="This role has no editable permission catalog")
    return get_permission_catalog_for_role(role)


@router.get("/roles")
def role_permissions(
    db: Session = Depends(get_db),
    _: Employee = Depends(require_super_admin),
):
    return {role: sorted(get_permission_keys_for_role(db, role)) for role in EDITABLE_ROLES}


@router.patch("/roles/{role}")
def update_role_permissions(
    role: str,
    payload: RolePermissionsUpdate,
    db: Session = Depends(get_db),
    current: Employee = Depends(require_super_admin),
):
    if role not in EDITABLE_ROLES:
        raise HTTPException(status_code=400, detail="This role cannot be edited")

    unknown = [k for k in payload.permissions if k not in ALL_PERMISSION_KEYS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown permissions: {', '.join(unknown)}")

    keys = set(payload.permissions)
    missing_required = REQUIRED_ROLE_PERMISSIONS.get(role, set()) - keys
    if missing_required:
        raise HTTPException(
            status_code=400,
            detail=f"Required permissions for {role}: {', '.join(sorted(missing_required))}",
        )
    disallowed = keys - ROLE_PERMISSION_KEYS[role]
    if disallowed:
        raise HTTPException(
            status_code=400,
            detail=f"Permissions not available for {role}: {', '.join(sorted(disallowed))}",
        )

    db.query(RolePermission).filter(RolePermission.role == role).delete()
    for key in keys:
        db.add(RolePermission(role=role, permission_key=key))
    db.commit()

    logger.info(f"{current.email} set {len(keys)} permissions for role '{role}'")
    return {"role": role, "permissions": sorted(keys)}