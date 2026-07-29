import { api, ApiError, setToken, clearToken } from "./api.js";
import { copiarImeiYVerificar } from "./imei.js";
import { generarPdfResumen } from "./pdf.js";

const STORAGE_KEY = "crediapp_vendedor_token";
const TOTAL_PASOS = 4;

const estado = {
  paso: 1,
  tipoVenta: "Credito",
  cliente: null,
  celularNuevo: null,
  valorVenta: null,
  celularRetoma: null,
  tasaInteresMensual: null,
  cuotasTotales: null,
  diaPago: null,
  abonoEfectivo: 0,
  abonoTransferencia: 0,
  resultado: null,
};

const el = (id) => document.getElementById(id);

function formatoMoneda(valor) {
  return Number(valor).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
  el("vista-wizard").classList.add("hidden");
}

function mostrarWizard() {
  el("vista-login").classList.add("hidden");
  el("vista-wizard").classList.remove("hidden");
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
    const respuesta = await api.post("/auth/vendedor/login", { email, password });
    localStorage.setItem(STORAGE_KEY, respuesta.access_token);
    setToken(respuesta.access_token);
    mostrarWizard();
    mostrarPaso(1);
  } catch (error) {
    mostrarError(error.message);
  }
}

function cerrarSesion() {
  clearToken();
  localStorage.removeItem(STORAGE_KEY);
  mostrarLogin();
}

function mostrarPaso(numero) {
  document.querySelectorAll("[data-step]").forEach((seccion) => {
    seccion.classList.toggle("hidden", Number(seccion.dataset.step) !== numero);
  });
  document.querySelectorAll("[data-step-indicator]").forEach((item) => {
    const activo = Number(item.dataset.stepIndicator) === numero;
    item.classList.toggle("text-primary", activo);
    item.classList.toggle("font-bold", activo);
    item.classList.toggle("text-slate-400", !activo);
  });

  if (numero === 4) {
    const esContado = estado.tipoVenta === "Contado";
    el("paso4-credito-form").classList.toggle("hidden", esContado);
    el("paso4-contado-resumen").classList.toggle("hidden", !esContado);
    el("paso4-titulo").textContent = esContado ? "Resumen de Pago" : "Proyección del Crédito";
    if (esContado && !estado.resultado) {
      actualizarResumenContado();
    }
  }

  el("btn-atras").disabled = numero === 1;
  const esUltimoPaso = numero === TOTAL_PASOS;
  el("btn-siguiente").textContent = esUltimoPaso
    ? estado.tipoVenta === "Contado"
      ? "Finalizar Venta"
      : "Generar Crédito"
    : "Siguiente";
  el("btn-siguiente").classList.toggle("hidden", esUltimoPaso && Boolean(estado.resultado));
  // El último paso finaliza la venta — usa el verde de acento en vez del azul primario de navegación.
  el("btn-siguiente").classList.toggle("bg-primary", !esUltimoPaso);
  el("btn-siguiente").classList.toggle("hover:bg-primary-dark", !esUltimoPaso);
  el("btn-siguiente").classList.toggle("bg-accent", esUltimoPaso);
  el("btn-siguiente").classList.toggle("hover:bg-accent-dark", esUltimoPaso);

  limpiarError();
}

// ---------- Tipo de Venta ----------

function marcarBotonTipoVenta(boton, activo) {
  boton.classList.toggle("border-primary", activo);
  boton.classList.toggle("bg-primary", activo);
  boton.classList.toggle("text-white", activo);
  boton.classList.toggle("border-slate-300", !activo);
  boton.classList.toggle("bg-white", !activo);
  boton.classList.toggle("text-slate-600", !activo);
}

function seleccionarTipoVenta(tipo) {
  estado.tipoVenta = tipo;
  marcarBotonTipoVenta(el("btn-tipo-credito"), tipo === "Credito");
  marcarBotonTipoVenta(el("btn-tipo-contado"), tipo === "Contado");
  el("step-indicador-4").textContent = tipo === "Contado" ? "4. Resumen" : "4. Crédito";
  el("preview-label").textContent = tipo === "Contado" ? "Saldo pendiente" : "Monto a financiar (estimado)";
  actualizarPreviewMonto();
}

