# 1. Usar una imagen oficial de Python ultra ligera
FROM python:3.11-slim

# 2. Establecer la carpeta de trabajo dentro del contenedor
WORKDIR /app

# 3. Copiar el archivo de requisitos e instalarlos
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. Copiar el resto del código del backend
COPY . .

# 5. Exponer el puerto donde correrá FastAPI (Railway inyecta su propio $PORT en runtime)
EXPOSE 8000

# 6. Comando de producción: corre migraciones y luego arranca uvicorn sin --reload.
#    docker-compose.yml sobreescribe esto con --reload para desarrollo local.
RUN chmod +x start.sh
CMD ["./start.sh"]