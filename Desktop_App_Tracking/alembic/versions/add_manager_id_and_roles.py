"""add manager_id and update roles

Revision ID: a1b2c3d4e5f6
Revises: 
Create Date: 2026-03-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'a1b2c3d4e5f6'
down_revision = None  # set to your last revision id
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('employees',
        sa.Column('manager_id', UUID(as_uuid=True),
                  sa.ForeignKey('employees.employee_id'), nullable=True)
    )
    # Rename existing 'admin' role to 'super_admin'
    op.execute("UPDATE employees SET role = 'super_admin' WHERE role = 'admin'")


def downgrade():
    op.drop_column('employees', 'manager_id')
    op.execute("UPDATE employees SET role = 'admin' WHERE role = 'super_admin'")