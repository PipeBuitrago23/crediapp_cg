from calendar import monthrange
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

CENTAVO = Decimal("0.01")


def tasa_mensual_a_fraccion(tasa_mensual_pct: Decimal) -> Decimal:
    """Convierte una tasa mensual en puntos porcentuales (ej. 2.5) a fracción decimal (0.025)."""
    return tasa_mensual_pct / Decimal("100")


def _sumar_meses(fecha: date, meses: int, dia_objetivo: int | None = None) -> date:
    """Suma meses calendario. Si se pasa dia_objetivo, ese es el día del mes que se
    intenta usar (en vez del día de `fecha`), recortado al último día del mes cuando
    el mes destino es más corto — ej. día 31 cae en 30 en abril y en 28/29 en febrero.
    El recorte no es acumulativo: cada cuota se calcula desde dia_objetivo, así que
    un 31 vuelve a ser 31 en el siguiente mes que sí lo tenga."""
    mes_total = fecha.month - 1 + meses
    anio = fecha.year + mes_total // 12
    mes = mes_total % 12 + 1
    dia = min(dia_objetivo if dia_objetivo is not None else fecha.day, monthrange(anio, mes)[1])
    return date(anio, mes, dia)


def calcular_capital_mensual(monto_financiado: Decimal, num_cuotas: int) -> Decimal:
    """Abono a capital mensual: P / n, constante en cada cuota (salvo el residuo de la última)."""
    return (monto_financiado / num_cuotas).quantize(CENTAVO, rounding=ROUND_HALF_UP)


def calcular_interes_mensual(monto_financiado: Decimal, tasa_mensual_pct: Decimal) -> Decimal:
    """Interés simple fijo: P * (i / 100), el mismo valor en cada cuota (no decrece sobre saldo)."""
    i = tasa_mensual_a_fraccion(tasa_mensual_pct)
    return (monto_financiado * i).quantize(CENTAVO, rounding=ROUND_HALF_UP)


def calcular_cuota_fija(monto_financiado: Decimal, tasa_mensual_pct: Decimal, num_cuotas: int) -> Decimal:
    """Cuota fija de interés simple: capital mensual + interés mensual fijo."""
    return calcular_capital_mensual(monto_financiado, num_cuotas) + calcular_interes_mensual(
        monto_financiado, tasa_mensual_pct
    )


def generar_tabla_amortizacion(
    monto_financiado: Decimal,
    tasa_mensual_pct: Decimal,
    num_cuotas: int,
    fecha_inicio: date,
    dia_pago: int | None = None,
) -> list[dict]:
    """Genera la tabla de cuotas con interés simple fijo sobre el capital inicial.

    Cada cuota abona el mismo capital (P / n) y paga el mismo interés fijo
    (P * i), sin recalcular sobre saldo pendiente. La última cuota absorbe el
    residuo de redondeo del capital para que la suma cuadre exactamente con
    monto_financiado.

    `fecha_inicio` marca el mes base (normalmente la fecha de venta) y `dia_pago`
    el día del mes de vencimiento; si `dia_pago` es None se usa el día de
    `fecha_inicio`. La primera cuota vence un mes después del mes base.
    """
    capital_mensual = calcular_capital_mensual(monto_financiado, num_cuotas)
    interes_mensual = calcular_interes_mensual(monto_financiado, tasa_mensual_pct)

    tabla = []
    capital_acumulado = Decimal("0")
    for numero in range(1, num_cuotas + 1):
        if numero == num_cuotas:
            capital = monto_financiado - capital_acumulado
        else:
            capital = capital_mensual
        capital_acumulado += capital
        tabla.append(
            {
                "numero_cuota": numero,
                "monto_capital": capital,
                "monto_interes": interes_mensual,
                "fecha_vencimiento": _sumar_meses(fecha_inicio, numero, dia_pago),
            }
        )
    return tabla
