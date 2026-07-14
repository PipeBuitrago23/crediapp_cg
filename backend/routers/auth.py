import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from email_service import enviar_otp
from models import Administrador, Cliente, OtpCliente, Vendedor
from schemas import (
    AdminLoginRequest,
    SolicitarOtpRequest,
    TokenResponse,
    VerificarOtpRequest,
)
from security import crear_token_admin, crear_token_cliente, crear_token_vendedor, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

OTP_VIGENCIA = timedelta(minutes=10)


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


@router.post("/cliente/solicitar-otp", status_code=status.HTTP_204_NO_CONTENT)
async def solicitar_otp(
    payload: SolicitarOtpRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    async with db.begin():
        cliente = await db.scalar(select(Cliente).where(Cliente.documento == payload.documento))
        if cliente is not None:
            await db.execute(
                update(OtpCliente)
                .where(OtpCliente.cliente_id == cliente.id, OtpCliente.usado.is_(False))
                .values(usado=True)
            )
            codigo = f"{secrets.randbelow(10000):04d}"
            db.add(
                OtpCliente(
                    cliente_id=cliente.id,
                    codigo=codigo,
                    expira_en=datetime.utcnow() + OTP_VIGENCIA,
                )
            )

    if cliente is not None:
        background_tasks.add_task(enviar_otp, destinatario=cliente.email, codigo=codigo)

    # Respuesta genérica exista o no el documento, para no filtrar qué documentos están registrados.
    return None


@router.post("/cliente/verificar-otp", response_model=TokenResponse)
async def verificar_otp(payload: VerificarOtpRequest, db: AsyncSession = Depends(get_db)):
    async with db.begin():
        cliente = await db.scalar(select(Cliente).where(Cliente.documento == payload.documento))
        if cliente is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Código inválido o expirado")

        otp = await db.scalar(
            select(OtpCliente)
            .where(
                OtpCliente.cliente_id == cliente.id,
                OtpCliente.codigo == payload.codigo,
                OtpCliente.usado.is_(False),
            )
            .order_by(OtpCliente.id.desc())
            .limit(1)
            .with_for_update()
        )
        if otp is None or otp.expira_en < datetime.utcnow():
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Código inválido o expirado")

        otp.usado = True

    return TokenResponse(access_token=crear_token_cliente(cliente.id))