// ---------- Paso 1: Cliente ----------

async function buscarCliente() {
  const documento = el("cliente-documento").value.trim();
  if (!documento) {
    mostrarError("Ingresa un número de documento para buscar.");
    return;
  }
  limpiarError();

  const resultados = await manejarLlamada(() => api.get(`/clientes?documento=${encodeURIComponent(documento)}`));
  if (!resultados) return;

  if (resultados.length > 0) {
    const cliente = resultados[0];
    estado.cliente = cliente;
    el("cliente-nombre").value = cliente.nombre;
    el("cliente-telefono").value = cliente.telefono;
    el("cliente-email").value = cliente.email;
    el("cliente-estado").textContent = "Cliente encontrado en el sistema.";
  } else {
    estado.cliente = null;
    el("cliente-estado").textContent = "No existe todavía: se creará un cliente nuevo con estos datos.";
  }
}

async function resolverCliente() {
  const documento = el("cliente-documento").value.trim();
  const nombre = el("cliente-nombre").value.trim();
  const telefono = el("cliente-telefono").value.trim();
  const email = el("cliente-email").value.trim();

  if (!documento || !nombre || !telefono || !email) {
    mostrarError("Completa todos los datos del cliente.");
    return false;
  }

  if (estado.cliente && estado.cliente.documento === documento) {
    return true;
  }

  const cliente = await manejarLlamada(() => api.post("/clientes", { nombre, documento, telefono, email }));
  if (!cliente) return false;

  estado.cliente = cliente;
  return true;
}

// ---------- Paso 2: Equipo Nuevo ----------

async function cargarInventarioDisponible() {
  const disponibles = await manejarLlamada(() => api.get("/celulares?estado=Disponible"));
  if (!disponibles) return;

  const select = el("equipo-select");
  select.innerHTML = '<option value="">-- Selecciona un equipo disponible --</option>';
  disponibles.forEach((celular) => {
    const opcion = document.createElement("option");
    opcion.value = celular.id;
    opcion.textContent = `${celular.marca} ${celular.referencia} - IMEI ${celular.imei}`;
    opcion.dataset.celular = JSON.stringify(celular);
    select.appendChild(opcion);
  });
}

function seleccionarEquipoNuevo() {
  const select = el("equipo-select");
  const opcion = select.selectedOptions[0];
  if (!opcion || !opcion.value) {
    estado.celularNuevo = null;
    el("equipo-detalle").classList.add("hidden");
    return;
  }
  const celular = JSON.parse(opcion.dataset.celular);
  estado.celularNuevo = celular;
  el("equipo-detalle-imei").textContent = celular.imei;
  el("equipo-detalle-costo").textContent = formatoMoneda(celular.valor_costo);
  el("equipo-detalle-comercial").textContent =
    celular.valor_comercial != null ? formatoMoneda(celular.valor_comercial) : "Sin definir";
  el("equipo-detalle").classList.remove("hidden");
  if (!el("equipo-valor-venta").value && celular.valor_comercial != null) {
    el("equipo-valor-venta").value = celular.valor_comercial;
  }
  actualizarPreviewMonto();
}

function agregarCelularAlSelect(celular) {
  const select = el("equipo-select");
  const opcion = document.createElement("option");
  opcion.value = celular.id;
  opcion.textContent = `${celular.marca} ${celular.referencia} - IMEI ${celular.imei}`;
  opcion.dataset.celular = JSON.stringify(celular);
  select.appendChild(opcion);
  select.value = celular.id;
  seleccionarEquipoNuevo();
}

function mostrarErrorModalCelular(mensaje) {
  const caja = el("modal-celular-error");
  caja.textContent = mensaje;
  caja.classList.remove("hidden");
}

function limpiarErrorModalCelular() {
  const caja = el("modal-celular-error");
  caja.textContent = "";
  caja.classList.add("hidden");
}

