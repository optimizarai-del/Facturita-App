// Definición única de las columnas de la plantilla de facturación.
// Se usa tanto para generar el Excel modelo como para leer el que sube el usuario.

export const COLUMNS = [
  {
    key: 'nombre',
    header: 'Nombre / Razón social',
    width: 30,
    ejemplo: 'Juan Pérez SA',
    required: true,
  },
  {
    key: 'documento',
    header: 'CUIT / DNI',
    width: 18,
    ejemplo: '20304050607',
    required: true,
  },
  {
    key: 'tipo',
    header: 'Tipo (A/B/C)',
    width: 14,
    ejemplo: 'C',
    required: true,
  },
  {
    key: 'concepto',
    header: 'Concepto (Productos/Servicios/Ambos)',
    width: 34,
    ejemplo: 'Servicios',
    required: true,
  },
  {
    key: 'descripcion',
    header: 'Descripción',
    width: 40,
    ejemplo: 'Desarrollo de software - Julio 2026',
    required: false,
  },
  {
    key: 'importe',
    header: 'Importe total',
    width: 16,
    ejemplo: 121000,
    required: true,
  },
];

export const HEADER_ROW = COLUMNS.map((c) => c.header);
export const EXAMPLE_ROW = COLUMNS.map((c) => c.ejemplo);
