from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Celular
from schemas import CelularCreate, CelularRead
from security import get_current_staff

router = APIRouter(prefix="/celulares", tags=["celulares"], dependencies=[Depends(get_current_staff)])


@router.get("", response_model=list[CelularRead])
async def listar_celulares(
    estado: Optional[str] = Query(default=None),
    limit: Optional[int] = Query(default=None, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    query = select(Celular)
    if estado:
        query = query.where(Celular.estado == estado)
    if limit is not None:
        query = query.order_by(Celular.id.desc()).limit(limit)
    resultado = await db.scalars(query)
    return resultado.all()


@router.post("", response_model=CelularRead, status_code=status.HTTP_201_CREATED)
async def crear_celular(payload: CelularCreate, db: AsyncSession = Depends(get_db)):
    existente = await db.scalar(select(Celular).where(Celular.imei == payload.imei))
    if existente is not None:
        raise HTTPException(status_code=400, detail="Ya existe un celular registrado con ese IMEI")

    celular = Celular(**payload.model_dump())
    db.add(celular)
    await db.commit()
    await db.refresh(celular)
    return celular
