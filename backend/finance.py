from calendar import monthrange
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

CENTAVO = Decimal("0.01")


def tasa_mensual_a_fraccion(tasa_mensual_pct: Decimal) -> Decimal:
    """Convierte una tasa mensual en puntos porcentuales (ej. 2.5) a fracción decimal (0.025)."""
    return tasa_mensual_pct / Decimal("100")


def _sumar_meses(fecha: date, meses: int) -> date:
    mes_total = fecha.month - 1 + meses
    anio = fecha.year + mes_total // 12
    mes = mes_total % 12 + 1
    dia = min(fecha.day, monthrange(anio, mes)[1])
    return date(anio, mes, dia)


def calcular_cuota_fija(monto_financiado: Decimal, tasa_mensual_pct: Decimal, num_cuotas: int) -> Decimal:
    """Cuota fija del sistema francés: C = (P * i) / (1 - (1 + i)^-n)."""
    i = tasa_mensual_a_fraccion(tasa_mensual_pct)
    if i == 0:
        return (monto_financiado / num_cuotas).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    factor = 1 - (1 + i) ** -num_cuotas
    cuota = (monto_financiado * i) / factor
    return cuota.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def generar_tabla_amortizacion(
    monto_financiado: Decimal,
    tasa_mensual_pct: Decimal,
    num_cuotas: int,
    fecha_inicio: date,
) -> list[dict]:
    """Genera la tabla de amortización francesa completa, cuota a cuota.

    La última cuota absorbe el residuo de redondeo acumulado para que la
    suma de capital de todas las cuotas cuadre exactamente con monto_financiado.
    """
    i = tasa_mensual_a_fraccion(tasa_mensual_pct)
    cuota_fija = calcular_cuota_fija(monto_financiado, tasa_mensual_pct, num_cuotas)

    saldo = monto_financiado
    tabla = []
    for numero in range(1, num_cuotas + 1):
        interes = (saldo * i).quantize(CENTAVO, rounding=ROUND_HALF_UP)
        capital = cuota_fija - interes
        if numero == num_cuotas:
            capital = saldo
        saldo -= capital
        tabla.append(
            {
                "numero_cuota": numero,
                "monto_capital": capital,
                "monto_interes": interes,
                "fecha_vencimiento": _sumar_meses(fecha_inicio, numero),
            }
        )
    return tabla
