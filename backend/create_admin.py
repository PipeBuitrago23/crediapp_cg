"""Script manual para crear un administrador.

Uso (dentro del contenedor, para que tome DATABASE_URL de docker-compose):
    docker compose exec web python create_admin.py <email> <password> <nombre>

No existe endpoint público para crear administradores a propósito.
"""
import asyncio
import sys

from sqlalchemy import select

from database import AsyncSessionLocal
from models import Administrador
from security import hash_password


async def crear_admin(email: str, password: str, nombre: str) -> None:
    async with AsyncSessionLocal() as db:
        existente = await db.scalar(select(Administrador).where(Administrador.email == email))
        if existente is not None:
            print(f"Ya existe un administrador con el email {email}")
            return

        admin = Administrador(nombre=nombre, email=email, contrasena_hash=hash_password(password))
        db.add(admin)
        await db.commit()
        print(f"Administrador creado: {email}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Uso: python create_admin.py <email> <password> <nombre>")
        sys.exit(1)

    _, email_arg, password_arg, nombre_arg = sys.argv
    asyncio.run(crear_admin(email_arg, password_arg, nombre_arg))
