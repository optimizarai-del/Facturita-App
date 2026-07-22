import { getAfipClient } from './afip.js';

// --- Tablas de mapeo AFIP ---
const TIPO_CBTE = { A: 1, B: 6, C: 11 }; // Factura A / B / C
const CONCEPTO = { productos: 1, servicios: 2, ambos: 3 };
const IVA_21_ID = 5; // Id de alícuota 21% en AFIP
// Umbral aproximado por el cual AFIP exige identificar al receptor (cambia periódicamente).
const UMBRAL_IDENTIFICAR = 344000;

// Valida las filas SIN emitir. Devuelve { total, cantidad, problemas: [{fila, motivo, nivel}] }.
export function validarFilas(rows) {
  const problemas = [];
  let total = 0;
  for (const row of rows) {
    const importe = Number(String(row.importe ?? '').toString().replace(',', '.'));
    if (Number.isFinite(importe) && importe > 0) total += importe;
    try {
      buildVoucherData(row, { puntoVenta: 1 }); // valida tipo/concepto/importe/doc
    } catch (e) {
      problemas.push({ fila: row.fila, motivo: e.message, nivel: 'error' });
      continue;
    }
    // Advertencia: importe alto sin documento (Consumidor Final).
    const doc = String(row.documento ?? '').replace(/\D/g, '');
    if (!doc && importe >= UMBRAL_IDENTIFICAR) {
      problemas.push({
        fila: row.fila,
        motivo: `Importe alto ($${importe.toLocaleString('es-AR')}) sin documento: AFIP puede exigir identificar al cliente.`,
        nivel: 'aviso',
      });
    }
  }
  return {
    cantidad: rows.length,
    total: Math.round(total * 100) / 100,
    conError: problemas.filter((p) => p.nivel === 'error').length,
    problemas,
  };
}

// Tipo de documento del receptor según lo ingresado.
function mapDocumento(docRaw) {
  const doc = String(docRaw ?? '').replace(/\D/g, '');
  if (!doc) return { DocTipo: 99, DocNro: 0 }; // Consumidor Final
  if (doc.length === 11) return { DocTipo: 80, DocNro: Number(doc) }; // CUIT
  return { DocTipo: 96, DocNro: Number(doc) }; // DNI
}

// Condición IVA del receptor (RG 5616, requerido). Heurística por tipo de doc.
function condicionIVAReceptor(docTipo) {
  if (docTipo === 80) return 1; // CUIT -> Responsable Inscripto (asunción)
  return 5; // DNI / Consumidor Final
}

