import { IMEI_CHECK_URL } from "./config.js";

export async function copiarImeiYVerificar(imei) {
  if (!imei) return;

  try {
    await navigator.clipboard.writeText(imei);
  } catch (error) {
    console.warn("No se pudo copiar el IMEI al portapapeles", error);
  }

  window.open(IMEI_CHECK_URL, "_blank", "noopener,noreferrer");
}
