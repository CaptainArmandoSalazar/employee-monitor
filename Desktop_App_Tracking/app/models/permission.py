from sqlalchemy import Column, String, Text, ForeignKey
from app.core.database import Base


class Permission(Base):
    """Catalog of every permission the system knows about."""
    __tablename__ = "permissions"

    permission_key = Column(String, primary_key=True)
    module = Column(String, nullable=False)
    label = Column(String, nullable=False)
    description = Column(Text, nullable=True)


class RolePermission(Base):
    """Which role has which permission. Edited by the Super Admin from the app."""
    __tablename__ = "role_permissions"

    role = Column(String, primary_key=True)
    permission_key = Column(
        String,
        ForeignKey("permissions.permission_key", ondelete="CASCADE"),
        primary_key=True,
    )