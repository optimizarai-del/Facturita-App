import { getAfipClient } from './afip.js';

// --- Tablas de mapeo AFIP ---
const TIPO_CBTE = { A: 1, B: 6, C: 11 }; // Factura A / B / C
const CONCEPTO = { productos: 1, servicios: 2, ambos: 3 };

// Alícuotas de IVA soportadas: % -> Id de AFIP (tabla FEParamGetTiposIva).
const ALICUOTA_IVA_ID = { 0: 3, 10.5: 4, 21: 5, 27: 6, 5: 8, 2.5: 9 };
const IVA_21_ID = 5;

// Condición IVA del receptor (RG 5616) por texto -> Id de AFIP.
const CONDICION_ID = {
  'responsable inscripto': 1,
  'iva sujeto exento': 4,
  'exento': 4,
  'consumidor final': 5,
  'responsable monotributo': 6,
  'monotributo': 6,
};

// Umbral aproximado por el cual AFIP exige identificar al receptor (cambia periódicamente).
// Configurable por env porque AFIP lo actualiza.
const UMBRAL_IDENTIFICAR = Number(process.env.UMBRAL_IDENTIFICAR) || 344000;

// Parsea la alícuota de IVA de la fila. Devuelve { rate, id } o lanza si es inválida.
// Vacío = 21% (default histórico). "exento"/"0" = 0%.
function parseAlicuota(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === '') return { rate: 21, id: ALICUOTA_IVA_ID[21] };
  if (s === 'exento' || s === 'exenta') return { rate: 0, id: ALICUOTA_IVA_ID[0], exento: true };
  const n = Number(s.replace('%', '').replace(',', '.'));
  if (!Number.isFinite(n) || !(n in ALICUOTA_IVA_ID)) {
    throw new Error(`Alícuota de IVA inválida: "${raw}" (permitidas: 0, 2.5, 5, 10.5, 21, 27 o "exento")`);
  }
  return { rate: n, id: ALICUOTA_IVA_ID[n] };
}

// Resuelve el Id de condición IVA del receptor. Prioridad:
//   1) condición explícita en la fila (traída del padrón / guardada del cliente)
//   2) heurística por tipo de documento
function condicionReceptorId(row, docTipo) {
  const explicita = String(row?.condicionIVAReceptor ?? '').trim().toLowerCase();
  if (explicita && CONDICION_ID[explicita]) return CONDICION_ID[explicita];
  if (docTipo === 80) return 1; // CUIT sin dato -> Responsable Inscripto (mejor esfuerzo)
  return 5; // DNI / Consumidor Final
}

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

function yyyymmdd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return Number(`${y}${m}${d}`);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Convierte un número yyyymmdd a Date (medianoche local). null si no es válido.
function numToDate(n) {
  const s = String(n);
  if (!/^\d{8}$/.test(s)) return null;
  const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// AFIP exige que la fecha del comprobante (CbteFch) esté dentro de una ventana
// respecto de HOY: ±5 días para Productos, ±10 para Servicios/Ambos. Además no
// puede ser anterior al último comprobante autorizado. Si la fecha de la fila
// cae fuera de esa ventana (típico al emitir hoy algo fechado semanas atrás),
// usamos HOY —que es cuando AFIP realmente autoriza— para que la emisión no
// se rechace con el error 10016. La fecha original de la fila se sigue usando
// para el período de servicio del comprobante.
function ajustarFechaCbte(fechaNum, concepto) {
  const maxDias = concepto === CONCEPTO.productos ? 5 : 10;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const d = numToDate(fechaNum);
  if (!d) return yyyymmdd(hoy);
  const diffDias = Math.round((d.getTime() - hoy.getTime()) / 86400000);
  if (diffDias < -maxDias || diffDias > maxDias) return yyyymmdd(hoy);
  return fechaNum;
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

  // Regla AFIP: la Factura A exige receptor identificado con CUIT (Responsable
  // Inscripto / Monotributo). Sin CUIT, AFIP la rechaza: lo cortamos antes.
  if (CbteTipo === TIPO_CBTE.A && DocTipo !== 80) {
    throw new Error('La Factura A requiere el CUIT del receptor (no se puede emitir a DNI o Consumidor Final).');
  }

  const condicionRecId = condicionReceptorId(row, DocTipo);

  const hoy = yyyymmdd();
  // Fecha de la fila (si vino); se usa para el período de servicio.
  const fechaFila = row.fechaEmision || hoy;
  // Fecha del comprobante ajustada a la ventana que acepta AFIP.
  const fechaCbte = ajustarFechaCbte(fechaFila, Concepto);
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
    CondicionIVAReceptorId: condicionRecId,
  };

  if (CbteTipo === TIPO_CBTE.C) {
    // Factura C (monotributo/exento): sin desglose de IVA.
    data.ImpNeto = importe;
    data.ImpIVA = 0;
  } else {
    // Factura A/B: IVA según la alícuota de la fila (default 21%), incluido en el total.
    const { rate, id, exento } = parseAlicuota(row.alicuotaIVA);
    if (exento || rate === 0) {
      // Operación exenta / gravada al 0%: sin IVA. El neto va como no gravado
      // para que ImpTotal = ImpNeto (AFIP no acepta Iva vacío con importe).
      data.ImpNeto = importe;
      data.ImpIVA = 0;
      data.Iva = [{ Id: id, BaseImp: importe, Importe: 0 }];
    } else {
      const factor = 1 + rate / 100;
      const neto = round2(importe / factor);
      const iva = round2(importe - neto); // preserva el total; dentro de la tolerancia de AFIP
      data.ImpNeto = neto;
      data.ImpIVA = iva;
      data.Iva = [{ Id: id, BaseImp: neto, Importe: iva }];
    }
  }

  // Para servicios (o ambos) AFIP exige fechas del período de servicio.
  // Se usan las de la fila si vinieron; si no, la fecha del comprobante.
  if (Concepto === CONCEPTO.servicios || Concepto === CONCEPTO.ambos) {
    // El período de servicio sí puede quedar en el pasado (usa la fecha de la fila).
    data.FchServDesde = row.fechaServicioDesde || fechaFila;
    data.FchServHasta = row.fechaServicioHasta || fechaFila;
    // El vencimiento de pago no puede ser anterior a la fecha del comprobante.
    const vto = row.fechaVencimiento || fechaCbte;
    data.FchVtoPago = Number(vto) < Number(fechaCbte) ? fechaCbte : vto;
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
    alicuotaIVA: row.alicuotaIVA,
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
