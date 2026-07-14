from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Vendedor
from schemas import VendedorCreate, VendedorRead, VendedorUpdate
from security import get_current_admin, hash_password

router = APIRouter(prefix="/vendedores", tags=["vendedores"], dependencies=[Depends(get_current_admin)])


@router.get("", response_model=list[VendedorRead])
async def listar_vendedores(db: AsyncSession = Depends(get_db)):
    resultado = await db.scalars(select(Vendedor))
    return resultado.all()


@router.post("", response_model=VendedorRead, status_code=status.HTTP_201_CREATED)
async def crear_vendedor(payload: VendedorCreate, db: AsyncSession = Depends(get_db)):
    existente = await db.scalar(select(Vendedor).where(Vendedor.email == payload.email))
    if existente is not None:
        raise HTTPException(status_code=400, detail="Ya existe un vendedor registrado con ese email")

    vendedor = Vendedor(
        nombre=payload.nombre,
        email=payload.email,
        contrasena_hash=hash_password(payload.password),
    )
    db.add(vendedor)
    await db.commit()
    await db.refresh(vendedor)
    return vendedor


@router.patch("/{vendedor_id}", response_model=VendedorRead)
async def actualizar_vendedor(vendedor_id: int, payload: VendedorUpdate, db: AsyncSession = Depends(get_db)):
    vendedor = await db.get(Vendedor, vendedor_id)
    if vendedor is None:
        raise HTTPException(status_code=404, detail="Vendedor no encontrado")

    for campo, valor in payload.model_dump(exclude_unset=True).items():
        setattr(vendedor, campo, valor)

    await db.commit()
    await db.refresh(vendedor)
    return vendedor
