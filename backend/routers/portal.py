from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models import Credito, Venta
from routers.creditos import calcular_liquidacion
from schemas import CreditoPortalRead, LiquidacionAnticipadaResponse
from security import get_current_cliente

router = APIRouter(prefix="/portal", tags=["portal"])


@router.get("/mis-creditos", response_model=list[CreditoPortalRead])
async def mis_creditos(
    cliente_id: int = Depends(get_current_cliente),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Credito)
        .join(Venta, Credito.venta_id == Venta.id)
        .where(Venta.cliente_id == cliente_id)
        .options(selectinload(Credito.cuotas))
    )
    resultado = await db.scalars(query)
    creditos = resultado.all()

    respuesta = []
    for credito in creditos:
        pagadas = [c for c in credito.cuotas if c.estado == "Pagado"]
        pendientes = [c for c in credito.cuotas if c.estado == "Pendiente"]
        respuesta.append(
            CreditoPortalRead(
                id=credito.id,
                tasa_interes_mensual=credito.tasa_interes_mensual,
                cuotas_totales=credito.cuotas_totales,
                estado=credito.estado,
                progreso_pagadas=len(pagadas),
                progreso_total=len(credito.cuotas),
                proxima_cuota=pendientes[0] if pendientes else None,
                cuotas=credito.cuotas,
            )
        )
    return respuesta


@router.get("/liquidacion-anticipada/{credito_id}", response_model=LiquidacionAnticipadaResponse)
async def liquidacion_anticipada_portal(
    credito_id: int,
    cliente_id: int = Depends(get_current_cliente),
    db: AsyncSession = Depends(get_db),
):
    propio = await db.scalar(
        select(Credito.id).join(Venta, Credito.venta_id == Venta.id).where(
            Credito.id == credito_id, Venta.cliente_id == cliente_id
        )
    )
    if propio is None:
        raise HTTPException(status_code=404, detail="Crédito no encontrado")

    return await calcular_liquidacion(db, credito_id)
