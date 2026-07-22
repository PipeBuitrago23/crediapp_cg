from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Cliente
from schemas import ClienteCreate, ClienteRead, ClienteUpdate
from security import get_current_admin, get_current_staff

router = APIRouter(prefix="/clientes", tags=["clientes"], dependencies=[Depends(get_current_staff)])


@router.get("", response_model=list[ClienteRead])
async def listar_clientes(
    documento: Optional[str] = Query(default=None),
    limit: Optional[int] = Query(default=None, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    query = select(Cliente)
    if documento:
        query = query.where(Cliente.documento == documento)
    if limit is not None:
        query = query.order_by(Cliente.id.desc()).limit(limit)
    resultado = await db.scalars(query)
    return resultado.all()


@router.post("", response_model=ClienteRead, status_code=status.HTTP_201_CREATED)
async def crear_cliente(payload: ClienteCreate, db: AsyncSession = Depends(get_db)):
    existente = await db.scalar(
        select(Cliente).where(
            (Cliente.documento == payload.documento) | (Cliente.email == payload.email)
        )
    )
    if existente is not None:
        campo = "documento" if existente.documento == payload.documento else "email"
        raise HTTPException(status_code=400, detail=f"Ya existe un cliente registrado con ese {campo}")

    cliente = Cliente(**payload.model_dump())
    db.add(cliente)
    await db.commit()
    await db.refresh(cliente)
    return cliente


@router.patch("/{cliente_id}", response_model=ClienteRead, dependencies=[Depends(get_current_admin)])
async def actualizar_cliente(cliente_id: int, payload: ClienteUpdate, db: AsyncSession = Depends(get_db)):
    cliente = await db.get(Cliente, cliente_id)
    if cliente is None:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    datos = payload.model_dump(exclude_unset=True)

    condiciones = []
    if "documento" in datos:
        condiciones.append(Cliente.documento == datos["documento"])
    if "email" in datos:
        condiciones.append(Cliente.email == datos["email"])
    if condiciones:
        existente = await db.scalar(select(Cliente).where(Cliente.id != cliente_id, or_(*condiciones)))
        if existente is not None:
            campo = "documento" if existente.documento == datos.get("documento") else "email"
            raise HTTPException(status_code=400, detail=f"Ya existe un cliente registrado con ese {campo}")

    for campo, valor in datos.items():
        setattr(cliente, campo, valor)

    await db.commit()
    await db.refresh(cliente)
    return cliente


@router.delete("/{cliente_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(get_current_admin)])
async def eliminar_cliente(cliente_id: int, db: AsyncSession = Depends(get_db)):
    cliente = await db.get(Cliente, cliente_id)
    if cliente is None:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    await db.delete(cliente)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail="No se puede eliminar: el cliente tiene ventas u otros registros asociados",
        )
    return None
