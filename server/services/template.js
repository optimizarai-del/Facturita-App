import ExcelJS from 'exceljs';
import { COLUMNS } from '../config/columns.js';

// Genera el workbook modelo con encabezados, una fila de ejemplo y una hoja de ayuda.
export async function buildTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FacturitaApp';
  wb.created = new Date();

  const ws = wb.addWorksheet('Facturas', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
  }));

  // Estilo del encabezado
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2E5A88' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.height = 28;

  // Fila de ejemplo
  const exampleObj = {};
  for (const c of COLUMNS) exampleObj[c.key] = c.ejemplo;
  const exRow = ws.addRow(exampleObj);
  exRow.font = { italic: true, color: { argb: 'FF888888' } };
  exRow.getCell('importe').numFmt = '#,##0.00';

  // Hoja de instrucciones
  const help = wb.addWorksheet('Instrucciones');
  help.getColumn(1).width = 100;
  const lines = [
    'FacturitaApp — Plantilla de facturación AFIP',
    '',
    'Cómo completar:',
    '• Borrá la fila de ejemplo (fila 2) y cargá una fila por cada factura a emitir.',
    '• Nombre / Razón social: nombre del cliente.',
    '• CUIT / DNI: solo números, sin guiones ni puntos.',
    '• Tipo: A, B o C según el comprobante.',
    '• Concepto: Productos, Servicios o Ambos.',
    '• Descripción: qué se factura (texto libre).',
    '• Importe total: monto final con IVA incluido (para Factura C es el total sin IVA).',
    '',
    'No cambies los nombres de las columnas ni el orden.',
  ];
  lines.forEach((t, i) => {
    const cell = help.getCell(`A${i + 1}`);
    cell.value = t;
    if (i === 0) cell.font = { bold: true, size: 14 };
  });

  return wb;
}
