import { api, ApiError, setToken, clearToken } from "./api.js";
import { formatoMoneda } from "./format.js";

const STORAGE_KEY = "crediapp_admin_token";

let ultimaBusqueda = null; // { tipo: "documento" | "imei", valor: string }
let creditosActivosCache = [];
let ventasHistorialCache = [];

const TAM_PAGINA = 10;
let paginaCreditos = 1;
let paginaVentas = 1;

let chartVentasDiarias = null;
let chartVentasMensuales = null;

const el = (id) => document.getElementById(id);

function mostrarError(mensaje) {
  const caja = el("mensaje-error");
  caja.textContent = mensaje;
  caja.classList.remove("hidden");
}

function limpiarError() {
  const caja = el("mensaje-error");
  caja.textContent = "";
  caja.classList.add("hidden");
}

// ---------- Paginación genérica ----------

function paginar(lista, pagina) {
  const totalPaginas = Math.max(1, Math.ceil(lista.length / TAM_PAGINA));
  const paginaValida = Math.min(Math.max(pagina, 1), totalPaginas);
  const inicio = (paginaValida - 1) * TAM_PAGINA;
  return { pagina: lista.slice(inicio, inicio + TAM_PAGINA), paginaValida, totalPaginas };
}

function actualizarControlesPaginacion(prefijo, paginaActual, totalPaginas) {
  el(`${prefijo}-pagina-indicador`).textContent = `Página ${paginaActual} de ${totalPaginas}`;
  el(`btn-${prefijo}-anterior`).disabled = paginaActual <= 1;
  el(`btn-${prefijo}-siguiente`).disabled = paginaActual >= totalPaginas;
}

function mostrarLogin() {
  el("vista-login").classList.remove("hidden");
  el("vista-panel").classList.add("hidden");
  el("btn-abrir-modal-cliente").classList.add("hidden");
}

function mostrarPanel() {
  el("vista-login").classList.add("hidden");
  el("vista-panel").classList.remove("hidden");
  el("btn-abrir-modal-cliente").classList.remove("hidden");
}

async function manejarLlamada(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      cerrarSesion();
      mostrarError("Tu sesión expiró. Vuelve a iniciar sesión.");
    } else {
      mostrarError(error.message);
    }
    return null;
  }
}

// ---------- Sesión ----------

async function iniciarSesion() {
  limpiarError();
  const email = el("login-email").value.trim();
  const password = el("login-password").value;
  if (!email || !password) {
    mostrarError("Ingresa email y contraseña.");
    return;
  }

  // No pasa por manejarLlamada: un 401 acá es "credenciales inválidas", no una
  // sesión expirada — mostrar ese mensaje real en vez del genérico de sesión.
  try {
    const respuesta = await api.post("/auth/login", { email, password });
    localStorage.setItem(STORAGE_KEY, respuesta.access_token);
    setToken(respuesta.access_token);
    mostrarPanel();
    cargarDashboard();
    cargarVentasReporte();
    cargarBanners();
    cargarVendedores();
    cargarClientesRecientes();
    cargarCelularesDisponibles();
  } catch (error) {
    mostrarError(error.message);
  }
}

function cerrarSesion() {
  clearToken();
  localStorage.removeItem(STORAGE_KEY);
  mostrarLogin();
}

// ---------- Dashboard ----------

async function cargarDashboard() {
  const metrics = await manejarLlamada(() => api.get("/admin/dashboard"));
  if (!metrics) return;

  el("kpi-creditos-activos").textContent = metrics.creditos_activos_count;
  el("kpi-monto-colocado").textContent = `$${formatoMoneda(metrics.monto_colocado_capital)}`;
  el("kpi-monto-colocado-intereses").textContent = `Con intereses: $${formatoMoneda(metrics.monto_colocado_con_intereses)}`;
  el("kpi-pendiente-semana").textContent = `$${formatoMoneda(metrics.pendiente_cobrar_semana)}`;
  el("kpi-pendiente-mes").textContent = `$${formatoMoneda(metrics.pendiente_cobrar_mes)}`;

  creditosActivosCache = metrics.lista_creditos;
  el("buscar-tabla-creditos").value = "";
  paginaCreditos = 1;
  renderizarTablaCreditosActivos(creditosActivosCache);
}

// ---------- Tabla de créditos activos ----------

