from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import PublicidadBanner
from schemas import BannerCreate, BannerRead, BannerUpdate
from security import get_current_admin

router = APIRouter(prefix="/banners", tags=["banners"])


@router.get("/activos", response_model=list[BannerRead])
async def listar_banners_activos(db: AsyncSession = Depends(get_db)):
    hoy = date.today()
    query = select(PublicidadBanner).where(
        PublicidadBanner.esta_activo.is_(True),
        PublicidadBanner.fecha_inicio <= hoy,
        PublicidadBanner.fecha_fin >= hoy,
    )
    resultado = await db.scalars(query)
    return resultado.all()


@router.get("", response_model=list[BannerRead], dependencies=[Depends(get_current_admin)])
async def listar_banners(db: AsyncSession = Depends(get_db)):
    resultado = await db.scalars(select(PublicidadBanner))
    return resultado.all()


@router.post("", response_model=BannerRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(get_current_admin)])
async def crear_banner(payload: BannerCreate, db: AsyncSession = Depends(get_db)):
    banner = PublicidadBanner(**payload.model_dump())
    db.add(banner)
    await db.commit()
    await db.refresh(banner)
    return banner


@router.patch("/{banner_id}", response_model=BannerRead, dependencies=[Depends(get_current_admin)])
async def actualizar_banner(banner_id: int, payload: BannerUpdate, db: AsyncSession = Depends(get_db)):
    banner = await db.get(PublicidadBanner, banner_id)
    if banner is None:
        raise HTTPException(status_code=404, detail="Banner no encontrado")

    for campo, valor in payload.model_dump(exclude_unset=True).items():
        setattr(banner, campo, valor)

    await db.commit()
    await db.refresh(banner)
    return banner


@router.delete("/{banner_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(get_current_admin)])
async def eliminar_banner(banner_id: int, db: AsyncSession = Depends(get_db)):
    banner = await db.get(PublicidadBanner, banner_id)
    if banner is None:
        raise HTTPException(status_code=404, detail="Banner no encontrado")

    await db.delete(banner)
    await db.commit()
    return None
