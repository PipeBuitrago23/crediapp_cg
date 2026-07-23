from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models import Credito, Cuota, DetallePago, Venta
from schemas import CreditoActivoResumen, DashboardMetrics, VentaEstadisticaPunto, VentaHistorialItem, VentasReporte
from security import get_current_admin

router = APIRouter(prefix="/admin", tags=["admin"])


async def _listar_creditos_activos(db: AsyncSession) -> list[CreditoActivoResumen]:
    query = (
        select(Credito)
        .where(Credito.estado == "Activo")
        .options(
            selectinload(Credito.cuotas),
            selectinload(Credito.venta).selectinload(Venta.cliente),
            selectinload(Credito.venta).selectinload(Venta.celular_nuevo),
            selectinload(Credito.venta).selectinload(Venta.detalle_pago),
        )
        .order_by(Credito.id.desc())
    )
    creditos = (await db.scalars(query)).all()

    resumenes = []
    for credito in creditos:
        cuotas = credito.cuotas  # ya vienen ordenadas por numero_cuota (ver relationship)
        pendientes = [c for c in cuotas if c.estado == "Pendiente"]
        pagadas = len(cuotas) - len(pendientes)
        saldo_capital = sum((c.monto_capital for c in pendientes), Decimal("0"))
        cuota_referencia = cuotas[0] if cuotas else None

        resumenes.append(
            CreditoActivoResumen(
                credito_id=credito.id,
                cliente_nombre=credito.venta.cliente.nombre,
                cliente_documento=credito.venta.cliente.documento,
                equipo_nombre=f"{credito.venta.celular_nuevo.marca} {credito.venta.celular_nuevo.referencia}",
                monto_inicial_financiado=credito.venta.detalle_pago.monto_financiado,
                valor_cuota_mensual=(
                    cuota_referencia.monto_capital + cuota_referencia.monto_interes
                    if cuota_referencia
                    else Decimal("0")
                ),
                cuotas_pagadas=pagadas,
                cuotas_totales=credito.cuotas_totales,
                cuotas_restantes=credito.cuotas_totales - pagadas,
                saldo_restante_capital=saldo_capital,
                proxima_fecha_pago=pendientes[0].fecha_vencimiento if pendientes else None,
            )
        )
    return resumenes


@router.get("/dashboard", response_model=DashboardMetrics, dependencies=[Depends(get_current_admin)])
async def dashboard(db: AsyncSession = Depends(get_db)):
    hoy = date.today()
    inicio_semana = hoy - timedelta(days=hoy.weekday())
    fin_semana = inicio_semana + timedelta(days=6)
    inicio_mes = hoy.replace(day=1)
    fin_mes = hoy.replace(day=monthrange(hoy.year, hoy.month)[1])

    creditos_activos_count = (
        select(func.count()).select_from(Credito).where(Credito.estado == "Activo").scalar_subquery()
    )
    monto_colocado_capital = select(
        func.coalesce(func.sum(DetallePago.monto_financiado), 0)
    ).scalar_subquery()
    monto_colocado_con_intereses = select(
        func.coalesce(func.sum(Cuota.monto_capital + Cuota.monto_interes), 0)
    ).scalar_subquery()
    pendiente_cobrar_semana = (
        select(func.coalesce(func.sum(Cuota.monto_capital + Cuota.monto_interes), 0))
        .where(
            Cuota.estado == "Pendiente",
            Cuota.fecha_vencimiento >= inicio_semana,
            Cuota.fecha_vencimiento <= fin_semana,
        )
        .scalar_subquery()
    )
    pendiente_cobrar_mes = (
        select(func.coalesce(func.sum(Cuota.monto_capital + Cuota.monto_interes), 0))
        .where(
            Cuota.estado == "Pendiente",
            Cuota.fecha_vencimiento >= inicio_mes,
            Cuota.fecha_vencimiento <= fin_mes,
        )
        .scalar_subquery()
    )

    fila = (
        await db.execute(
            select(
                creditos_activos_count.label("creditos_activos_count"),
                monto_colocado_capital.label("monto_colocado_capital"),
                monto_colocado_con_intereses.label("monto_colocado_con_intereses"),
                pendiente_cobrar_semana.label("pendiente_cobrar_semana"),
                pendiente_cobrar_mes.label("pendiente_cobrar_mes"),
            )
        )
    ).one()

    return DashboardMetrics(
        creditos_activos_count=fila.creditos_activos_count,
        monto_colocado_capital=fila.monto_colocado_capital,
        monto_colocado_con_intereses=fila.monto_colocado_con_intereses,
        pendiente_cobrar_semana=fila.pendiente_cobrar_semana,
        pendiente_cobrar_mes=fila.pendiente_cobrar_mes,
        lista_creditos=await _listar_creditos_activos(db),
    )