function yyyymmdd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return Number(`${y}${m}${d}`);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Valida y arma el objeto de comprobante para afip.js. Lanza Error con mensaje claro.
export function buildVoucherData(row, settings) {
  const tipoLetra = String(row.tipo ?? '').trim().toUpperCase();
  const CbteTipo = TIPO_CBTE[tipoLetra];
  if (!CbteTipo) {
    throw new Error(`Tipo de factura inválido: "${row.tipo}" (debe ser A, B o C)`);
  }

  const conceptoKey = String(row.concepto ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const Concepto = CONCEPTO[conceptoKey];
  if (!Concepto) {
    throw new Error(`Concepto inválido: "${row.concepto}" (Productos, Servicios o Ambos)`);
  }

  const importe = round2(Number(String(row.importe ?? '').toString().replace(',', '.')));
  if (!importe || importe <= 0 || Number.isNaN(importe)) {
    throw new Error(`Importe inválido: "${row.importe}"`);
  }

  const { DocTipo, DocNro } = mapDocumento(row.documento);

  const hoy = yyyymmdd();
  // Fecha del comprobante: la de la fila si vino, si no hoy.
  const fechaCbte = row.fechaEmision || hoy;
  const data = {
    CantReg: 1,
    PtoVta: Number(settings.puntoVenta) || 1,
    CbteTipo,
    Concepto,
    DocTipo,
    DocNro,
    CbteFch: fechaCbte,
    ImpTotal: importe,
    ImpTotConc: 0, // neto no gravado
    ImpOpEx: 0, // exento
    ImpTrib: 0, // otros tributos
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: condicionIVAReceptor(DocTipo),
  };

  if (CbteTipo === TIPO_CBTE.C) {
    // Factura C (monotributo/exento): sin desglose de IVA.
    data.ImpNeto = importe;
    data.ImpIVA = 0;
  } else {
    // Factura A/B: se asume IVA 21% incluido en el total.
    const neto = round2(importe / 1.21);
    const iva = round2(importe - neto);
    data.ImpNeto = neto;
    data.ImpIVA = iva;
    data.Iva = [{ Id: IVA_21_ID, BaseImp: neto, Importe: iva }];
  }

  // Para servicios (o ambos) AFIP exige fechas del período de servicio.
  // Se usan las de la fila si vinieron; si no, la fecha del comprobante.
  if (Concepto === CONCEPTO.servicios || Concepto === CONCEPTO.ambos) {
    data.FchServDesde = row.fechaServicioDesde || fechaCbte;
    data.FchServHasta = row.fechaServicioHasta || fechaCbte;
    data.FchVtoPago = row.fechaVencimiento || fechaCbte;
  }

  return data;
}

// Emite una factura y devuelve el resultado normalizado de esa fila.
async function emitirUna(afip, row, settings) {
  const base = {
    fila: row.fila,
    nombre: row.nombre,
    documento: row.documento,
    tipo: row.tipo,
    importe: row.importe,
  };
  try {
    const data = buildVoucherData(row, settings);
    // createNextVoucher toma el último número emitido y suma 1 automáticamente.
    const res = await afip.ElectronicBilling.createNextVoucher(data);
    return {
      ...base,
      estado: 'ok',
      cae: res.CAE,
      caeVto: res.CAEFchVto,
      nroComprobante: res.voucherNumber,
      puntoVenta: data.PtoVta,
      tipoCbte: data.CbteTipo,
      // Datos extra para el PDF y el QR de AFIP:
      fecha: data.CbteFch, // yyyymmdd
      docTipo: data.DocTipo,
      docNro: data.DocNro,
      importeNum: data.ImpTotal,
      neto: data.ImpNeto,
      iva: data.ImpIVA,
      concepto: data.Concepto,
      descripcion: row.descripcion || '',
      // Fechas (yyyymmdd) para persistir en Supabase.
      fechaServicioDesde: data.FchServDesde || null,
      fechaServicioHasta: data.FchServHasta || null,
      fechaVencimiento: data.FchVtoPago || null,
    };
  } catch (err) {
    return {
      ...base,
      estado: 'error',
      error: limpiarError(err),
    };
  }
}

// AFIP devuelve errores anidados; extraemos un mensaje legible.
function limpiarError(err) {
  const d = err?.data;
  // Errores de validación del SDK: { data_errors: { campo: mensaje } }
  if (d?.data_errors && typeof d.data_errors === 'object') {
    return Object.values(d.data_errors).join(' · ');
  }
  // Errores de negocio de AFIP: { data_errors: [...] } o message
  if (Array.isArray(d?.errors)) return d.errors.map((e) => e.msg || e.Msg || e).join(' · ');
  if (d?.message) return d.message;
  if (typeof err?.message === 'string') {
    const m = err.message.match(/"Msg"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
    return err.message;
  }
  return 'Error desconocido al emitir';
}

// Procesa todas las filas en orden (secuencial: la numeración de comprobantes lo requiere).
export async function procesarFacturas(rows, settings) {
  const afip = getAfipClient(settings);

  const resultados = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    resultados.push(await emitirUna(afip, row, settings));
  }

  const realizadas = resultados.filter((r) => r.estado === 'ok');
  const pendientes = resultados.filter((r) => r.estado === 'error');

  return {
    resumen: {
      total: resultados.length,
      realizadas: realizadas.length,
      pendientes: pendientes.length,
      ambiente: settings.production ? 'producción' : 'homologación',
    },
    resultados,
  };
}
