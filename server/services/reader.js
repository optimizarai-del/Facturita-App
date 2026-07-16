import ExcelJS from 'exceljs';
import { COLUMNS, HEADER_ROW } from '../config/columns.js';

// Lee un buffer .xlsx y devuelve las filas mapeadas a las claves de COLUMNS.
// Cada fila: { fila: <nro de fila en el Excel>, nombre, documento, tipo, concepto, descripcion, importe }
export async function readFacturasFromBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet('Facturas') || wb.worksheets[0];
  if (!ws) throw new Error('El Excel no tiene ninguna hoja.');

  // Mapear encabezados reales -> índice de columna, para tolerar reordenamientos.
  const headerRow = ws.getRow(1);
  const headerToKey = new Map();
  COLUMNS.forEach((c) => headerToKey.set(normalize(c.header), c.key));

  const colIndexByKey = {};
  headerRow.eachCell((cell, colNumber) => {
    const key = headerToKey.get(normalize(String(cell.value ?? '')));
    if (key) colIndexByKey[key] = colNumber;
  });

  // Validar que estén todas las columnas requeridas.
  const faltantes = COLUMNS.filter((c) => c.required && !colIndexByKey[c.key]);
  if (faltantes.length) {
    throw new Error(
      `Faltan columnas en el Excel: ${faltantes.map((c) => c.header).join(', ')}. ` +
        `Usá la plantilla descargable sin cambiar los encabezados.`
    );
  }

  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // encabezado

    const obj = { fila: rowNumber };
    for (const c of COLUMNS) {
      const idx = colIndexByKey[c.key];
      obj[c.key] = idx ? cellText(row.getCell(idx)) : '';
    }

    // Saltar filas totalmente vacías.
    const vacia = COLUMNS.every((c) => !String(obj[c.key] ?? '').trim());
    if (vacia) return;

    rows.push(obj);
  });

  return rows;
}

function normalize(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // sin acentos
}

// Extrae texto/numero de una celda de forma robusta (maneja richText, formulas, etc.)
function cellText(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result; // fórmula
    if (v.text !== undefined) return v.text; // hyperlink / richText
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  }
  return v;
}

export { HEADER_ROW };