function abrirModalCelular() {
  limpiarErrorModalCelular();
  ["modal-celular-marca", "modal-celular-referencia", "modal-celular-imei", "modal-celular-costo", "modal-celular-comercial"].forEach(
    (id) => (el(id).value = "")
  );
  el("modal-celular-nuevo").classList.remove("hidden");
}

function cerrarModalCelular() {
  el("modal-celular-nuevo").classList.add("hidden");
}

async function guardarCelularNuevo() {
  limpiarErrorModalCelular();
  const marca = el("modal-celular-marca").value.trim();
  const referencia = el("modal-celular-referencia").value.trim();
  const imei = el("modal-celular-imei").value.trim();
  const valorCosto = Number(el("modal-celular-costo").value);
  const valorComercial = Number(el("modal-celular-comercial").value);

  if (!marca || !referencia || !imei || !valorCosto || !valorComercial) {
    mostrarErrorModalCelular("Completa todos los campos del celular.");
    return;
  }

  try {
    const celular = await api.post("/celulares", {
      marca,
      referencia,
      imei,
      valor_costo: valorCosto,
      valor_comercial: valorComercial,
    });
    agregarCelularAlSelect(celular);
    cerrarModalCelular();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // Sesión expirada: cerrar el modal también, o el login quedaría tapado detrás.
      cerrarModalCelular();
      cerrarSesion();
      mostrarError("Tu sesión expiró. Vuelve a iniciar sesión.");
    } else {
      mostrarErrorModalCelular(error.message);
    }
  }
}

function validarPaso2() {
  if (!estado.celularNuevo) {
    mostrarError("Selecciona el equipo nuevo del inventario.");
    return false;
  }
  const valorVenta = Number(el("equipo-valor-venta").value);
  if (!valorVenta || valorVenta <= 0) {
    mostrarError("Ingresa un valor de venta válido.");
    return false;
  }
  estado.valorVenta = valorVenta;
  return true;
}

// ---------- Paso 3: Liquidación ----------

function actualizarPreviewMonto() {
  const valorVenta = Number(el("equipo-valor-venta").value || 0);
  const abonoEfectivo = Number(el("abono-efectivo").value || 0);
  const abonoTransferencia = Number(el("abono-transferencia").value || 0);
  const valorRetoma = el("switch-retoma").checked ? Number(el("retoma-valor-costo").value || 0) : 0;
  const monto = valorVenta - abonoEfectivo - abonoTransferencia - valorRetoma;
  const elemento = el("monto-financiar-preview");

  if (estado.tipoVenta === "Contado") {
    elemento.textContent = `$${formatoMoneda(monto)}`;
    elemento.classList.toggle("text-accent-dark", monto === 0);
    elemento.classList.toggle("text-red-600", monto !== 0);
  } else {
    elemento.textContent = `$${formatoMoneda(Math.max(monto, 0))}`;
    elemento.classList.remove("text-accent-dark", "text-red-600");
  }
}

function actualizarResumenContado() {
  const abonoEfectivo = Number(el("abono-efectivo").value || 0);
  const abonoTransferencia = Number(el("abono-transferencia").value || 0);
  const tieneRetoma = el("switch-retoma").checked;
  const valorRetoma = tieneRetoma ? Number(el("retoma-valor-costo").value || 0) : 0;

  el("contado-resumen-valor").textContent = formatoMoneda(estado.valorVenta);
  el("contado-resumen-efectivo").textContent = formatoMoneda(abonoEfectivo);
  el("contado-resumen-transferencia").textContent = formatoMoneda(abonoTransferencia);
  el("contado-resumen-retoma-linea").classList.toggle("hidden", !tieneRetoma);
  el("contado-resumen-retoma").textContent = formatoMoneda(valorRetoma);
  el("contado-resumen-total").textContent = formatoMoneda(abonoEfectivo + abonoTransferencia + valorRetoma);
}

function alternarRetoma() {
  const activo = el("switch-retoma").checked;
  el("retoma-form").classList.toggle("hidden", !activo);
  actualizarPreviewMonto();
}

