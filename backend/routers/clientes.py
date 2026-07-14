from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Cliente
from schemas import ClienteCreate, ClienteRead
from security import get_current_staff

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
