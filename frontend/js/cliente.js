import { api, ApiError, setToken, clearToken } from "./api.js";
import { formatoMoneda } from "./format.js";

const STORAGE_KEY = "crediapp_cliente_token";
const DOCUMENTO_KEY = "crediapp_cliente_documento";

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
  ["vista-solicitar", "vista-verificar", "vista-panel"].forEach((id) => {
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

// ---------- Autenticación OTP ----------

async function solicitarOtp() {
  limpiarError();
  const documento = el("solicitar-documento").value.trim();
  if (!documento) {
    mostrarError("Ingresa tu número de documento.");
    return;
  }

  const resultado = await manejarLlamada(async () => {
    await api.post("/auth/cliente/solicitar-otp", { documento });
    return true;
  });
  if (!resultado) return;

  localStorage.setItem(DOCUMENTO_KEY, documento);
  el("verificar-codigo").value = "";
  mostrarVista("vista-verificar");
}

async function verificarOtp() {
  limpiarError();
  const documento = localStorage.getItem(DOCUMENTO_KEY);
  const codigo = el("verificar-codigo").value.trim();
  if (!codigo || codigo.length !== 4) {
    mostrarError("Ingresa el código de 4 dígitos que recibiste por correo.");
    return;
  }

  // No pasa por manejarLlamada: un 401 acá es "código inválido", no una sesión
  // expirada — mostrar ese mensaje real en vez del genérico de sesión.
  try {
    const respuesta = await api.post("/auth/cliente/verificar-otp", { documento, codigo });
    localStorage.setItem(STORAGE_KEY, respuesta.access_token);
    setToken(respuesta.access_token);
    mostrarVista("vista-panel");
    cargarMisCreditos();
  } catch (error) {
    mostrarError(error.message);
  }
}

function cerrarSesion() {
  clearToken();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(DOCUMENTO_KEY);
  mostrarVista("vista-solicitar");
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
      return `
        <div class="bg-white rounded-2xl shadow p-5 space-y-3">
          <p class="font-semibold">Crédito #${credito.id} — ${credito.estado}</p>
          <p class="text-sm text-slate-500">Progreso: ${credito.progreso_pagadas} de ${credito.progreso_total} cuotas pagadas</p>
          ${
            proxima
              ? `<div class="rounded-lg bg-indigo-50 border border-indigo-100 p-3 text-sm">
                   <p>Próxima cuota (#${proxima.numero_cuota}): <strong>$${formatoMoneda(Number(proxima.monto_capital) + Number(proxima.monto_interes))}</strong></p>
                   <p>Vence: ${proxima.fecha_vencimiento}</p>
                 </div>`
              : '<p class="text-sm text-green-700 font-medium">Este crédito ya está totalmente pagado.</p>'
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

  contenedor.innerHTML = `
    <div class="rounded-lg bg-green-50 border border-green-200 p-3 mt-2">
      <p>Saldo de capital pendiente: $${formatoMoneda(resultado.saldo_capital_pendiente)}</p>
      <p>Interés del mes en curso: $${formatoMoneda(resultado.interes_mes_actual)}</p>
      <p class="font-semibold">Total a pagar hoy: $${formatoMoneda(resultado.total_a_pagar)}</p>
    </div>
  `;
}

// ---------- Inicialización ----------

document.addEventListener("DOMContentLoaded", () => {
  el("btn-solicitar-otp").addEventListener("click", solicitarOtp);
  el("btn-verificar-otp").addEventListener("click", verificarOtp);
  el("btn-reenviar-otp").addEventListener("click", solicitarOtp);
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
    mostrarVista("vista-solicitar");
  }
});