async function resolverRetoma() {
  if (!el("switch-retoma").checked) {
    estado.celularRetoma = null;
    return true;
  }

  if (estado.celularRetoma) {
    return true;
  }

  const marca = el("retoma-marca").value.trim();
  const referencia = el("retoma-referencia").value.trim();
  const imei = el("retoma-imei").value.trim();
  const valorCosto = Number(el("retoma-valor-costo").value);

  if (!marca || !referencia || !imei || !valorCosto) {
    mostrarError("Completa todos los datos del equipo en retoma.");
    return false;
  }

  const celular = await manejarLlamada(() =>
    api.post("/celulares", {
      marca,
      referencia,
      imei,
      valor_costo: valorCosto,
    })
  );
  if (!celular) return false;

  estado.celularRetoma = celular;
  return true;
}

// ---------- Paso 4: Crédito ----------

function validarPaso4() {
  const tasaRaw = el("credito-tasa").value;
  const tasa = Number(tasaRaw);
  const cuotas = Number(el("credito-cuotas").value);
  const diaPago = Number(el("credito-dia-pago").value);

  if (tasaRaw === "" || Number.isNaN(tasa) || tasa < 0) {
    mostrarError("Ingresa una tasa de interés mensual válida.");
    return false;
  }
  if (!cuotas || cuotas < 1) {
    mostrarError("Ingresa un número de cuotas válido.");
    return false;
  }
  estado.tasaInteresMensual = tasa;
  estado.cuotasTotales = cuotas;
  estado.diaPago = diaPago;
  return true;
}

async function enviarVenta() {
  estado.abonoEfectivo = Number(el("abono-efectivo").value || 0);
  estado.abonoTransferencia = Number(el("abono-transferencia").value || 0);

  const payload = {
    cliente_id: estado.cliente.id,
    celular_nuevo_id: estado.celularNuevo.id,
    tipo_venta: estado.tipoVenta,
    valor_venta: estado.valorVenta,
    valor_abono_efectivo: estado.abonoEfectivo,
    valor_abono_transferencia: estado.abonoTransferencia,
    valor_retoma_id: estado.celularRetoma ? estado.celularRetoma.id : null,
  };

  if (estado.tipoVenta === "Credito") {
    payload.tasa_interes_mensual = estado.tasaInteresMensual;
    payload.cuotas_totales = estado.cuotasTotales;
    payload.dia_pago = estado.diaPago;
  }

  const resultado = await manejarLlamada(() => api.post("/ventas", payload));
  if (!resultado) return;

  estado.resultado = resultado;
  renderizarResultado(resultado);
}

function renderizarResultado(resultado) {
  const esContado = resultado.tipo_venta === "Contado";

  el("resultado-titulo").textContent = esContado
    ? "Venta de contado registrada exitosamente"
    : "Crédito generado exitosamente";
  el("resultado-linea-financiado").classList.toggle("hidden", esContado);
  el("resultado-linea-cuota").classList.toggle("hidden", esContado);
  el("resultado-linea-total").classList.toggle("hidden", !esContado);
  el("resultado-tabla-wrapper").classList.toggle("hidden", esContado);

  if (esContado) {
    el("resultado-total-pagado").textContent = formatoMoneda(estado.valorVenta);
  } else {
    el("resultado-monto-financiado").textContent = formatoMoneda(resultado.monto_financiado);
    el("resultado-cuota-fija").textContent = formatoMoneda(resultado.valor_cuota_fija);
    el("tabla-cuotas").innerHTML = resultado.cuotas
      .map(
        (cuota) => `
          <tr class="border-b border-slate-100">
            <td class="p-2">${cuota.numero_cuota}</td>
            <td class="p-2">${cuota.fecha_vencimiento}</td>
            <td class="p-2">$${formatoMoneda(cuota.monto_capital)}</td>
            <td class="p-2">$${formatoMoneda(cuota.monto_interes)}</td>
            <td class="p-2">$${formatoMoneda(Number(cuota.monto_capital) + Number(cuota.monto_interes))}</td>
          </tr>
        `
      )
      .join("");
  }

  el("resultado-venta").classList.remove("hidden");
  el("btn-siguiente").classList.add("hidden");
  el("btn-atras").disabled = true;
}