function renderizarTablaCreditosActivos(lista) {
  const cuerpo = el("tabla-creditos-activos-body");

  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="8" class="p-3 text-sm text-slate-500 text-center">No hay créditos activos.</td></tr>';
    actualizarControlesPaginacion("creditos", 1, 1);
    return;
  }

  const { pagina, paginaValida, totalPaginas } = paginar(lista, paginaCreditos);
  paginaCreditos = paginaValida;

  cuerpo.innerHTML = pagina
    .map(
      (credito) => `
        <tr class="border-b border-slate-100">
          <td class="p-2">
            <p class="font-medium">${credito.cliente_nombre}</p>
            <p class="text-xs text-slate-500">${credito.cliente_documento}</p>
          </td>
          <td class="p-2">${credito.equipo_nombre}</td>
          <td class="p-2">$${formatoMoneda(credito.monto_inicial_financiado)}</td>
          <td class="p-2">$${formatoMoneda(credito.valor_cuota_mensual)}</td>
          <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">${credito.cuotas_pagadas} / ${credito.cuotas_totales}</span></td>
          <td class="p-2">$${formatoMoneda(credito.saldo_restante_capital)}</td>
          <td class="p-2">${credito.proxima_fecha_pago ?? "—"}</td>
          <td class="p-2">
            <button type="button" class="btn-ver-detalle-credito px-3 py-1.5 rounded bg-accent hover:bg-accent-dark text-white text-xs font-medium" data-documento="${credito.cliente_documento}">Ver Detalle</button>
          </td>
        </tr>
      `
    )
    .join("");

  actualizarControlesPaginacion("creditos", paginaCreditos, totalPaginas);
}

function obtenerListaCreditosFiltrada() {
  const termino = el("buscar-tabla-creditos").value.trim().toLowerCase();
  if (!termino) return creditosActivosCache;
  return creditosActivosCache.filter(
    (credito) =>
      credito.cliente_nombre.toLowerCase().includes(termino) ||
      credito.cliente_documento.toLowerCase().includes(termino)
  );
}

function filtrarTablaCreditosActivos() {
  paginaCreditos = 1;
  renderizarTablaCreditosActivos(obtenerListaCreditosFiltrada());
}

function verDetalleCredito(documento) {
  el("buscar-documento").value = documento;
  buscarPorDocumento();
  el("resultados-creditos").scrollIntoView({ behavior: "smooth", block: "start" });
}

