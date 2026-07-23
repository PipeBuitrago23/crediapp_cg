from datetime import date
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from email_service import enviar_resumen_venta, enviar_resumen_venta_contado
from finance import generar_tabla_amortizacion
from models import Celular, Cliente, Credito, Cuota, DetallePago, Venta
from schemas import CuotaRead, VentaCreate, VentaResponse
from security import get_current_vendedor

router = APIRouter(prefix="/ventas", tags=["ventas"])


@router.post("", response_model=VentaResponse, status_code=status.HTTP_201_CREATED)
async def crear_venta(
    payload: VentaCreate,
    background_tasks: BackgroundTasks,
    vendedor_id: int = Depends(get_current_vendedor),
    db: AsyncSession = Depends(get_db),
):
    if payload.valor_retoma_id is not None and payload.valor_retoma_id == payload.celular_nuevo_id:
        raise HTTPException(status_code=400, detail="El celular en retoma no puede ser el mismo que se vende")

    async with db.begin():
        cliente = await db.get(Cliente, payload.cliente_id)
        if cliente is None:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")

        celular_nuevo = await db.get(Celular, payload.celular_nuevo_id, with_for_update=True)
        if celular_nuevo is None:
            raise HTTPException(status_code=404, detail="Celular nuevo no encontrado")
        if celular_nuevo.estado != "Disponible":
            raise HTTPException(status_code=400, detail="El celular seleccionado no está disponible")

        celular_retoma = None
        valor_retoma = Decimal("0")
        if payload.valor_retoma_id is not None:
            celular_retoma = await db.get(Celular, payload.valor_retoma_id, with_for_update=True)
            if celular_retoma is None:
                raise HTTPException(status_code=404, detail="El celular en retoma no fue encontrado")
            if celular_retoma.estado != "Disponible":
                raise HTTPException(status_code=400, detail="El celular en retoma no está disponible")
            valor_retoma = celular_retoma.valor_comercial

        monto_financiado = (
            payload.valor_venta
            - payload.valor_abono_efectivo
            - payload.valor_abono_transferencia
            - valor_retoma
        )

        if payload.tipo_venta == "Credito":
            if monto_financiado <= 0:
                raise HTTPException(
                    status_code=400,
                    detail="El monto financiado debe ser mayor a cero: los abonos y la retoma ya cubren el valor de venta",
                )
        elif monto_financiado != 0:
            detalle = (
                f"Faltan ${monto_financiado} por cubrir el valor de venta en una venta de contado"
                if monto_financiado > 0
                else f"Los abonos y la retoma exceden el valor de venta en ${-monto_financiado} en una venta de contado"
            )
            raise HTTPException(status_code=400, detail=detalle)

        venta = Venta(
            cliente_id=payload.cliente_id,
            celular_nuevo_id=payload.celular_nuevo_id,
            vendedor_id=vendedor_id,
            tipo_venta=payload.tipo_venta,
            valor_venta=payload.valor_venta,
        )
        db.add(venta)
        await db.flush()

        db.add(
            DetallePago(
                venta_id=venta.id,
                valor_abono_efectivo=payload.valor_abono_efectivo,
                valor_abono_transferencia=payload.valor_abono_transferencia,
                valor_retoma_id=payload.valor_retoma_id,
                monto_financiado=monto_financiado,
            )
        )

        credito = None
        tabla = []
        if payload.tipo_venta == "Credito":
            tabla = generar_tabla_amortizacion(
                monto_financiado=monto_financiado,
                tasa_mensual_pct=payload.tasa_interes_mensual,
                num_cuotas=payload.cuotas_totales,
                fecha_inicio=date.today(),
            )

            credito = Credito(
                venta_id=venta.id,
                tasa_interes_mensual=payload.tasa_interes_mensual,
                cuotas_totales=payload.cuotas_totales,
            )
            db.add(credito)
            await db.flush()

            db.add_all(
                [
                    Cuota(
                        credito_id=credito.id,
                        numero_cuota=fila["numero_cuota"],
                        monto_capital=fila["monto_capital"],
                        monto_interes=fila["monto_interes"],
                        fecha_vencimiento=fila["fecha_vencimiento"],
                    )
                    for fila in tabla
                ]
            )

        celular_nuevo.estado = "Vendido"
        if celular_retoma is not None:
            celular_retoma.estado = "Retomado"

    if payload.tipo_venta == "Credito":
        background_tasks.add_task(
            enviar_resumen_venta,
            destinatario=cliente.email,
            nombre_cliente=cliente.nombre,
            monto_financiado=monto_financiado,
            tasa_interes_mensual=payload.tasa_interes_mensual,
            cuotas=tabla,
        )
    else:
        background_tasks.add_task(
            enviar_resumen_venta_contado,
            destinatario=cliente.email,
            nombre_cliente=cliente.nombre,
            valor_venta=payload.valor_venta,
        )

    return VentaResponse(
        venta_id=venta.id,
        tipo_venta=payload.tipo_venta,
        monto_financiado=monto_financiado,
        credito_id=credito.id if credito is not None else None,
        valor_cuota_fija=(tabla[0]["monto_capital"] + tabla[0]["monto_interes"]) if tabla else None,
        cuotas=[CuotaRead(**fila) for fila in tabla],
    )