def _mes_anterior(anio: int, mes: int) -> tuple[int, int]:
    return (anio - 1, 12) if mes == 1 else (anio, mes - 1)


@router.get("/ventas", response_model=VentasReporte, dependencies=[Depends(get_current_admin)])
async def reporte_ventas(db: AsyncSession = Depends(get_db)):
    hoy = date.today()
    totales_vacios = {"Contado": Decimal("0"), "Credito": Decimal("0")}

    # ---- Ventas diarias (últimos 30 días) ----
    inicio_30dias = hoy - timedelta(days=29)
    periodo_diario_expr = func.to_char(Venta.fecha_venta, "YYYY-MM-DD")
    filas_diarias = (
        await db.execute(
            select(
                periodo_diario_expr.label("periodo"),
                Venta.tipo_venta,
                func.coalesce(func.sum(Venta.valor_venta), 0).label("total"),
            )
            .where(func.date(Venta.fecha_venta) >= inicio_30dias)
            .group_by(periodo_diario_expr, Venta.tipo_venta)
        )
    ).all()

    totales_diarios: dict[str, dict[str, Decimal]] = {}
    for fila in filas_diarias:
        totales_diarios.setdefault(fila.periodo, dict(totales_vacios))[fila.tipo_venta] = fila.total

    ventas_diarias = []
    for offset in range(30):
        clave = (inicio_30dias + timedelta(days=offset)).isoformat()
        totales = totales_diarios.get(clave, totales_vacios)
        ventas_diarias.append(
            VentaEstadisticaPunto(
                periodo=clave, total_contado=totales["Contado"], total_credito=totales["Credito"]
            )
        )

    # ---- Ventas mensuales (últimos 12 meses) ----
    periodos_mensuales = []
    anio, mes = hoy.year, hoy.month
    for _ in range(12):
        periodos_mensuales.append((anio, mes))
        anio, mes = _mes_anterior(anio, mes)
    periodos_mensuales.reverse()

    inicio_12meses = datetime(periodos_mensuales[0][0], periodos_mensuales[0][1], 1)
    periodo_mensual_expr = func.to_char(Venta.fecha_venta, "YYYY-MM")
    filas_mensuales = (
        await db.execute(
            select(
                periodo_mensual_expr.label("periodo"),
                Venta.tipo_venta,
                func.coalesce(func.sum(Venta.valor_venta), 0).label("total"),
            )
            .where(Venta.fecha_venta >= inicio_12meses)
            .group_by(periodo_mensual_expr, Venta.tipo_venta)
        )
    ).all()

    totales_mensuales: dict[str, dict[str, Decimal]] = {}
    for fila in filas_mensuales:
        totales_mensuales.setdefault(fila.periodo, dict(totales_vacios))[fila.tipo_venta] = fila.total

    ventas_mensuales = []
    for anio, mes in periodos_mensuales:
        clave = f"{anio:04d}-{mes:02d}"
        totales = totales_mensuales.get(clave, totales_vacios)
        ventas_mensuales.append(
            VentaEstadisticaPunto(
                periodo=clave, total_contado=totales["Contado"], total_credito=totales["Credito"]
            )
        )

    # ---- Histórico completo de ventas ----
    ventas = (
        await db.scalars(
            select(Venta)
            .options(selectinload(Venta.cliente), selectinload(Venta.celular_nuevo))
            .order_by(Venta.fecha_venta.desc())
        )
    ).all()

    historial = [
        VentaHistorialItem(
            venta_id=venta.id,
            cliente_nombre=venta.cliente.nombre,
            cliente_documento=venta.cliente.documento,
            equipo_nombre=f"{venta.celular_nuevo.marca} {venta.celular_nuevo.referencia}",
            tipo_venta=venta.tipo_venta,
            valor_venta=venta.valor_venta,
            fecha_venta=venta.fecha_venta,
        )
        for venta in ventas
    ]

    return VentasReporte(ventas_diarias=ventas_diarias, ventas_mensuales=ventas_mensuales, historial=historial)