function exportarCreditosExcel() {
  const filas = creditosActivosCache.map((credito) => ({
    Cliente: credito.cliente_nombre,
    Documento: credito.cliente_documento,
    Equipo: credito.equipo_nombre,
    "Monto Inicial": Number(credito.monto_inicial_financiado),
    "Cuota Mensual": Number(credito.valor_cuota_mensual),
    "Cuotas Pagadas": credito.cuotas_pagadas,
    "Cuotas Totales": credito.cuotas_totales,
    "Saldo Restante": Number(credito.saldo_restante_capital),
    "Próx. Vencimiento": credito.proxima_fecha_pago ?? "",
  }));

  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Creditos Activos");
  XLSX.writeFile(libro, `creditos-activos-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------- Ventas: gráficas e histórico ----------

async function cargarVentasReporte() {
  const reporte = await manejarLlamada(() => api.get("/admin/ventas"));
  if (!reporte) return;

  renderizarGraficasVentas(reporte.ventas_diarias, reporte.ventas_mensuales);

  ventasHistorialCache = reporte.historial;
  paginaVentas = 1;
  renderizarTablaVentasHistorial();
}

function renderizarGraficasVentas(ventasDiarias, ventasMensuales) {
  const coloresDataset = [
    { label: "Contado", color: "#00C853" },
    { label: "Crédito", color: "#0056BF" },
  ];

  if (chartVentasDiarias) chartVentasDiarias.destroy();
  chartVentasDiarias = new Chart(el("grafica-ventas-diarias").getContext("2d"), {
    type: "bar",
    data: {
      labels: ventasDiarias.map((punto) => punto.periodo.slice(5)),
      datasets: [
        { label: coloresDataset[0].label, data: ventasDiarias.map((p) => Number(p.total_contado)), backgroundColor: coloresDataset[0].color },
        { label: coloresDataset[1].label, data: ventasDiarias.map((p) => Number(p.total_credito)), backgroundColor: coloresDataset[1].color },
      ],
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { position: "bottom" } },
    },
  });

  if (chartVentasMensuales) chartVentasMensuales.destroy();
  chartVentasMensuales = new Chart(el("grafica-ventas-mensuales").getContext("2d"), {
    type: "line",
    data: {
      labels: ventasMensuales.map((punto) => punto.periodo),
      datasets: [
        { label: coloresDataset[0].label, data: ventasMensuales.map((p) => Number(p.total_contado)), borderColor: coloresDataset[0].color, backgroundColor: `${coloresDataset[0].color}33`, tension: 0.3 },
        { label: coloresDataset[1].label, data: ventasMensuales.map((p) => Number(p.total_credito)), borderColor: coloresDataset[1].color, backgroundColor: `${coloresDataset[1].color}33`, tension: 0.3 },
      ],
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { position: "bottom" } },
    },
  });
}

function renderizarTablaVentasHistorial() {
  const cuerpo = el("tabla-ventas-historial-body");

  if (ventasHistorialCache.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="6" class="p-3 text-sm text-slate-500 text-center">No hay ventas registradas.</td></tr>';
    actualizarControlesPaginacion("ventas", 1, 1);
    return;
  }

  const { pagina, paginaValida, totalPaginas } = paginar(ventasHistorialCache, paginaVentas);
  paginaVentas = paginaValida;

  cuerpo.innerHTML = pagina
    .map((venta) => {
      const tipoBadgeClase = venta.tipo_venta === "Contado" ? "bg-accent/10 text-accent-dark" : "bg-primary/10 text-primary";
      return `
        <tr class="border-b border-slate-100">
          <td class="p-2">${venta.venta_id}</td>
          <td class="p-2">${venta.cliente_nombre} <span class="text-xs text-slate-500">(${venta.cliente_documento})</span></td>
          <td class="p-2">${venta.equipo_nombre}</td>
          <td class="p-2"><span class="px-2 py-0.5 rounded-full text-xs font-medium ${tipoBadgeClase}">${venta.tipo_venta}</span></td>
          <td class="p-2">$${formatoMoneda(venta.valor_venta)}</td>
          <td class="p-2">${venta.fecha_venta.slice(0, 10)}</td>
        </tr>
      `;
    })
    .join("");

  actualizarControlesPaginacion("ventas", paginaVentas, totalPaginas);
}

// ---------- Buscador de créditos ----------

async function buscarPorDocumento() {
  limpiarError();
  const documento = el("buscar-documento").value.trim();
  if (!documento) {
    mostrarError("Ingresa un documento para buscar.");
    return;
  }

  const clientes = await manejarLlamada(() => api.get(`/clientes?documento=${encodeURIComponent(documento)}`));
  if (!clientes) return;
  if (clientes.length === 0) {
    mostrarError("No se encontró ningún cliente con ese documento.");
    el("resultados-creditos").innerHTML = "";
    return;
  }

  ultimaBusqueda = { tipo: "cliente_id", valor: clientes[0].id };
  await ejecutarUltimaBusqueda();
}

async function buscarPorImei() {
  limpiarError();
  const imei = el("buscar-imei").value.trim();
  if (!imei) {
    mostrarError("Ingresa un IMEI para buscar.");
    return;
  }

  ultimaBusqueda = { tipo: "imei", valor: imei };
  await ejecutarUltimaBusqueda();
}

async function ejecutarUltimaBusqueda() {
  if (!ultimaBusqueda) return;
  const creditos = await manejarLlamada(() =>
    api.get(`/creditos?${ultimaBusqueda.tipo}=${encodeURIComponent(ultimaBusqueda.valor)}`)
  );
  if (!creditos) return;
  renderizarCreditos(creditos);
}

function renderizarCreditos(creditos) {
  if (creditos.length === 0) {
    el("resultados-creditos").innerHTML = '<p class="text-sm text-slate-500">Sin resultados.</p>';
    return;
  }

  el("resultados-creditos").innerHTML = creditos
    .map((credito, indice) => {
      const filasCuotas = credito.cuotas
        .map(
          (cuota) => `
            <tr class="border-b border-slate-100">
              <td class="p-2">${cuota.numero_cuota}</td>
              <td class="p-2">${cuota.fecha_vencimiento}</td>
              <td class="p-2">$${formatoMoneda(Number(cuota.monto_capital) + Number(cuota.monto_interes))}</td>
              <td class="p-2">${cuota.estado}</td>
              <td class="p-2">
                ${
                  cuota.estado === "Pendiente"
                    ? `<button type="button" class="btn-pagar-cuota px-2 py-1 rounded bg-accent hover:bg-accent-dark text-white text-xs" data-credito="${credito.id}" data-numero="${cuota.numero_cuota}">Marcar pagada</button>`
                    : ""
                }
              </td>
            </tr>
          `
        )
        .join("");

      const estadoBadgeClase = credito.estado === "Activo" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent-dark";
      const ocultoClase = indice === 0 ? "" : "hidden";

      return `
        <div class="rounded-lg border border-slate-200 overflow-hidden">
          <button type="button" class="btn-toggle-detalle-credito w-full flex items-center justify-between gap-2 p-4 text-left hover:bg-slate-50" data-credito-detalle="${credito.id}">
            <div>
              <p class="font-semibold">${credito.cliente.nombre} (${credito.cliente.documento}) — ${credito.equipo.marca} ${credito.equipo.referencia}</p>
              <p class="text-sm text-slate-500">Crédito #${credito.id} — <span class="px-2 py-0.5 rounded-full text-xs font-medium ${estadoBadgeClase}">${credito.estado}</span> — Tasa: ${credito.tasa_interes_mensual}% — Vendido por: ${credito.vendedor ? credito.vendedor.nombre : "Sin asignar"}</p>
            </div>
            <span class="text-slate-400 text-lg">▾</span>
          </button>
          <div class="detalle-credito-cuotas ${ocultoClase} px-4 pb-4" data-credito-cuotas="${credito.id}">
            <div class="overflow-x-auto">
              <table class="w-full text-sm border-collapse">
                <thead>
                  <tr class="bg-slate-100 text-left">
                    <th class="p-2">Cuota</th>
                    <th class="p-2">Vence</th>
                    <th class="p-2">Total</th>
                    <th class="p-2">Estado</th>
                    <th class="p-2"></th>
                  </tr>
                </thead>
                <tbody>${filasCuotas}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function pagarCuota(creditoId, numeroCuota) {
  limpiarError();
  const resultado = await manejarLlamada(() => api.post(`/creditos/${creditoId}/cuotas/${numeroCuota}/pagar`, {}));
  if (!resultado) return;
  await ejecutarUltimaBusqueda();
  await cargarDashboard();
}

// ---------- Clientes recientes / celulares disponibles ----------

const LIMITE_LISTAS = 15;

let clientesRecientesCache = [];

async function cargarClientesRecientes() {
  const clientes = await manejarLlamada(() => api.get(`/clientes?limit=${LIMITE_LISTAS}`));
  if (!clientes) return;

  clientesRecientesCache = clientes;

  if (clientes.length === 0) {
    el("lista-clientes-recientes").innerHTML = '<p class="text-sm text-slate-500">No hay clientes registrados.</p>';
    return;
  }

  el("lista-clientes-recientes").innerHTML = clientes
    .map(
      (cliente) => `
        <div class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
          <div>
            <p class="font-medium">${cliente.nombre} — ${cliente.documento}</p>
            <p class="text-slate-500">${cliente.telefono} · ${cliente.email}</p>
          </div>
          <div class="flex gap-2 shrink-0">
            <button type="button" class="btn-editar-cliente px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-xs font-medium" data-id="${cliente.id}">Editar</button>
            <button type="button" class="btn-eliminar-cliente px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium" data-id="${cliente.id}">Eliminar</button>
          </div>
        </div>
      `
    )
    .join("");
}

async function eliminarCliente(id) {
  limpiarError();
  const cliente = clientesRecientesCache.find((c) => c.id === id);
  const nombre = cliente ? cliente.nombre : `#${id}`;
  if (!window.confirm(`¿Eliminar al cliente ${nombre}? Esta acción no se puede deshacer.`)) return;

  const resultado = await manejarLlamada(async () => {
    await api.delete(`/clientes/${id}`);
    return true;
  });
  if (!resultado) return;
  await cargarClientesRecientes();
}

async function cargarCelularesDisponibles() {
  const celulares = await manejarLlamada(() => api.get(`/celulares?estado=Disponible&limit=${LIMITE_LISTAS}`));
  if (!celulares) return;

  if (celulares.length === 0) {
    el("lista-celulares-disponibles").innerHTML = '<p class="text-sm text-slate-500">No hay celulares disponibles.</p>';
    return;
  }

  el("lista-celulares-disponibles").innerHTML = celulares
    .map(
      (celular) => `
        <div class="rounded-lg border border-slate-200 p-3 text-sm">
          <p class="font-medium">${celular.marca} ${celular.referencia}</p>
          <p class="text-slate-500">IMEI ${celular.imei} · $${formatoMoneda(celular.valor_comercial)}</p>
        </div>
      `
    )
    .join("");
}

async function crearCelular() {
  limpiarError();
  const marca = el("celular-marca").value.trim();
  const referencia = el("celular-referencia").value.trim();
  const imei = el("celular-imei").value.trim();
  const valor_costo = Number(el("celular-costo").value);
  const valor_comercial = Number(el("celular-comercial").value);

  if (!marca || !referencia || !imei || !valor_costo || !valor_comercial) {
    mostrarError("Completa todos los campos del celular.");
    return;
  }

  const celular = await manejarLlamada(() =>
    api.post("/celulares", { marca, referencia, imei, valor_costo, valor_comercial })
  );
  if (!celular) return;

  ["celular-marca", "celular-referencia", "celular-imei", "celular-costo", "celular-comercial"].forEach(
    (id) => (el(id).value = "")
  );
  await cargarCelularesDisponibles();
}

// ---------- Banners ----------

async function cargarBanners() {
  const banners = await manejarLlamada(() => api.get("/banners"));
  if (!banners) return;

  if (banners.length === 0) {
    el("lista-banners").innerHTML = '<p class="text-sm text-slate-500">No hay banners creados.</p>';
    return;
  }

  el("lista-banners").innerHTML = banners
    .map(
      (banner) => `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
          <div>
            <p class="font-medium">${banner.titulo_campana} ${banner.esta_activo ? '<span class="text-green-600">(activo)</span>' : '<span class="text-slate-400">(inactivo)</span>'}</p>
            <p class="text-slate-500">${banner.fecha_inicio} → ${banner.fecha_fin}</p>
          </div>
          <div class="flex gap-2">
            <button type="button" class="btn-toggle-banner px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-xs font-medium" data-id="${banner.id}" data-activo="${banner.esta_activo}">
              ${banner.esta_activo ? "Desactivar" : "Activar"}
            </button>
            <button type="button" class="btn-eliminar-banner px-3 py-1.5 rounded bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium" data-id="${banner.id}">Eliminar</button>
          </div>
        </div>
      `
    )
    .join("");
}

async function crearBanner() {
  limpiarError();
  const titulo_campana = el("banner-titulo").value.trim();
  const url_imagen = el("banner-url").value.trim();
  const fecha_inicio = el("banner-inicio").value;
  const fecha_fin = el("banner-fin").value;

  if (!titulo_campana || !url_imagen || !fecha_inicio || !fecha_fin) {
    mostrarError("Completa todos los campos del banner.");
    return;
  }

  const banner = await manejarLlamada(() =>
    api.post("/banners", { titulo_campana, url_imagen, fecha_inicio, fecha_fin })
  );
  if (!banner) return;

  ["banner-titulo", "banner-url", "banner-inicio", "banner-fin"].forEach((id) => (el(id).value = ""));
  await cargarBanners();
}

async function alternarBanner(id, activoActual) {
  const resultado = await manejarLlamada(() => api.patch(`/banners/${id}`, { esta_activo: !activoActual }));
  if (!resultado) return;
  await cargarBanners();
}

async function eliminarBanner(id) {
  const resultado = await manejarLlamada(async () => {
    await api.delete(`/banners/${id}`);
    return true;
  });
  if (!resultado) return;
  await cargarBanners();
}

// ---------- Vendedores ----------

async function cargarVendedores() {
  const vendedores = await manejarLlamada(() => api.get("/vendedores"));
  if (!vendedores) return;

  if (vendedores.length === 0) {
    el("lista-vendedores").innerHTML = '<p class="text-sm text-slate-500">No hay vendedores creados.</p>';
    return;
  }

  el("lista-vendedores").innerHTML = vendedores
    .map(
      (vendedor) => `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
          <div>
            <p class="font-medium">${vendedor.nombre} ${vendedor.activo ? '<span class="text-green-600">(activo)</span>' : '<span class="text-slate-400">(inactivo)</span>'}</p>
            <p class="text-slate-500">${vendedor.email}</p>
          </div>
          <button type="button" class="btn-toggle-vendedor px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-xs font-medium" data-id="${vendedor.id}" data-activo="${vendedor.activo}">
            ${vendedor.activo ? "Desactivar" : "Activar"}
          </button>
        </div>
      `
    )
    .join("");
}

async function crearVendedor() {
  limpiarError();
  const nombre = el("vendedor-nombre").value.trim();
  const email = el("vendedor-email").value.trim();
  const password = el("vendedor-password").value;

  if (!nombre || !email || !password) {
    mostrarError("Completa todos los campos del vendedor.");
    return;
  }

  const vendedor = await manejarLlamada(() => api.post("/vendedores", { nombre, email, password }));
  if (!vendedor) return;

  ["vendedor-nombre", "vendedor-email", "vendedor-password"].forEach((id) => (el(id).value = ""));
  await cargarVendedores();
}

async function alternarVendedor(id, activoActual) {
  const resultado = await manejarLlamada(() => api.patch(`/vendedores/${id}`, { activo: !activoActual }));
  if (!resultado) return;
  await cargarVendedores();
}

// ---------- Crear cliente (modal) ----------

function mostrarErrorModalCliente(mensaje) {
  el("modal-cliente-exito").classList.add("hidden");
  const caja = el("modal-cliente-error");
  caja.textContent = mensaje;
  caja.classList.remove("hidden");
}

function limpiarMensajesModalCliente() {
  el("modal-cliente-error").classList.add("hidden");
  el("modal-cliente-exito").classList.add("hidden");
}

let clienteEditandoId = null;

function abrirModalCliente() {
  clienteEditandoId = null;
  limpiarMensajesModalCliente();
  el("modal-cliente-titulo").textContent = "Crear Nuevo Cliente";
  ["modal-cliente-nombre", "modal-cliente-documento", "modal-cliente-telefono", "modal-cliente-email"].forEach(
    (id) => (el(id).value = "")
  );
  el("modal-cliente-nuevo").classList.remove("hidden");
}

function abrirModalEditarCliente(id) {
  const cliente = clientesRecientesCache.find((c) => c.id === id);
  if (!cliente) return;

  clienteEditandoId = id;
  limpiarMensajesModalCliente();
  el("modal-cliente-titulo").textContent = "Editar Cliente";
  el("modal-cliente-nombre").value = cliente.nombre;
  el("modal-cliente-documento").value = cliente.documento;
  el("modal-cliente-telefono").value = cliente.telefono;
  el("modal-cliente-email").value = cliente.email;
  el("modal-cliente-nuevo").classList.remove("hidden");
}

function cerrarModalCliente() {
  el("modal-cliente-nuevo").classList.add("hidden");
}

async function guardarCliente() {
  limpiarMensajesModalCliente();
  const nombre = el("modal-cliente-nombre").value.trim();
  const documento = el("modal-cliente-documento").value.trim();
  const telefono = el("modal-cliente-telefono").value.trim();
  const email = el("modal-cliente-email").value.trim();

  if (!nombre || !documento || !telefono || !email) {
    mostrarErrorModalCliente("Completa todos los campos del cliente.");
    return;
  }

  try {
    if (clienteEditandoId === null) {
      await api.post("/clientes", { nombre, documento, telefono, email });
      el("modal-cliente-exito").textContent = "Cliente creado exitosamente.";
    } else {
      await api.patch(`/clientes/${clienteEditandoId}`, { nombre, documento, telefono, email });
      el("modal-cliente-exito").textContent = "Cliente actualizado exitosamente.";
    }
    el("modal-cliente-exito").classList.remove("hidden");
    await cargarClientesRecientes();
    setTimeout(cerrarModalCliente, 1500);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // Sesión expirada: cerrar el modal también, o el login quedaría tapado detrás.
      cerrarModalCliente();
      cerrarSesion();
      mostrarError("Tu sesión expiró. Vuelve a iniciar sesión.");
    } else {
      mostrarErrorModalCliente(error.message);
    }
  }
}

// ---------- Inicialización ----------

document.addEventListener("DOMContentLoaded", () => {
  el("btn-login").addEventListener("click", iniciarSesion);
  el("btn-logout").addEventListener("click", cerrarSesion);
  el("btn-buscar-documento").addEventListener("click", buscarPorDocumento);
  el("btn-buscar-imei").addEventListener("click", buscarPorImei);
  el("btn-crear-banner").addEventListener("click", crearBanner);
  el("btn-crear-vendedor").addEventListener("click", crearVendedor);
  el("btn-crear-celular").addEventListener("click", crearCelular);
  el("btn-abrir-modal-cliente").addEventListener("click", abrirModalCliente);
  el("btn-cancelar-modal-cliente").addEventListener("click", cerrarModalCliente);
  el("btn-guardar-modal-cliente").addEventListener("click", guardarCliente);

  el("lista-clientes-recientes").addEventListener("click", (evento) => {
    const botonEditar = evento.target.closest(".btn-editar-cliente");
    if (botonEditar) {
      abrirModalEditarCliente(Number(botonEditar.dataset.id));
      return;
    }
    const botonEliminar = evento.target.closest(".btn-eliminar-cliente");
    if (botonEliminar) {
      eliminarCliente(Number(botonEliminar.dataset.id));
    }
  });

  el("buscar-tabla-creditos").addEventListener("input", filtrarTablaCreditosActivos);
  el("btn-exportar-excel").addEventListener("click", exportarCreditosExcel);

  el("btn-creditos-anterior").addEventListener("click", () => {
    paginaCreditos -= 1;
    renderizarTablaCreditosActivos(obtenerListaCreditosFiltrada());
  });
  el("btn-creditos-siguiente").addEventListener("click", () => {
    paginaCreditos += 1;
    renderizarTablaCreditosActivos(obtenerListaCreditosFiltrada());
  });

  el("btn-ventas-anterior").addEventListener("click", () => {
    paginaVentas -= 1;
    renderizarTablaVentasHistorial();
  });
  el("btn-ventas-siguiente").addEventListener("click", () => {
    paginaVentas += 1;
    renderizarTablaVentasHistorial();
  });

  el("tabla-creditos-activos-body").addEventListener("click", (evento) => {
    const boton = evento.target.closest(".btn-ver-detalle-credito");
    if (!boton) return;
    verDetalleCredito(boton.dataset.documento);
  });

  el("lista-vendedores").addEventListener("click", (evento) => {
    const boton = evento.target.closest(".btn-toggle-vendedor");
    if (!boton) return;
    alternarVendedor(Number(boton.dataset.id), boton.dataset.activo === "true");
  });

  el("resultados-creditos").addEventListener("click", (evento) => {
    const botonToggle = evento.target.closest(".btn-toggle-detalle-credito");
    if (botonToggle) {
      const id = botonToggle.dataset.creditoDetalle;
      const panel = document.querySelector(`.detalle-credito-cuotas[data-credito-cuotas="${id}"]`);
      const estabaAbierto = panel && !panel.classList.contains("hidden");
      document.querySelectorAll(".detalle-credito-cuotas").forEach((p) => p.classList.add("hidden"));
      if (panel && !estabaAbierto) panel.classList.remove("hidden");
      return;
    }

    const botonPagar = evento.target.closest(".btn-pagar-cuota");
    if (botonPagar) {
      pagarCuota(Number(botonPagar.dataset.credito), Number(botonPagar.dataset.numero));
    }
  });

  el("lista-banners").addEventListener("click", (evento) => {
    const botonToggle = evento.target.closest(".btn-toggle-banner");
    if (botonToggle) {
      alternarBanner(Number(botonToggle.dataset.id), botonToggle.dataset.activo === "true");
      return;
    }
    const botonEliminar = evento.target.closest(".btn-eliminar-banner");
    if (botonEliminar) {
      eliminarBanner(Number(botonEliminar.dataset.id));
    }
  });

  const tokenGuardado = localStorage.getItem(STORAGE_KEY);
  if (tokenGuardado) {
    setToken(tokenGuardado);
    mostrarPanel();
    cargarDashboard();
    cargarVentasReporte();
    cargarBanners();
    cargarVendedores();
    cargarClientesRecientes();
    cargarCelularesDisponibles();
  } else {
    mostrarLogin();
  }
});
