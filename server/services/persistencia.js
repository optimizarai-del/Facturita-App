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

// Busca o crea el cliente por documento; devuelve su id (o null si no hay documento).
async function upsertCliente(supabase, userId, nombre, documento) {
  const doc = String(documento ?? '').replace(/\D/g, '');
  if (!doc) return null;
  const { data: existente } = await supabase
    .from('clientes').select('id').eq('user_id', userId).eq('documento', doc).maybeSingle();
  if (existente) return existente.id;
  const tipoDoc = doc.length === 11 ? 'CUIT' : 'DNI';
  const { data, error } = await supabase
    .from('clientes')
    .insert({ user_id: userId, nombre: nombre || 'Sin nombre', documento: doc, tipo_doc: tipoDoc })
    .select('id').single();
  if (error) return null; // no bloquea la persistencia de la factura
  return data.id;
}

const CONCEPTO_NUM_TXT = { productos: 'Productos', servicios: 'Servicios', ambos: 'Ambos' };

// Guarda filas del Excel como facturas PROGRAMADAS (para emitir en su fecha).
export async function guardarProgramadas(supabase, userId, rows) {
  let guardadas = 0;
  const errores = [];
  for (const r of rows) {
    try {
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
        fecha_emision: fechaISO(r.fechaEmision),
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
  return { guardadas, errores };
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
