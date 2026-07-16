import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

const RESULT_COLUMNS = [
  { header: 'Fila', key: 'fila', width: 8 },
  { header: 'Nombre / Razón social', key: 'nombre', width: 28 },
  { header: 'CUIT / DNI', key: 'documento', width: 16 },
  { header: 'Tipo', key: 'tipo', width: 8 },
  { header: 'Importe', key: 'importe', width: 14 },
  { header: 'Estado', key: 'estadoTxt', width: 12 },
  { header: 'Comprobante', key: 'comprobante', width: 18 },
  { header: 'CAE', key: 'cae', width: 20 },
  { header: 'Vto CAE', key: 'caeVto', width: 14 },
  { header: 'Detalle / Error', key: 'detalle', width: 45 },
];

// Arma el workbook de resultados a partir del resultado de procesarFacturas.
export async function buildResultadosWorkbook(result) {
  const { resumen, resultados } = result;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FacturitaApp';
  wb.created = new Date();

  const ws = wb.addWorksheet('Resultados', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = RESULT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5A88' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 26;

  for (const r of resultados) {
    const ok = r.estado === 'ok';
    const row = ws.addRow({
      fila: r.fila,
      nombre: r.nombre || '',
      documento: r.documento || '',
      tipo: r.tipo || '',
      importe: Number(String(r.importe).replace(',', '.')) || r.importe,
      estadoTxt: ok ? 'REALIZADA' : 'PENDIENTE',
      comprobante: ok ? `${r.puntoVenta}-${String(r.nroComprobante).padStart(8, '0')}` : '',
      cae: ok ? r.cae : '',
      caeVto: ok ? r.caeVto : '',
      detalle: ok ? '' : r.error || '',
    });
    row.getCell('importe').numFmt = '#,##0.00';
    const color = ok ? 'FF1D7A3D' : 'FFC0362C';
    row.getCell('estadoTxt').font = { bold: true, color: { argb: color } };
  }

  // Hoja de resumen
  const res = wb.addWorksheet('Resumen');
  res.getColumn(1).width = 24;
  res.getColumn(2).width = 20;
  const filas = [
    ['Resumen de facturación', ''],
    ['Fecha', new Date().toLocaleString('es-AR')],
    ['Ambiente', resumen.ambiente],
    ['Total', resumen.total],
    ['Realizadas', resumen.realizadas],
    ['Pendientes', resumen.pendientes],
  ];
  filas.forEach((f, i) => {
    const row = res.getRow(i + 1);
    row.getCell(1).value = f[0];
    row.getCell(2).value = f[1];
    if (i === 0) row.getCell(1).font = { bold: true, size: 14 };
  });

  return wb;
}

// Sanitiza un timestamp para nombre de carpeta/archivo.
function stamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// Resuelve la carpeta de salida configurada (o ./salida por defecto).
function resolveBaseDir(settings) {
  const configured = String(settings?.carpetaSalida || '').trim();
  return configured ? path.resolve(configured) : path.join(ROOT, 'salida');
}

// Guarda el Excel de resultados en la carpeta de salida y devuelve las rutas.
export async function guardarResultados(result, settings) {
  const baseDir = resolveBaseDir(settings);
  const carpeta = path.join(baseDir, `facturas-${stamp()}`);
  await fs.mkdir(carpeta, { recursive: true });

  const wb = await buildResultadosWorkbook(result);
  const excelPath = path.join(carpeta, 'resultados.xlsx');
  await wb.xlsx.writeFile(excelPath);

  return { carpeta, excelPath };
}
