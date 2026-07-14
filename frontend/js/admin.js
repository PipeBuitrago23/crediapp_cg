import { api, ApiError, setToken, clearToken } from "./api.js";
import { formatoMoneda } from "./format.js";

const STORAGE_KEY = "crediapp_admin_token";

let ultimaBusqueda = null; // { tipo: "documento" | "imei", valor: string }

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

function mostrarLogin() {
  el("vista-login").classList.remove("hidden");
  el("vista-panel").classList.add("hidden");
}

function mostrarPanel() {
  el("vista-login").classList.add("hidden");
  el("vista-panel").classList.remove("hidden");
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
    cargarBanners();
    cargarVendedores();
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

  el("kpi-total-colocado").textContent = `$${formatoMoneda(metrics.monto_total_colocado)}`;
  el("kpi-pendiente-cobrar").textContent = `$${formatoMoneda(metrics.monto_pendiente_cobrar)}`;
  el("kpi-intereses").textContent = `$${formatoMoneda(metrics.intereses_generados_recaudados)}`;
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
    .map((credito) => {
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
                    ? `<button type="button" class="btn-pagar-cuota px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs" data-credito="${credito.id}" data-numero="${cuota.numero_cuota}">Marcar pagada</button>`
                    : ""
                }
              </td>
            </tr>
          `
        )
        .join("");

      return `
        <div class="rounded-lg border border-slate-200 p-4 space-y-2">
          <p class="font-semibold">${credito.cliente.nombre} (${credito.cliente.documento}) — ${credito.equipo.marca} ${credito.equipo.referencia}</p>
          <p class="text-sm text-slate-500">Crédito #${credito.id} — Estado: ${credito.estado} — Tasa: ${credito.tasa_interes_mensual}% — Vendido por: ${credito.vendedor ? credito.vendedor.nombre : "Sin asignar"}</p>
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

// ---------- Inicialización ----------

document.addEventListener("DOMContentLoaded", () => {
  el("btn-login").addEventListener("click", iniciarSesion);
  el("btn-logout").addEventListener("click", cerrarSesion);
  el("btn-buscar-documento").addEventListener("click", buscarPorDocumento);
  el("btn-buscar-imei").addEventListener("click", buscarPorImei);
  el("btn-crear-banner").addEventListener("click", crearBanner);
  el("btn-crear-vendedor").addEventListener("click", crearVendedor);

  el("lista-vendedores").addEventListener("click", (evento) => {
    const boton = evento.target.closest(".btn-toggle-vendedor");
    if (!boton) return;
    alternarVendedor(Number(boton.dataset.id), boton.dataset.activo === "true");
  });

  el("resultados-creditos").addEventListener("click", (evento) => {
    const boton = evento.target.closest(".btn-pagar-cuota");
    if (!boton) return;
    pagarCuota(Number(boton.dataset.credito), Number(boton.dataset.numero));
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
    cargarBanners();
    cargarVendedores();
  } else {
    mostrarLogin();
  }
});
