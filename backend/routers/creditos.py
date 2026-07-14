from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from email_service import enviar_recibo_pago
from models import Celular, Credito, Cuota, Venta
from schemas import CreditoAdminRead, CuotaPagoResponse, LiquidacionAnticipadaResponse
from security import get_current_admin

router = APIRouter(prefix="/creditos", tags=["creditos"], dependencies=[Depends(get_current_admin)])


async def calcular_liquidacion(db: AsyncSession, credito_id: int) -> LiquidacionAnticipadaResponse:
    credito = await db.get(Credito, credito_id)
    if credito is None:
        raise HTTPException(status_code=404, detail="Crédito no encontrado")

    primera_pendiente = await db.scalar(
        select(Cuota)
        .where(Cuota.credito_id == credito_id, Cuota.estado == "Pendiente")
        .order_by(Cuota.numero_cuota)
        .limit(1)
    )
    if primera_pendiente is None:
        raise HTTPException(status_code=400, detail="Este crédito ya está completamente pagado")

    saldo_capital_pendiente = await db.scalar(
        select(func.coalesce(func.sum(Cuota.monto_capital), 0)).where(
            Cuota.credito_id == credito_id, Cuota.estado == "Pendiente"
        )
    )

    interes_mes_actual = primera_pendiente.monto_interes
    total_a_pagar = saldo_capital_pendiente + interes_mes_actual

    return LiquidacionAnticipadaResponse(
        credito_id=credito_id,
        cuota_actual=primera_pendiente.numero_cuota,
        saldo_capital_pendiente=saldo_capital_pendiente,
        interes_mes_actual=interes_mes_actual,
        total_a_pagar=total_a_pagar,
    )


@router.get("/{credito_id}/liquidacion-anticipada", response_model=LiquidacionAnticipadaResponse)
async def liquidacion_anticipada(credito_id: int, db: AsyncSession = Depends(get_db)):
    return await calcular_liquidacion(db, credito_id)


@router.get("", response_model=list[CreditoAdminRead])
async def listar_creditos(
    cliente_id: Optional[int] = None,
    imei: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Credito)
        .join(Venta, Credito.venta_id == Venta.id)
        .options(
            selectinload(Credito.cuotas),
            selectinload(Credito.venta).selectinload(Venta.cliente),
            selectinload(Credito.venta).selectinload(Venta.celular_nuevo),
            selectinload(Credito.venta).selectinload(Venta.vendedor),
        )
    )
    if cliente_id is not None:
        query = query.where(Venta.cliente_id == cliente_id)
    if imei is not None:
        query = query.join(Celular, Venta.celular_nuevo_id == Celular.id).where(Celular.imei == imei)

    resultado = await db.scalars(query)
    creditos = resultado.all()

    return [
        CreditoAdminRead(
            id=credito.id,
            venta_id=credito.venta_id,
            tasa_interes_mensual=credito.tasa_interes_mensual,
            cuotas_totales=credito.cuotas_totales,
            estado=credito.estado,
            cliente=credito.venta.cliente,
            equipo=credito.venta.celular_nuevo,
            vendedor=credito.venta.vendedor,
            cuotas=credito.cuotas,
        )
        for credito in creditos
    ]


@router.post("/{credito_id}/cuotas/{numero_cuota}/pagar", response_model=CuotaPagoResponse)
async def pagar_cuota(
    credito_id: int,
    numero_cuota: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    async with db.begin():
        cuota = await db.scalar(
            select(Cuota)
            .where(Cuota.credito_id == credito_id, Cuota.numero_cuota == numero_cuota)
            .with_for_update()
        )
        if cuota is None:
            raise HTTPException(status_code=404, detail="Cuota no encontrada")
        if cuota.estado == "Pagado":
            raise HTTPException(status_code=400, detail="Esta cuota ya fue pagada")

        cuota.estado = "Pagado"
        cuota.fecha_pago = datetime.utcnow()

        pendientes_restantes = await db.scalar(
            select(func.count())
            .select_from(Cuota)
            .where(Cuota.credito_id == credito_id, Cuota.estado == "Pendiente")
        )

        credito = await db.get(Credito, credito_id, with_for_update=True)
        if pendientes_restantes == 0:
            credito.estado = "Finalizado"

        venta = await db.scalar(
            select(Venta).where(Venta.id == credito.venta_id).options(selectinload(Venta.cliente))
        )
        monto_pagado = cuota.monto_capital + cuota.monto_interes

    background_tasks.add_task(
        enviar_recibo_pago,
        destinatario=venta.cliente.email,
        nombre_cliente=venta.cliente.nombre,
        numero_cuota=cuota.numero_cuota,
        monto_pagado=monto_pagado,
        credito_estado=credito.estado,
    )

    return CuotaPagoResponse(cuota=cuota, credito_estado=credito.estado)
