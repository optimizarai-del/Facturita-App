// Persiste en Supabase las facturas emitidas y auto-crea/vincula clientes.
// Usa el cliente Supabase con RLS del usuario (req.supabase).

const CONCEPTO_TXT = { 1: 'Productos', 2: 'Servicios', 3: 'Ambos' };

// yyyymmdd (number) -> 'YYYY-MM-DD' (o null).
function fechaISO(yyyymmdd) {
  if (!yyyymmdd) return null;
  const s = String(yyyymmdd);
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function num(v) {
  const n = Number(String(v ?? '').toString().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Fecha de HOY en Argentina (yyyy-mm-dd), sin depender del timezone del server.
function hoyISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// Busca o crea el cliente por documento; devuelve su id (o null si no hay documento).
async function upsertCliente(supabase, userId, nombre, documento, condicionIVA) {
  const doc = String(documento ?? '').replace(/\D/g, '');
  if (!doc) return null;
  const { data: existente } = await supabase
    .from('clientes').select('id').eq('user_id', userId).eq('documento', doc).maybeSingle();
  if (existente) return existente.id;
  const tipoDoc = doc.length === 11 ? 'CUIT' : 'DNI';
  const { data, error } = await supabase
    .from('clientes')
    .insert({
      user_id: userId, nombre: nombre || 'Sin nombre', documento: doc, tipo_doc: tipoDoc,
      condicion_iva: condicionIVA || '',
    })
    .select('id').single();
  if (error) return null; // no bloquea la persistencia de la factura
  return data.id;
}

// Devuelve un mapa documento -> condición IVA (texto) de los clientes del usuario,
// para resolver la condición del receptor en la emisión sin volver a consultar el padrón.
export async function mapCondicionPorDoc(supabase, userId, documentos) {
  const docs = [...new Set(documentos.map((d) => String(d ?? '').replace(/\D/g, '')).filter(Boolean))];
  if (!docs.length) return {};
  const { data } = await supabase
    .from('clientes').select('documento, condicion_iva')
    .eq('user_id', userId).in('documento', docs);
  const map = {};
  for (const c of data || []) if (c.condicion_iva) map[c.documento] = c.condicion_iva;
  return map;
}

const CONCEPTO_NUM_TXT = { productos: 'Productos', servicios: 'Servicios', ambos: 'Ambos' };

// Guarda filas del Excel como facturas PROGRAMADAS (para emitir en su fecha).
export async function guardarProgramadas(supabase, userId, rows) {
  let guardadas = 0;
  let sinFecha = 0; // programadas para hoy por no traer fecha de emisión
  const errores = [];
  for (const r of rows) {
    try {
      if (!fechaISO(r.fechaEmision)) sinFecha += 1;
      // eslint-disable-next-line no-await-in-loop
      const clienteId = await upsertCliente(supabase, userId, r.nombre, r.documento);
      const conceptoKey = String(r.concepto ?? '').trim().toLowerCase();
      const fila = {
        user_id: userId,
        cliente_id: clienteId,
        nombre_cliente: r.nombre || '',
        documento: String(r.documento ?? '').replace(/\D/g, ''),
        tipo: String(r.tipo || '').toUpperCase() || null,
        concepto: CONCEPTO_NUM_TXT[conceptoKey] || r.concepto || null,
        descripcion: r.descripcion || '',
        importe: num(r.importe),
        alicuota_iva: num(r.alicuotaIVA),
        // Sin fecha de emisión => se programa para hoy (se emite en la próxima
        // corrida del scheduler). Así siempre se sabe cuándo va a salir.
        fecha_emision: fechaISO(r.fechaEmision) || hoyISO(),
        fecha_servicio_desde: fechaISO(r.fechaServicioDesde),
        fecha_servicio_hasta: fechaISO(r.fechaServicioHasta),
        fecha_vencimiento: fechaISO(r.fechaVencimiento),
        estado: 'programada',
      };
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase.from('facturas').insert(fila);
      if (error) errores.push({ fila: r.fila, error: error.message });
      else guardadas += 1;
    } catch (e) {
      errores.push({ fila: r.fila, error: e.message });
    }
  }
  return { guardadas, sinFecha, hoy: hoyISO(), errores };
}

// Guarda todas las facturas del resultado. Devuelve { guardadas, errores }.
export async function guardarFacturas(supabase, userId, resultados, ambiente) {
  let guardadas = 0;
  const errores = [];
  for (const r of resultados) {
    try {
      const ok = r.estado === 'ok';
      // eslint-disable-next-line no-await-in-loop
      const clienteId = await upsertCliente(supabase, userId, r.nombre, r.documento);
      const fila = {
        user_id: userId,
        cliente_id: clienteId,
        nombre_cliente: r.nombre || '',
        documento: String(r.documento ?? '').replace(/\D/g, ''),
        tipo: r.tipo || null,
        concepto: ok ? (CONCEPTO_TXT[r.concepto] || null) : null,
        descripcion: r.descripcion || '',
        importe: num(r.importeNum ?? r.importe),
        alicuota_iva: num(r.alicuotaIVA),
        neto: ok ? num(r.neto) : null,
        iva: ok ? num(r.iva) : null,
        punto_venta: ok ? r.puntoVenta : null,
        nro_comprobante: ok ? r.nroComprobante : null,
        cae: ok ? r.cae : null,
        cae_vto: ok ? r.caeVto : null,
        fecha_emision: fechaISO(r.fecha),
        fecha_servicio_desde: fechaISO(r.fechaServicioDesde),
        fecha_servicio_hasta: fechaISO(r.fechaServicioHasta),
        fecha_vencimiento: fechaISO(r.fechaVencimiento),
        estado: ok ? 'emitida' : 'error',
        error_msg: ok ? '' : (r.error || ''),
        ambiente: ambiente || 'homologación',
      };
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase.from('facturas').insert(fila);
      if (error) errores.push({ fila: r.fila, error: error.message });
      else guardadas += 1;
    } catch (e) {
      errores.push({ fila: r.fila, error: e.message });
    }
  }
  return { guardadas, errores };
}
