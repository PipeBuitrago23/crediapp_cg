import logging
import os
import smtplib
import ssl
from decimal import Decimal
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
# Sin timeout explícito, un socket colgado deja el hilo del BackgroundTask bloqueado
# indefinidamente, consumiendo un worker del pool que Railway paga.
SMTP_TIMEOUT = 20


def _enviar(destinatario: str, asunto: str, cuerpo_html: str) -> None:
    smtp_user = os.environ.get("SMTP_USER")
    smtp_password = os.environ.get("SMTP_PASSWORD")
    if not smtp_user or not smtp_password:
        logger.warning("SMTP_USER/SMTP_PASSWORD no configurados; correo a %s no enviado", destinatario)
        return

    mensaje = MIMEMultipart("alternative")
    mensaje["Subject"] = asunto
    mensaje["From"] = smtp_user
    mensaje["To"] = destinatario
    mensaje.attach(MIMEText(cuerpo_html, "html"))

    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT) as servidor:
            servidor.login(smtp_user, smtp_password)
            servidor.sendmail(smtp_user, destinatario, mensaje.as_string())
    except (smtplib.SMTPException, ssl.SSLError, OSError):
        # OSError cubre DNS/timeout/puerto bloqueado: sin él, una falla de red se
        # escapaba del BackgroundTask como traceback suelto en vez de este log, y
        # rompía la promesa fire-and-forget de que el correo nunca tumba un request.
        logger.exception("Fallo al enviar correo a %s", destinatario)


def enviar_resumen_venta(
    destinatario: str,
    nombre_cliente: str,
    monto_financiado: Decimal,
    tasa_interes_mensual: Decimal,
    cuotas: list[dict],
) -> None:
    """Se ejecuta en un hilo aparte vía BackgroundTasks; nunca debe bloquear ni fallar la venta."""
    filas_html = "".join(
        "<tr>"
        f"<td>{cuota['numero_cuota']}</td>"
        f"<td>{cuota['fecha_vencimiento'].strftime('%d/%m/%Y')}</td>"
        f"<td>${(cuota['monto_capital'] + cuota['monto_interes']):,.2f}</td>"
        "</tr>"
        for cuota in cuotas
    )
    cuerpo_html = f"""
    <html>
      <body style="font-family: Arial, sans-serif;">
        <p>Hola {nombre_cliente},</p>
        <p>Tu compra a crédito fue registrada exitosamente. Este es el resumen:</p>
        <p><strong>Monto financiado:</strong> ${monto_financiado:,.2f}</p>
        <p><strong>Tasa de interés mensual:</strong> {tasa_interes_mensual}%</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse;">
          <tr><th>Cuota</th><th>Fecha de vencimiento</th><th>Valor a pagar</th></tr>
          {filas_html}
        </table>
        <p>Gracias por tu compra.</p>
      </body>
    </html>
    """
    _enviar(destinatario, "Resumen de tu compra a crédito - CrediApp", cuerpo_html)


def enviar_resumen_venta_contado(destinatario: str, nombre_cliente: str, valor_venta: Decimal) -> None:
    """Se ejecuta en un hilo aparte vía BackgroundTasks; nunca debe bloquear ni fallar la venta."""
    cuerpo_html = f"""
    <html>
      <body style="font-family: Arial, sans-serif;">
        <p>Hola {nombre_cliente},</p>
        <p>Tu compra de contado fue registrada exitosamente.</p>
        <p><strong>Valor pagado:</strong> ${valor_venta:,.2f}</p>
        <p>Gracias por tu compra.</p>
      </body>
    </html>
    """
    _enviar(destinatario, "Resumen de tu compra de contado - CrediApp", cuerpo_html)


def enviar_prueba(destinatario: str) -> None:
    """Correo de diagnóstico. No lo usa ningún endpoint: existe solo para que
    check_smtp.py pueda ejercitar _enviar() de punta a punta (ver ese script)."""
    cuerpo_html = """
    <html>
      <body style="font-family: Arial, sans-serif;">
        <p>Este es un correo de prueba de CrediApp.</p>
        <p>Si lo estás leyendo, la configuración SMTP del servidor funciona:
        los resúmenes de venta y los recibos de pago van a llegar bien.</p>
      </body>
    </html>
    """
    _enviar(destinatario, "Correo de prueba - CrediApp", cuerpo_html)


def enviar_recibo_pago(
    destinatario: str,
    nombre_cliente: str,
    numero_cuota: int,
    monto_pagado: Decimal,
    credito_estado: str,
) -> None:
    """Se ejecuta en un hilo aparte vía BackgroundTasks; nunca debe bloquear ni fallar el request."""
    nota_finalizado = (
        "<p><strong>¡Tu crédito quedó totalmente pagado!</strong></p>" if credito_estado == "Finalizado" else ""
    )
    cuerpo_html = f"""
    <html>
      <body style="font-family: Arial, sans-serif;">
        <p>Hola {nombre_cliente},</p>
        <p>Registramos el pago de tu cuota #{numero_cuota} por un valor de ${monto_pagado:,.2f}.</p>
        {nota_finalizado}
        <p>Gracias por tu pago.</p>
      </body>
    </html>
    """
    _enviar(destinatario, "Recibo de pago - CrediApp", cuerpo_html)
