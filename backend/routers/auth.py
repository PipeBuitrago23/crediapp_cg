from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Administrador, Cliente, Vendedor
from schemas import AdminLoginRequest, ClienteLoginRequest, TokenResponse
from security import crear_token_admin, crear_token_cliente, crear_token_vendedor, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login_admin(payload: AdminLoginRequest, db: AsyncSession = Depends(get_db)):
    admin = await db.scalar(select(Administrador).where(Administrador.email == payload.email))
    if admin is None or not verify_password(payload.password, admin.contrasena_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")

    return TokenResponse(access_token=crear_token_admin(admin.id))


@router.post("/vendedor/login", response_model=TokenResponse)
async def login_vendedor(payload: AdminLoginRequest, db: AsyncSession = Depends(get_db)):
    vendedor = await db.scalar(select(Vendedor).where(Vendedor.email == payload.email))
    if (
        vendedor is None
        or not vendedor.activo
        or not verify_password(payload.password, vendedor.contrasena_hash)
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")

    return TokenResponse(access_token=crear_token_vendedor(vendedor.id))


@router.post("/cliente/login", response_model=TokenResponse)
async def login_cliente(payload: ClienteLoginRequest, db: AsyncSession = Depends(get_db)):
    """El portal del cliente entra solo con el documento, sin OTP ni contraseña.

    Decisión de producto explícita del dueño del proyecto, tomada sabiendo que
    el documento es el único factor: quien conozca la cédula de un cliente puede
    ver sus datos y su estado de cuenta. El riesgo se acota a divulgación — el
    portal es de solo lectura, ningún endpoint bajo /portal mueve dinero ni
    edita datos. Si eso deja de ser cierto, este endpoint tiene que volver a
    tener un segundo factor.

    A diferencia del flujo OTP anterior, aquí no hay nada que proteger contra
    enumeración: un documento válido devuelve token y uno inválido 401, y esa
    diferencia es inherente a autenticar solo con el documento.
    """
    cliente = await db.scalar(select(Cliente).where(Cliente.documento == payload.documento))
    if cliente is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No encontramos un cliente con ese número de documento",
        )

    return TokenResponse(access_token=crear_token_cliente(cliente.id))