// ---------- Navegación ----------

async function avanzarPaso() {
  limpiarError();

  if (estado.paso === 1) {
    if (!(await resolverCliente())) return;
  } else if (estado.paso === 2) {
    if (!validarPaso2()) return;
  } else if (estado.paso === 3) {
    if (!(await resolverRetoma())) return;
  } else if (estado.paso === 4) {
    if (estado.tipoVenta === "Credito" && !validarPaso4()) return;
    await enviarVenta();
    return;
  }

  estado.paso += 1;
  mostrarPaso(estado.paso);
  if (estado.paso === 2) {
    cargarInventarioDisponible();
  }
}

function retrocederPaso() {
  if (estado.paso === 1) return;
  estado.paso -= 1;
  mostrarPaso(estado.paso);
}

function reiniciar() {
  Object.assign(estado, {
    paso: 1,
    tipoVenta: "Credito",
    cliente: null,
    celularNuevo: null,
    valorVenta: null,
    celularRetoma: null,
    tasaInteresMensual: null,
    cuotasTotales: null,
    diaPago: null,
    abonoEfectivo: 0,
    abonoTransferencia: 0,
    resultado: null,
  });

  document.querySelectorAll("input").forEach((input) => {
    if (input.type === "checkbox") input.checked = false;
    else input.value = "";
  });
  el("abono-efectivo").value = 0;
  el("abono-transferencia").value = 0;
  el("cliente-estado").textContent = "";
  el("equipo-detalle").classList.add("hidden");
  el("retoma-form").classList.add("hidden");
  el("resultado-venta").classList.add("hidden");
  el("btn-siguiente").classList.remove("hidden");

  seleccionarTipoVenta("Credito");
  mostrarPaso(1);
}

// ---------- Inicialización ----------

document.addEventListener("DOMContentLoaded", () => {
  seleccionarTipoVenta("Credito");

  el("btn-login").addEventListener("click", iniciarSesion);
  el("btn-logout").addEventListener("click", cerrarSesion);
  el("btn-tipo-credito").addEventListener("click", () => seleccionarTipoVenta("Credito"));
  el("btn-tipo-contado").addEventListener("click", () => seleccionarTipoVenta("Contado"));
  el("btn-buscar-cliente").addEventListener("click", buscarCliente);
  el("equipo-select").addEventListener("change", seleccionarEquipoNuevo);
  el("btn-abrir-modal-celular").addEventListener("click", abrirModalCelular);
  el("btn-cancelar-modal-celular").addEventListener("click", cerrarModalCelular);
  el("btn-guardar-modal-celular").addEventListener("click", guardarCelularNuevo);
  el("btn-verificar-imei").addEventListener("click", () => {
    if (estado.celularNuevo) copiarImeiYVerificar(estado.celularNuevo.imei);
  });
  el("btn-verificar-imei-retoma").addEventListener("click", () =>
    copiarImeiYVerificar(el("retoma-imei").value.trim())
  );
  el("switch-retoma").addEventListener("change", alternarRetoma);
  el("btn-atras").addEventListener("click", retrocederPaso);
  el("btn-siguiente").addEventListener("click", avanzarPaso);
  el("btn-descargar-pdf").addEventListener("click", () => generarPdfResumen(estado, estado.resultado));
  el("btn-nueva-venta").addEventListener("click", reiniciar);

  ["equipo-valor-venta", "abono-efectivo", "abono-transferencia", "retoma-valor-costo"].forEach((id) => {
    el(id).addEventListener("input", actualizarPreviewMonto);
  });

  const tokenGuardado = localStorage.getItem(STORAGE_KEY);
  if (tokenGuardado) {
    setToken(tokenGuardado);
    mostrarWizard();
    mostrarPaso(1);
  } else {
    mostrarLogin();
  }
});
