import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { getAfipClient } from './afip.js';

const LETRA = { 1: 'A', 6: 'B', 11: 'C' };
const NOMBRE_CBTE = { 1: 'FACTURA A', 6: 'FACTURA B', 11: 'FACTURA C' };
const DOC_LABEL = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI', 99: 'Consumidor Final' };

// yyyymmdd -> yyyy-mm-dd
function fechaISO(yyyymmdd) {
  const s = String(yyyymmdd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
function fechaLinda(yyyymmdd) {
  const s = String(yyyymmdd);
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
}
function money(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Genera el data URI del QR obligatorio de AFIP para un comprobante.
async function qrDataURI(r, cuitEmisor) {
  const payload = {
    ver: 1,
    fecha: fechaISO(r.fecha),
    cuit: Number(cuitEmisor),
    ptoVta: r.puntoVenta,
    tipoCmp: r.tipoCbte,
    nroCmp: r.nroComprobante,
    importe: Number(r.importeNum),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: r.docTipo,
    nroDocRec: r.docNro,
    tipoCodAut: 'E',
    codAut: Number(r.cae),
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const url = `https://www.afip.gob.ar/fe/qr/?p=${b64}`;
  return QRCode.toDataURL(url, { margin: 1, width: 180 });
}

// Arma el HTML del comprobante.
export async function buildFacturaHTML(r, settings) {
  const cuitEmisor = settings.cuit;
  const letra = LETRA[r.tipoCbte] || '';
  const qr = await qrDataURI(r, cuitEmisor);
  const nro = `${String(r.puntoVenta).padStart(4, '0')}-${String(r.nroComprobante).padStart(8, '0')}`;
  const docLabel = DOC_LABEL[r.docTipo] || 'Doc';
  const docVal = r.docTipo === 99 ? '—' : r.docNro;
  const mostrarIVA = r.tipoCbte !== 11 && Number(r.iva) > 0;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { font-family: Arial, sans-serif; box-sizing: border-box; }
    body { margin: 0; padding: 18px; color: #111; font-size: 12px; }
    .box { border: 1px solid #000; }
    .top { display: flex; align-items: stretch; }
    .emisor { flex: 1; padding: 12px 14px; }
    .comprobante { flex: 1; padding: 12px 14px; border-left: 1px solid #000; }
    .letra-col {
      flex: 0 0 64px; border-left: 1px solid #000; border-right: 1px solid #000;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 8px 4px;
    }
    .letra-col .letra { font-size: 34px; font-weight: bold; line-height: 1; }
    .letra-col .cod { font-size: 8px; color: #333; margin-top: 3px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 0 0 6px; }
    .muted { color: #444; }
    .linea { border-top: 1px solid #000; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
    th { background: #eee; }
    .totales { margin-top: 8px; width: 100%; }
    .totales td { border: none; padding: 2px 8px; text-align: right; }
    .totales .lbl { text-align: right; color: #444; }
    .total-final { font-size: 15px; font-weight: bold; }
    .cae { display: flex; align-items: center; gap: 14px; margin-top: 12px; }
    .cae img { width: 110px; height: 110px; }
    .cae .datos { font-size: 12px; }
  </style></head><body>
    <div class="box">
      <div class="top">
        <div class="emisor">
          <h1>${escapeHtml(settings.razonSocial) || `CUIT ${cuitEmisor}`}</h1>
          <div class="muted">CUIT: ${cuitEmisor}</div>
          <div class="muted">Punto de venta: ${String(r.puntoVenta).padStart(4, '0')}</div>
        </div>
        <div class="letra-col">
          <div class="letra">${letra}</div>
          <div class="cod">Cód. ${r.tipoCbte}</div>
        </div>
        <div class="comprobante">
          <h2>${NOMBRE_CBTE[r.tipoCbte] || 'COMPROBANTE'}</h2>
          <div><b>N°:</b> ${nro}</div>
          <div><b>Fecha:</b> ${fechaLinda(r.fecha)}</div>
        </div>
      </div>
      <div class="linea" style="padding:10px 14px;">
        <div><b>Cliente:</b> ${escapeHtml(r.nombre) || '—'}</div>
        <div><b>${docLabel}:</b> ${docVal}</div>
      </div>
    </div>

    <table>
      <thead><tr><th style="width:70%">Descripción</th><th style="text-align:right">Importe</th></tr></thead>
      <tbody>
        <tr>
          <td>${escapeHtml(r.descripcion) || 'Venta'}</td>
          <td style="text-align:right">$ ${money(r.importeNum)}</td>
        </tr>
      </tbody>
    </table>

    <table class="totales">
      ${mostrarIVA ? `
        <tr><td class="lbl">Neto gravado:</td><td>$ ${money(r.neto)}</td></tr>
        <tr><td class="lbl">IVA 21%:</td><td>$ ${money(r.iva)}</td></tr>` : ''}
      <tr><td class="lbl total-final">TOTAL:</td><td class="total-final">$ ${money(r.importeNum)}</td></tr>
    </table>

    <div class="cae">
      <img src="${qr}" alt="QR AFIP" />
      <div class="datos">
        <div><b>CAE N°:</b> ${r.cae}</div>
        <div><b>Vto CAE:</b> ${r.caeVto}</div>
        <div class="muted">Comprobante autorizado</div>
      </div>
    </div>
  </body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Descarga el PDF (por URL o base64) y lo escribe en disco.
async function descargarPDF(file, destino) {
  if (typeof file === 'string' && /^https?:\/\//.test(file)) {
    const resp = await fetch(file);
    if (!resp.ok) throw new Error(`No se pudo descargar el PDF (HTTP ${resp.status})`);
    const buf = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(destino, buf);
  } else if (typeof file === 'string') {
    // base64
    await fs.writeFile(destino, Buffer.from(file, 'base64'));
  } else {
    throw new Error('Formato de PDF no reconocido');
  }
}

// Genera un PDF por cada comprobante emitido con éxito y lo guarda en la carpeta.
// Devuelve { generados, errores }.
export async function generarPDFs(resultados, settings, carpeta) {
  const afip = await getAfipClient();
  const oks = resultados.filter((r) => r.estado === 'ok');

  let generados = 0;
  const errores = [];

  for (const r of oks) {
    try {
      const html = await buildFacturaHTML(r, settings);
      const nombre = `${LETRA[r.tipoCbte] || 'X'}-${String(r.puntoVenta).padStart(4, '0')}-${String(
        r.nroComprobante
      ).padStart(8, '0')}`;
      // eslint-disable-next-line no-await-in-loop
      const { file } = await afip.ElectronicBilling.createPDF({
        html,
        file_name: nombre,
        options: { width: 8, marginLeft: 0.4, marginRight: 0.4, marginTop: 0.4, marginBottom: 0.4 },
      });
      // eslint-disable-next-line no-await-in-loop
      await descargarPDF(file, path.join(carpeta, `${nombre}.pdf`));
      generados += 1;
    } catch (e) {
      errores.push({ fila: r.fila, error: e?.message || 'Error al generar PDF' });
    }
  }

  return { generados, errores };
}
