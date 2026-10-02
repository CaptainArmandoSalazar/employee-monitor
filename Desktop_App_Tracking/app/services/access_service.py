from sqlalchemy import select, or_
from sqlalchemy.orm import Session, aliased

from app.models.employee import Employee


def scope_condition(current: Employee, column):
    """
    SQL condition limiting `column` (an employee_id column) to the people `current` may see.
    Super Admin data is private to that Super Admin.
    An alias is used so the subquery never collides with the outer query.
    """
    E = aliased(Employee)

    if current.role == "super_admin":
        # everyone except OTHER super admins
        return ~column.in_(
            select(E.employee_id).where(
                E.role == "super_admin",
                E.employee_id != current.employee_id,
            )
        )

    if current.role == "hr":
        # everyone except super admins
        return ~column.in_(select(E.employee_id).where(E.role == "super_admin"))

    if current.role == "manager":
        # own direct reports and self (never a super admin)
        return column.in_(
            select(E.employee_id).where(
                or_(E.manager_id == current.employee_id, E.employee_id == current.employee_id),
                E.role != "super_admin",
            )
        )

    # employee (and any other role): only self
    return column == current.employee_id


def can_access_employee_data(db: Session, current: Employee, employee_id) -> bool:
    if employee_id == current.employee_id:
        return True
    row = (
        db.query(Employee.employee_id)
        .filter(Employee.employee_id == employee_id, scope_condition(current, Employee.employee_id))
        .first()
    )
    return row is not None


def can_view_account(current: Employee, target: Employee) -> bool:
    if target.employee_id == current.employee_id:
        return True
    if current.role == "super_admin":
        return True
    if current.role == "hr":
        return target.role != "super_admin"
    return target.manager_id == current.employee_id


def can_manage_account(current: Employee, target: Employee) -> bool:
    if current.role == "super_admin":
        return True
    if current.role == "hr":
        return target.role != "super_admin"
    return target.manager_id == current.employee_id


def is_last_super_admin(db: Session, target: Employee) -> bool:
    if target.role != "super_admin" or not target.status:
        return False
    others = (
        db.query(Employee)
        .filter(
            Employee.role == "super_admin",
            Employee.status == True,  # noqa: E712
            Employee.employee_id != target.employee_id,
        )
        .count()
    )
    return others == 0