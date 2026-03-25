from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'a1b2c3d4e5f6'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('employees',
        sa.Column('manager_id', UUID(as_uuid=True),
                  sa.ForeignKey('employees.employee_id'), nullable=True)
    )
    op.execute("UPDATE employees SET role = 'super_admin' WHERE role = 'admin'")


def downgrade():
    op.drop_column('employees', 'manager_id')
    op.execute("UPDATE employees SET role = 'admin' WHERE role = 'super_admin'")