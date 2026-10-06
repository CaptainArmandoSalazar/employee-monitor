from alembic import op
import sqlalchemy as sa

revision = 'd8f1a2b3c4e5'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('website_logs', sa.Column('app_name', sa.String(), nullable=True))


def downgrade():
    op.drop_column('website_logs', 'app_name')
