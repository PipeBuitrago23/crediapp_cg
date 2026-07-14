# Sistema de Financiamiento de Celulares y Retoma (CrediApp)

Plataforma web responsive diseñada para la gestión de ventas de celulares a crédito, incorporando un sistema de retoma (*trade-in*), abonos iniciales, amortización de cuotas fijas y un portal de consulta exclusivo para los clientes.

## 🚀 Arquitectura y Tecnologías
- **Backend:** Python con **FastAPI** (Estructura asíncrona, ligera y de alto rendimiento).
- **Base de Datos:** **PostgreSQL** (Transacciones ACID para consistencia financiera).
- **Frontend:** HTML5, JavaScript Moderno (ES6+) y **Tailwind CSS** (Interfaz responsive, Mobile-First).
- **Despliegue:** **Railway** (Optimizado para un consumo eficiente de recursos).
- **Notificaciones:** SMTP nativo a través de **Gmail** (Envío automático de estados de cuenta por correo).
- **Reportes:** Generación de contratos y tablas de pago en PDF del lado del cliente utilizando **jsPDF / html2pdf** (Cero carga para el servidor).

## 📋 Módulos Principales

### 1. Asesor / Ventas (Flujo Wizard en 4 Pasos)
- **Paso 1 (Cliente):** Registro y validación obligatoria de datos (Cédula, Nombre, Teléfono, Email).
- **Paso 2 (Equipo Nuevo):** Selección desde el inventario del celular a vender (Marca, Referencia, Costo, Valor comercial, IMEI).
- **Paso 3 (Liquidación):** Aplicación de abonos iniciales (Efectivo/Transferencia) y evaluación de celulares en retoma (con enlace de acceso rápido a verificación externa de IMEI).
- **Paso 4 (Financiación):** Proyección del crédito ingresando el número de cuotas y tasa de interés.

### 2. Panel de Administración (Dashboard)
- KPIs en tiempo real: Monto total colocado, Monto pendiente por cobrar, e Intereses reales generados.
- Buscador y visualizador detallado por Cliente o Equipo: Cuotas pendientes, valores exactos y cálculo automatizado de liquidación anticipada.
- Gestor de Banners Publicitarios dinámicos para el portal del cliente.

### 3. Portal Público del Cliente
- Acceso seguro mediante Token de un solo uso enviado por correo electrónico (sin contraseñas).
- Estado de cuenta detallado (Valor de próxima cuota, fechas de vencimiento y progreso del crédito).
- Botón de cotización para pago y cancelación anticipada.
- Espacio publicitario dinámico controlado por el administrador.

## 🗄️ Modelo de Datos (PostgreSQL)

```sql
-- Clientes
CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    documento VARCHAR(20) UNIQUE NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL
);

-- Inventario de Celulares
CREATE TABLE celulares (
    id SERIAL PRIMARY KEY,
    marca VARCHAR(50) NOT NULL,
    referencia VARCHAR(50) NOT NULL,
    imei VARCHAR(20) UNIQUE NOT NULL,
    valor_costo NUMERIC(12, 2) NOT NULL,
    valor_comercial NUMERIC(12, 2) NOT NULL,
    estado VARCHAR(20) DEFAULT 'Disponible' -- 'Disponible', 'Vendido', 'Retomado'
);

-- Ventas y Detalles de Pago
CREATE TABLE ventas (
    id SERIAL PRIMARY KEY,
    cliente_id INT REFERENCES clientes(id),
    celular_nuevo_id INT REFERENCES celulares(id),
    valor_venta NUMERIC(12, 2) NOT NULL,
    fecha_venta TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE detalle_pagos (
    id SERIAL PRIMARY KEY,
    venta_id INT REFERENCES ventas(id),
    valor_abono_efectivo NUMERIC(12, 2) DEFAULT 0,
    valor_abono_transferencia NUMERIC(12, 2) DEFAULT 0,
    valor_retoma_id INT REFERENCES celulares(id) NULL,
    monto_financiado NUMERIC(12, 2) NOT NULL
);

-- Créditos y Cuotas
CREATE TABLE creditos (
    id SERIAL PRIMARY KEY,
    venta_id INT REFERENCES ventas(id),
    tasa_interes_mensual NUMERIC(5, 2) NOT NULL,
    cuotas_totales INT NOT NULL,
    estado VARCHAR(20) DEFAULT 'Activo' -- 'Activo', 'Finalizado'
);

CREATE TABLE cuotas (
    id SERIAL PRIMARY KEY,
    credito_id INT REFERENCES creditos(id),
    numero_cuota INT NOT NULL,
    monto_capital NUMERIC(12, 2) NOT NULL,
    monto_interes NUMERIC(12, 2) NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    estado VARCHAR(20) DEFAULT 'Pendiente', -- 'Pendiente', 'Pagado'
    fecha_pago TIMESTAMP NULL
);

-- Banners Publicitarios
CREATE TABLE publicidad_banners (
    id SERIAL PRIMARY KEY,
    titulo_campana VARCHAR(100) NOT NULL,
    url_imagen TEXT NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    esta_activo BOOLEAN DEFAULT TRUE
);