"""drop otp_clientes (login del cliente pasa a ser solo por documento)

Revision ID: 8b3f1c04a7de
Revises: c1d5057d95da
Create Date: 2026-08-24 12:40:00.000000

La tabla solo guardaba códigos OTP efímeros (10 minutos de vigencia, un solo
uso), así que eliminarla no pierde ningún dato de negocio. El downgrade la
recrea idéntica a como la dejó fbfe218873c7, por si se decide volver al OTP.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b3f1c04a7de'
down_revision: Union[str, None] = 'c1d5057d95da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('otp_clientes')


def downgrade() -> None:
    op.create_table('otp_clientes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('cliente_id', sa.Integer(), nullable=False),
    sa.Column('codigo', sa.String(length=4), nullable=False),
    sa.Column('expira_en', sa.DateTime(), nullable=False),
    sa.Column('usado', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('creado_en', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    sa.ForeignKeyConstraint(['cliente_id'], ['clientes.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
