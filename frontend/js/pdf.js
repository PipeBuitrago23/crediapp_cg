function formatoMoneda(valor) {
  return Number(valor).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generarPdfResumen(estado, resultado) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 15;
  const salto = (n = 8) => {
    y += n;
  };
  const esContado = resultado.tipo_venta === "Contado";

  doc.setFontSize(16);
  doc.text(
    esContado ? "Comprobante de Venta de Contado - CrediApp" : "Resumen de Compra a Crédito - CrediApp",
    15,
    y
  );
  salto(12);

  doc.setFontSize(11);
  doc.text(`Cliente: ${estado.cliente.nombre}`, 15, y);
  salto();
  doc.text(`Documento: ${estado.cliente.documento}`, 15, y);
  salto();
  doc.text(`Teléfono: ${estado.cliente.telefono}`, 15, y);
  salto();
  doc.text(`Email: ${estado.cliente.email}`, 15, y);
  salto(10);

  doc.text(`Equipo: ${estado.celularNuevo.marca} ${estado.celularNuevo.referencia}`, 15, y);
  salto();
  doc.text(`IMEI: ${estado.celularNuevo.imei}`, 15, y);
  salto();
  doc.text(`Valor de venta: $${formatoMoneda(estado.valorVenta)}`, 15, y);
  salto(10);

  if (esContado) {
    doc.text(`Abono efectivo: $${formatoMoneda(estado.abonoEfectivo)}`, 15, y);
    salto();
    doc.text(`Abono transferencia: $${formatoMoneda(estado.abonoTransferencia)}`, 15, y);
    salto();
    if (estado.celularRetoma) {
      doc.text(`Retoma: $${formatoMoneda(estado.celularRetoma.valor_costo)}`, 15, y);
      salto();
    }
    doc.text(`Total pagado: $${formatoMoneda(estado.valorVenta)}`, 15, y);
    salto(10);
    doc.text("Venta pagada en su totalidad al momento de la compra.", 15, y);
    doc.save(`comprobante-venta-${resultado.venta_id}.pdf`);
    return;
  }

  doc.text(`Monto financiado: $${formatoMoneda(resultado.monto_financiado)}`, 15, y);
  salto();
  doc.text(`Tasa de interés mensual: ${estado.tasaInteresMensual}%`, 15, y);
  salto();
  doc.text(`Cuota fija mensual: $${formatoMoneda(resultado.valor_cuota_fija)}`, 15, y);
  salto(12);

  doc.setFontSize(12);
  doc.text("Tabla de cuotas", 15, y);
  salto(8);

  doc.setFontSize(10);
  doc.text("Cuota", 15, y);
  doc.text("Vence", 40, y);
  doc.text("Capital", 80, y);
  doc.text("Interés", 120, y);
  doc.text("Total", 160, y);
  salto(6);

  resultado.cuotas.forEach((cuota) => {
    if (y > 280) {
      doc.addPage();
      y = 15;
    }
    const total = Number(cuota.monto_capital) + Number(cuota.monto_interes);
    doc.text(String(cuota.numero_cuota), 15, y);
    doc.text(cuota.fecha_vencimiento, 40, y);
    doc.text(formatoMoneda(cuota.monto_capital), 80, y);
    doc.text(formatoMoneda(cuota.monto_interes), 120, y);
    doc.text(formatoMoneda(total), 160, y);
    salto(6);
  });

  doc.save(`contrato-venta-${resultado.venta_id}.pdf`);
}
