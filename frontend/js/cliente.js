import { api, ApiError, setToken, clearToken } from "./api.js";
import { formatoMoneda } from "./format.js";

const STORAGE_KEY = "crediapp_cliente_token";

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

function mostrarVista(nombre) {
  ["vista-login", "vista-panel"].forEach((id) => {
    el(id).classList.toggle("hidden", id !== nombre);
  });
}

async function manejarLlamada(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      cerrarSesion();
      mostrarError("Tu sesión expiró. Vuelve a ingresar con tu documento.");
    } else {
      mostrarError(error.message);
    }
    return null;
  }
}

// ---------- Autenticación: solo documento ----------

async function iniciarSesion() {
  limpiarError();
  const documento = el("login-documento").value.trim();
  if (!documento) {
    mostrarError("Ingresa tu número de documento.");
    return;
  }

  // No pasa por manejarLlamada: un 401 acá es "documento no registrado", no una
  // sesión expirada — mostrar ese mensaje real en vez del genérico de sesión.
  try {
    const respuesta = await api.post("/auth/cliente/login", { documento });
    localStorage.setItem(STORAGE_KEY, respuesta.access_token);
    setToken(respuesta.access_token);
    el("login-documento").value = "";
    mostrarVista("vista-panel");
    cargarMisCreditos();
  } catch (error) {
    mostrarError(error.message);
  }
}

function cerrarSesion() {
  clearToken();
  localStorage.removeItem(STORAGE_KEY);
  mostrarVista("vista-login");
}

// ---------- Banner público ----------

async function cargarBannerActivo() {
  try {
    const banners = await api.get("/banners/activos");
    if (banners.length > 0) {
      el("banner-activo-img").src = banners[0].url_imagen;
      el("banner-activo-img").alt = banners[0].titulo_campana;
      el("banner-activo").classList.remove("hidden");
    }
  } catch {
    // El banner es decorativo: si falla, simplemente no se muestra.
  }
}

// ---------- Panel de cuenta ----------

async function cargarMisCreditos() {
  const creditos = await manejarLlamada(() => api.get("/portal/mis-creditos"));
  if (!creditos) return;

  if (creditos.length === 0) {
    el("lista-creditos").innerHTML = '<p class="text-sm text-slate-500">No tienes créditos activos.</p>';
    return;
  }

  el("lista-creditos").innerHTML = creditos
    .map((credito) => {
      const proxima = credito.proxima_cuota;
      const estadoBadgeClase = credito.estado === "Activo" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent-dark";

      return `
        <div class="bg-white rounded-lg shadow p-5 space-y-3">
          <p class="font-semibold">Crédito #${credito.id} — <span class="px-2 py-0.5 rounded-full text-xs font-medium ${estadoBadgeClase}">${credito.estado}</span></p>
          <p class="text-sm text-slate-500">Progreso: ${credito.progreso_pagadas} de ${credito.progreso_total} cuotas pagadas</p>
          ${
            proxima
              ? `<div class="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm">
                   <p>Próxima cuota (#${proxima.numero_cuota}): <strong>$${formatoMoneda(Number(proxima.monto_capital) + Number(proxima.monto_interes))}</strong></p>
                   <p>Vence: ${proxima.fecha_vencimiento}</p>
                 </div>`
              : '<p class="text-sm text-accent-dark font-medium">Este crédito ya está totalmente pagado.</p>'
          }
          ${
            credito.estado === "Activo"
              ? `<button type="button" class="btn-cotizar px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-sm font-medium" data-credito="${credito.id}">Cotizar liquidación anticipada</button>
                 <div class="resultado-liquidacion text-sm" data-credito-resultado="${credito.id}"></div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

async function cotizarLiquidacion(creditoId) {
  const resultado = await manejarLlamada(() => api.get(`/portal/liquidacion-anticipada/${creditoId}`));
  const contenedor = document.querySelector(`[data-credito-resultado="${creditoId}"]`);
  if (!resultado || !contenedor) return;

  // Solo se muestra el total: sin desglose de capital/interés, para que el
  // cliente vea un número claro y directo, no un detalle técnico de cobranza.
  contenedor.innerHTML = `
    <div class="rounded-lg bg-accent/10 border border-accent/30 p-3 mt-2">
      <p class="font-semibold text-accent-dark">Monto total para cancelar tu deuda hoy: $${formatoMoneda(resultado.total_a_pagar)}</p>
    </div>
  `;
}

// ---------- Inicialización ----------

document.addEventListener("DOMContentLoaded", () => {
  el("btn-login").addEventListener("click", iniciarSesion);
  el("login-documento").addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") iniciarSesion();
  });
  el("btn-logout").addEventListener("click", cerrarSesion);

  el("lista-creditos").addEventListener("click", (evento) => {
    const boton = evento.target.closest(".btn-cotizar");
    if (!boton) return;
    cotizarLiquidacion(Number(boton.dataset.credito));
  });

  cargarBannerActivo();

  const tokenGuardado = localStorage.getItem(STORAGE_KEY);
  if (tokenGuardado) {
    setToken(tokenGuardado);
    mostrarVista("vista-panel");
    cargarMisCreditos();
  } else {
    mostrarVista("vista-login");
  }
});
