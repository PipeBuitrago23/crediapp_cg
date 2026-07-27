from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class ClienteBase(BaseModel):
    nombre: str = Field(..., max_length=100)
    documento: str = Field(..., max_length=20)
    telefono: str = Field(..., max_length=20)
    email: EmailStr = Field(..., max_length=100)


class ClienteCreate(ClienteBase):
    pass


class ClienteUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, max_length=100)
    documento: Optional[str] = Field(default=None, max_length=20)
    telefono: Optional[str] = Field(default=None, max_length=20)
    email: Optional[EmailStr] = Field(default=None, max_length=100)


class ClienteRead(ClienteBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class CelularBase(BaseModel):
    marca: str = Field(..., max_length=50)
    referencia: str = Field(..., max_length=50)
    imei: str = Field(..., max_length=20)
    valor_costo: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    # Opcional: en una retoma el vendedor solo conoce el valor_costo (lo que se le
    # acredita al cliente); el valor_comercial (precio de reventa en vitrina) se
    # define después, vía PATCH /celulares/{id}, cuando el admin decide ponerlo a la venta.
    valor_comercial: Optional[Decimal] = Field(default=None, gt=0)


class CelularCreate(CelularBase):
    pass


class CelularUpdate(BaseModel):
    marca: Optional[str] = Field(default=None, max_length=50)
    referencia: Optional[str] = Field(default=None, max_length=50)
    valor_costo: Optional[Decimal] = Field(default=None, gt=0)
    valor_comercial: Optional[Decimal] = Field(default=None, gt=0)
    estado: Optional[Literal["Disponible", "Vendido", "Retomado"]] = None


class CelularRead(CelularBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    estado: str


class VentaCreate(BaseModel):
    cliente_id: int
    celular_nuevo_id: int
    tipo_venta: Literal["Contado", "Credito"] = "Credito"
    valor_venta: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    valor_abono_efectivo: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)
    valor_abono_transferencia: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)
    valor_retoma_id: Optional[int] = None
    tasa_interes_mensual: Optional[Decimal] = Field(default=None, ge=0)
    cuotas_totales: Optional[int] = Field(default=None, ge=1, le=60)

    @model_validator(mode="after")
    def _validar_campos_credito(self):
        if self.tipo_venta == "Credito" and (self.tasa_interes_mensual is None or self.cuotas_totales is None):
            raise ValueError("tasa_interes_mensual y cuotas_totales son obligatorios para ventas a crédito")
        return self


class CuotaRead(BaseModel):
    numero_cuota: int
    monto_capital: Decimal
    monto_interes: Decimal
    fecha_vencimiento: date


class VentaResponse(BaseModel):
    venta_id: int
    tipo_venta: str
    monto_financiado: Decimal
    credito_id: Optional[int] = None
    valor_cuota_fija: Optional[Decimal] = None
    cuotas: list[CuotaRead] = Field(default_factory=list)


class CreditoActivoResumen(BaseModel):
    credito_id: int
    cliente_nombre: str
    cliente_documento: str
    equipo_nombre: str
    monto_inicial_financiado: Decimal
    valor_cuota_mensual: Decimal
    cuotas_pagadas: int
    cuotas_totales: int
    cuotas_restantes: int
    saldo_restante_capital: Decimal
    proxima_fecha_pago: Optional[date] = None


class DashboardMetrics(BaseModel):
    creditos_activos_count: int
    monto_colocado_capital: Decimal
    monto_colocado_con_intereses: Decimal
    pendiente_cobrar_semana: Decimal
    pendiente_cobrar_mes: Decimal
    lista_creditos: list[CreditoActivoResumen]


class LiquidacionAnticipadaResponse(BaseModel):
    credito_id: int
    cuota_actual: int
    saldo_capital_pendiente: Decimal
    interes_mes_actual: Decimal
    total_a_pagar: Decimal


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=72)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SolicitarOtpRequest(BaseModel):
    documento: str = Field(..., max_length=20)


class VerificarOtpRequest(BaseModel):
    documento: str = Field(..., max_length=20)
    codigo: str = Field(..., min_length=4, max_length=4)


class CuotaAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    numero_cuota: int
    monto_capital: Decimal
    monto_interes: Decimal
    fecha_vencimiento: date
    estado: str
    fecha_pago: Optional[datetime] = None


class VendedorCreate(BaseModel):
    nombre: str = Field(..., max_length=100)
    email: EmailStr = Field(..., max_length=100)
    password: str = Field(..., min_length=1, max_length=72)


class VendedorUpdate(BaseModel):
    activo: Optional[bool] = None


class VendedorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    email: EmailStr
    activo: bool


class CreditoAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    venta_id: int
    tasa_interes_mensual: Decimal
    cuotas_totales: int
    estado: str
    cliente: ClienteRead
    equipo: CelularRead
    vendedor: Optional[VendedorRead] = None
    cuotas: list[CuotaAdminRead]


class CuotaPagoResponse(BaseModel):
    cuota: CuotaAdminRead
    credito_estado: str


class CreditoPortalRead(BaseModel):
    id: int
    tasa_interes_mensual: Decimal
    cuotas_totales: int
    estado: str
    progreso_pagadas: int
    progreso_total: int
    proxima_cuota: Optional[CuotaAdminRead] = None
    cuotas: list[CuotaAdminRead]


class BannerBase(BaseModel):
    titulo_campana: str = Field(..., max_length=100)
    url_imagen: str
    fecha_inicio: date
    fecha_fin: date


class BannerCreate(BannerBase):
    esta_activo: bool = True


class BannerUpdate(BaseModel):
    titulo_campana: Optional[str] = Field(default=None, max_length=100)
    url_imagen: Optional[str] = None
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None
    esta_activo: Optional[bool] = None


class BannerRead(BannerBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    esta_activo: bool


class VentaEstadisticaPunto(BaseModel):
    periodo: str
    total_contado: Decimal
    total_credito: Decimal


class VentaHistorialItem(BaseModel):
    venta_id: int
    cliente_nombre: str
    cliente_documento: str
    equipo_nombre: str
    tipo_venta: str
    valor_venta: Decimal
    fecha_venta: datetime


class VentasReporte(BaseModel):
    ventas_diarias: list[VentaEstadisticaPunto]
    ventas_mensuales: list[VentaEstadisticaPunto]
    historial: list[VentaHistorialItem]
