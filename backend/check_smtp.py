"""Script manual de diagnóstico del envío de correo (SMTP de Gmail).

Uso (dentro del contenedor, para que tome SMTP_USER/SMTP_PASSWORD del entorno real):
    docker compose exec web python check_smtp.py                    # solo diagnostica
    docker compose exec web python check_smtp.py destino@correo.com # además manda un correo de prueba

En Railway, desde el shell del servicio backend (o con la CLI ya vinculada):
    railway run python check_smtp.py destino@correo.com

Existe porque `email_service._enviar()` es fire-and-forget a propósito: nunca rompe
una venta ni un pago, así que una configuración SMTP mala es invisible desde la API —
`POST /ventas` devuelve 201 igual aunque el resumen nunca haya salido. Este script es
la forma de verlo directamente.

Nunca imprime la contraseña; solo confirma si está presente y con cuántos caracteres.
"""
import os
import smtplib
import ssl
import sys

from email_service import SMTP_HOST, SMTP_PORT, enviar_prueba


def _diagnosticar() -> tuple[str, str] | None:
    """Revisa que las variables existan y tengan forma razonable. None si falta algo."""
    usuario = os.environ.get("SMTP_USER") or ""
    contrasena = os.environ.get("SMTP_PASSWORD") or ""

    print(f"Servidor:      {SMTP_HOST}:{SMTP_PORT}")

    if not usuario:
        print("SMTP_USER:     FALTA (vacío o no definido)")
    else:
        print(f"SMTP_USER:     {usuario}")

    if not contrasena:
        print("SMTP_PASSWORD: FALTA (vacío o no definido)")
    else:
        # Un App Password de Gmail son 16 caracteres; Google los muestra en grupos de 4
        # separados por espacios y es fácil pegarlos con los espacios incluidos.
        sin_espacios = contrasena.replace(" ", "")
        print(f"SMTP_PASSWORD: presente ({len(contrasena)} caracteres)")
        if " " in contrasena:
            print("               AVISO: contiene espacios. Gmail muestra el App Password en")
            print("               grupos de 4, pero debe pegarse sin espacios.")
        if len(sin_espacios) != 16:
            print(f"               AVISO: son {len(sin_espacios)} caracteres sin espacios, no 16.")
            print("               ¿Seguro que es un App Password y no la contraseña normal de Gmail?")
            print("               Genéralo en https://myaccount.google.com/apppasswords (requiere 2FA).")

    if not usuario or not contrasena:
        print()
        print("RESULTADO: SMTP NO CONFIGURADO -> ningún correo sale de la app.")
        print("Las ventas y los pagos se registran igual, pero el cliente nunca recibe")
        print("su resumen de compra ni sus recibos de pago.")
        return None

    return usuario, contrasena


def _probar_login(usuario: str, contrasena: str) -> bool:
    print()
    print("Probando login contra Gmail (sin enviar ningún correo)...")
    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as servidor:
            servidor.login(usuario, contrasena)
    except smtplib.SMTPAuthenticationError as exc:
        print(f"RESULTADO: Gmail RECHAZÓ las credenciales ({exc.smtp_code}).")
        print(f"           {exc.smtp_error.decode(errors='replace') if isinstance(exc.smtp_error, bytes) else exc.smtp_error}")
        print("           Causa habitual: App Password revocado, o se está usando la contraseña")
        print("           normal de la cuenta en vez de un App Password de 16 caracteres.")
        return False
    except (smtplib.SMTPException, ssl.SSLError, OSError) as exc:
        # OSError cubre DNS, timeout y puerto 465 bloqueado por el host — el caso típico
        # cuando el proveedor filtra la salida SMTP, que no es un fallo de credenciales.
        print(f"RESULTADO: no se pudo conectar al servidor ({type(exc).__name__}: {exc}).")
        print("           Esto es red, no credenciales: DNS, timeout, o el puerto 465 bloqueado")
        print("           por el proveedor de hosting.")
        return False

    print("RESULTADO: login EXITOSO -> las credenciales están activas.")
    return True


def _enviar_prueba(destinatario: str) -> None:
    print()
    print(f"Enviando correo de prueba a {destinatario}...")
    # Pasa por _enviar(), el mismo núcleo que usan los resúmenes de venta y los
    # recibos de pago, incluido su manejo de errores.
    enviar_prueba(destinatario)
    print("enviar_prueba() terminó sin excepción.")
    print(f"Revisa la bandeja de {destinatario} (y la carpeta de spam/promociones).")
    print("Si arriba apareció un error de _enviar, el correo NO salió.")


if __name__ == "__main__":
    if len(sys.argv) > 2:
        print("Uso: python check_smtp.py [destinatario@correo.com]")
        sys.exit(1)

    credenciales = _diagnosticar()
    if credenciales is None:
        sys.exit(1)

    if not _probar_login(*credenciales):
        sys.exit(1)

    if len(sys.argv) == 2:
        _enviar_prueba(sys.argv[1])
    else:
        print()
        print("Para confirmar la entrega real, vuelve a correr el script pasando un correo:")
        print("    python check_smtp.py tu-correo@gmail.com")
