import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from routers import admin, auth, banners, celulares, clientes, creditos, portal, vendedores, ventas

app = FastAPI(title="CrediApp API")

# El frontend se despliega como un sitio estático aparte (Fase 4 localmente,
# Fase 6 como segundo servicio en Railway). CORS_ORIGINS es una lista separada por
# comas del/los dominio(s) reales una vez Railway los asigne; sin setear, se
# mantiene el wildcard de siempre para no romper el flujo de desarrollo local.
_cors_origins = (os.environ.get("CORS_ORIGINS") or "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(clientes.router)
app.include_router(celulares.router)
app.include_router(ventas.router)
app.include_router(creditos.router)
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(portal.router)
app.include_router(banners.router)
app.include_router(vendedores.router)

@app.get("/")
async def root():
    return {"status": "ok", "message": "Backend de CrediApp funcionando correctamente"}

@app.get("/health/db")
async def health_db(db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}