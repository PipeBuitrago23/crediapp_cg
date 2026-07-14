from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Cuota, DetallePago
from schemas import DashboardMetrics
from security import get_current_admin

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/dashboard", response_model=DashboardMetrics, dependencies=[Depends(get_current_admin)])
async def dashboard(db: AsyncSession = Depends(get_db)):
    monto_total_colocado = select(
        func.coalesce(func.sum(DetallePago.monto_financiado), 0)
    ).scalar_subquery()

    monto_pendiente_cobrar = (
        select(func.coalesce(func.sum(Cuota.monto_capital), 0))
        .where(Cuota.estado == "Pendiente")
        .scalar_subquery()
    )

    intereses_generados_recaudados = (
        select(func.coalesce(func.sum(Cuota.monto_interes), 0))
        .where(Cuota.estado == "Pagado")
        .scalar_subquery()
    )

    fila = (
        await db.execute(
            select(
                monto_total_colocado.label("monto_total_colocado"),
                monto_pendiente_cobrar.label("monto_pendiente_cobrar"),
                intereses_generados_recaudados.label("intereses_generados_recaudados"),
            )
        )
    ).one()

    return DashboardMetrics(
        monto_total_colocado=fila.monto_total_colocado,
        monto_pendiente_cobrar=fila.monto_pendiente_cobrar,
        intereses_generados_recaudados=fila.intereses_generados_recaudados,
    )
