from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Cliente(Base):
    __tablename__ = "clientes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    documento: Mapped[str] = mapped_column(String(20), unique=True)
    telefono: Mapped[str] = mapped_column(String(20))
    email: Mapped[str] = mapped_column(String(100), unique=True)

    ventas: Mapped[list["Venta"]] = relationship(back_populates="cliente")


class Celular(Base):
    __tablename__ = "celulares"

    id: Mapped[int] = mapped_column(primary_key=True)
    marca: Mapped[str] = mapped_column(String(50))
    referencia: Mapped[str] = mapped_column(String(50))
    imei: Mapped[str] = mapped_column(String(20), unique=True)
    valor_costo: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    valor_comercial: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    estado: Mapped[str] = mapped_column(String(20), server_default=text("'Disponible'"))


class Venta(Base):
    __tablename__ = "ventas"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("clientes.id"))
    celular_nuevo_id: Mapped[int] = mapped_column(ForeignKey("celulares.id"))
    vendedor_id: Mapped[int | None] = mapped_column(ForeignKey("vendedores.id"))
    valor_venta: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    fecha_venta: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())

    cliente: Mapped["Cliente"] = relationship(back_populates="ventas")
    celular_nuevo: Mapped["Celular"] = relationship()
    vendedor: Mapped["Vendedor | None"] = relationship()
    detalle_pago: Mapped["DetallePago"] = relationship(back_populates="venta", uselist=False)
    credito: Mapped["Credito"] = relationship(back_populates="venta", uselist=False)


class DetallePago(Base):
    __tablename__ = "detalle_pagos"

    id: Mapped[int] = mapped_column(primary_key=True)
    venta_id: Mapped[int] = mapped_column(ForeignKey("ventas.id"), unique=True)
    valor_abono_efectivo: Mapped[Decimal] = mapped_column(Numeric(12, 2), server_default=text("0"))
    valor_abono_transferencia: Mapped[Decimal] = mapped_column(Numeric(12, 2), server_default=text("0"))
    valor_retoma_id: Mapped[int | None] = mapped_column(ForeignKey("celulares.id"))
    monto_financiado: Mapped[Decimal] = mapped_column(Numeric(12, 2))

    venta: Mapped["Venta"] = relationship(back_populates="detalle_pago")
    celular_retoma: Mapped["Celular | None"] = relationship()


class Credito(Base):
    __tablename__ = "creditos"

    id: Mapped[int] = mapped_column(primary_key=True)
    venta_id: Mapped[int] = mapped_column(ForeignKey("ventas.id"), unique=True)
    tasa_interes_mensual: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    cuotas_totales: Mapped[int] = mapped_column()
    estado: Mapped[str] = mapped_column(String(20), server_default=text("'Activo'"))

    venta: Mapped["Venta"] = relationship(back_populates="credito")
    cuotas: Mapped[list["Cuota"]] = relationship(back_populates="credito", order_by="Cuota.numero_cuota")


class Cuota(Base):
    __tablename__ = "cuotas"

    id: Mapped[int] = mapped_column(primary_key=True)
    credito_id: Mapped[int] = mapped_column(ForeignKey("creditos.id"))
    numero_cuota: Mapped[int] = mapped_column()
    monto_capital: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    monto_interes: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    fecha_vencimiento: Mapped[date] = mapped_column()
    estado: Mapped[str] = mapped_column(String(20), server_default=text("'Pendiente'"))
    fecha_pago: Mapped[datetime | None] = mapped_column()

    credito: Mapped["Credito"] = relationship(back_populates="cuotas")


class PublicidadBanner(Base):
    __tablename__ = "publicidad_banners"

    id: Mapped[int] = mapped_column(primary_key=True)
    titulo_campana: Mapped[str] = mapped_column(String(100))
    url_imagen: Mapped[str] = mapped_column(Text)
    fecha_inicio: Mapped[date] = mapped_column()
    fecha_fin: Mapped[date] = mapped_column()
    esta_activo: Mapped[bool] = mapped_column(server_default=text("true"))


class Administrador(Base):
    __tablename__ = "administradores"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(100), unique=True)
    contrasena_hash: Mapped[str] = mapped_column(String(60))
    creado_en: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())


class Vendedor(Base):
    __tablename__ = "vendedores"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(100), unique=True)
    contrasena_hash: Mapped[str] = mapped_column(String(60))
    activo: Mapped[bool] = mapped_column(server_default=text("true"))
    creado_en: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())


class OtpCliente(Base):
    __tablename__ = "otp_clientes"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("clientes.id"))
    codigo: Mapped[str] = mapped_column(String(4))
    expira_en: Mapped[datetime] = mapped_column()
    usado: Mapped[bool] = mapped_column(server_default=text("false"))
    creado_en: Mapped[datetime] = mapped_column(server_default=func.current_timestamp())

    cliente: Mapped["Cliente"] = relationship()
