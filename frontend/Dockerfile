# Imagen liviana para servir el frontend estático (sin build step, sin frameworks) —
# mismo runtime que el backend, sin agregar herramientas nuevas al proyecto.
FROM python:3.11-slim

WORKDIR /app
COPY . .

EXPOSE 8000

# Railway inyecta su propio $PORT en runtime; 8000 es el default para correrlo local.
CMD ["sh", "-c", "python -m http.server \"${PORT:-8000}\" --bind 0.0.0.0 --directory ."]
