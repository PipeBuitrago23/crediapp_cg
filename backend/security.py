import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"

EXPIRACION_ADMIN = timedelta(hours=12)
# El portal de cliente es de solo lectura (ver saldo/cuotas, cotizar liquidación
# anticipada) — no hay acción que mueva dinero ni cambie datos de la cuenta, así
# que una sesión más larga prioriza no repetir el OTP en cada visita sin abrir un
# riesgo real de fraude. 7 días balancea eso contra la ventana de exposición si el
# dispositivo del cliente se pierde/comparte (frente a los 30 días evaluados).
EXPIRACION_CLIENTE = timedelta(days=7)
# El vendedor muta datos igual que el admin (crea clientes, celulares, ventas), no
# es de solo lectura como el portal de cliente — misma duración que admin, no la
# sesión larga del cliente.
EXPIRACION_VENDEDOR = timedelta(hours=12)

# auto_error=False para que un header Authorization ausente también caiga en
# nuestro propio 401 (el default de HTTPBearer es 403 para "sin credenciales",
# lo que rompería el manejo uniforme de 401 del frontend para sesión inválida/expirada).
_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, contrasena_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), contrasena_hash.encode("utf-8"))


def crear_token(sub: int, tipo: str, expiracion: timedelta) -> str:
    payload = {
        "sub": str(sub),
        "type": tipo,
        "exp": datetime.now(timezone.utc) + expiracion,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def crear_token_admin(admin_id: int) -> str:
    return crear_token(admin_id, "admin", EXPIRACION_ADMIN)


def crear_token_cliente(cliente_id: int) -> str:
    return crear_token(cliente_id, "cliente", EXPIRACION_CLIENTE)


def crear_token_vendedor(vendedor_id: int) -> str:
    return crear_token(vendedor_id, "vendedor", EXPIRACION_VENDEDOR)


def _decodificar(
    credenciales: Optional[HTTPAuthorizationCredentials], tipos_esperados: frozenset[str]
) -> tuple[int, str]:
    if credenciales is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado")

    try:
        payload = jwt.decode(credenciales.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")

    tipo = payload.get("type")
    if tipo not in tipos_esperados:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")

    return int(payload["sub"]), tipo


def get_current_admin(credenciales: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> int:
    id_, _ = _decodificar(credenciales, frozenset({"admin"}))
    return id_


def get_current_cliente(credenciales: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> int:
    id_, _ = _decodificar(credenciales, frozenset({"cliente"}))
    return id_


def get_current_vendedor(credenciales: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> int:
    id_, _ = _decodificar(credenciales, frozenset({"vendedor"}))
    return id_


def get_current_staff(credenciales: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> int:
    """Admin o vendedor — para endpoints compartidos por ambos roles (clientes, celulares)."""
    id_, _ = _decodificar(credenciales, frozenset({"admin", "vendedor"}))
    return id_
