# Sistema de Financiamiento de Celulares y Retoma (CrediApp)

Plataforma web responsive diseñada para la gestión de ventas de celulares a crédito, incorporando un sistema de retoma (*trade-in*), abonos iniciales, amortización de cuotas fijas y un portal de consulta exclusivo para los clientes.

## 🚀 Arquitectura y Tecnologías
- **Backend:** Python con **FastAPI** (Estructura asíncrona, ligera y de alto rendimiento).
- **Base de Datos:** **PostgreSQL** (Transacciones ACID para consistencia financiera).
- **Autenticación:** JWT (PyJWT) + bcrypt para tres roles independientes — Administrador, Vendedor y Cliente.
- **Frontend:** HTML5, JavaScript Moderno (ES6+) y **Tailwind CSS** (Interfaz responsive, Mobile-First), con tipografía Montserrat e identidad visual de marca (CG Store).
- **Despliegue:** **Railway** (dos servicios independientes — backend y frontend — optimizados para un consumo eficiente de recursos).
- **Notificaciones:** SMTP nativo a través de **Gmail** (Envío automático de estados de cuenta por correo).
- **Reportes:** Generación de contratos y tablas de pago en PDF del lado del cliente utilizando **jsPDF / html2pdf** (Cero carga para el servidor).
- **Analítica del Panel Admin:** **Chart.js** (gráficas de ventas diarias/mensuales) y **SheetJS (xlsx)** (exportación de créditos activos a Excel), ambas vía CDN y ejecutadas en el navegador — mismo principio de cero carga adicional al servidor.

## 🔐 Autenticación y Roles

Tres roles con acceso independiente vía JWT, cada uno con su propia interfaz:
- **Administrador:** usuario/contraseña. Cuenta inicial creada por script (`backend/create_admin.py`, sin endpoint público de registro). Gestiona vendedores, banners, y ve todos los créditos.
- **Vendedor/Asesor:** usuario/contraseña. Cuentas creadas y activadas/desactivadas por el administrador desde el Panel Admin. Es quien registra clientes, inventario y ventas — cada venta queda atribuida a quien la hizo.
- **Cliente:** sin contraseña, acceso vía código OTP de 4 dígitos enviado a su correo registrado (identificado por documento).

## 📋 Módulos Principales

### 1. Asesor / Ventas (Flujo Wizard en 4 Pasos)
Requiere inicio de sesión como Vendedor.
- **Paso 1 (Cliente):** Selección del **Tipo de Venta** (Crédito o Contado) y registro/validación obligatoria de datos del cliente (Cédula, Nombre, Teléfono, Email).
- **Paso 2 (Equipo Nuevo):** Selección desde el inventario del celular a vender (Marca, Referencia, Costo, Valor comercial, IMEI), o registro de un celular nuevo directamente desde este paso.
- **Paso 3 (Liquidación):** Aplicación de abonos iniciales (Efectivo/Transferencia) y evaluación de celulares en retoma (con enlace de acceso rápido a verificación externa de IMEI). En venta de Contado, abonos + retoma deben cubrir exactamente el valor de venta.
- **Paso 4 (Financiación o Resumen de Pago):** Si es Crédito, proyección del crédito ingresando el número de cuotas y tasa de interés. Si es Contado, resumen de pago único (sin cuotas ni intereses) y comprobante en PDF.

### 2. Panel de Administración (Dashboard)
Requiere inicio de sesión como Administrador.
- KPIs en tiempo real: Créditos activos, Monto colocado (capital y con intereses proyectados), y Pendiente por cobrar (semana y mes actual).
- Gráficas de ventas diarias (últimos 30 días) y mensuales (últimos 12 meses), comparando Contado vs. Crédito.
- Tabla de Créditos Activos (paginada, con búsqueda por cliente/documento y exportación a Excel) e Histórico completo de Ventas (paginado).
- Buscador y visualizador detallado por Cliente o Equipo: Cuotas pendientes, valores exactos, vendedor responsable de la venta y cálculo automatizado de liquidación anticipada.
- Gestión completa de Clientes (crear, editar, eliminar) y celulares disponibles, con formularios para operar sin pasar por el flujo de venta.
- Gestión de cuentas de Vendedores (crear, activar/desactivar).
- Gestor de Banners Publicitarios dinámicos para el portal del cliente.

### 3. Portal Público del Cliente
- Acceso seguro mediante código OTP de 4 dígitos enviado por correo electrónico (sin contraseñas).
- Estado de cuenta detallado (Valor de próxima cuota, fechas de vencimiento y progreso del crédito).
- Cotización de cancelación anticipada: muestra únicamente el monto total a pagar hoy, sin desglose técnico.
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
    vendedor_id INT REFERENCES vendedores(id) NULL, -- quién registró la venta
    tipo_venta VARCHAR(20) DEFAULT 'Credito', -- 'Credito', 'Contado'
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

-- Autenticación: Administradores, Vendedores y OTP de Clientes
CREATE TABLE administradores (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    contrasena_hash VARCHAR(60) NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE vendedores (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    contrasena_hash VARCHAR(60) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE otp_clientes (
    id SERIAL PRIMARY KEY,
    cliente_id INT REFERENCES clientes(id),
    codigo VARCHAR(4) NOT NULL,
    expira_en TIMESTAMP NOT NULL,
    usado BOOLEAN DEFAULT FALSE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);