import cron from 'node-cron';
import { supabaseService } from './supabase.js';
import { getSettings } from './settings.js';
import { procesarFacturas } from './facturador.js';
import { enviarResumenEmisiones } from './mailer.js';

// 'YYYY-MM-DD' -> yyyymmdd (number) para el facturador.
function isoToYyyymmdd(iso) {
  if (!iso) return null;
  return Number(String(iso).slice(0, 10).replace(/-/g, ''));
}
function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// Reconstruye una "fila" de Excel a partir de una factura programada.
function facturaARow(f, idx) {
  return {
    fila: idx + 1,
    nombre: f.nombre_cliente,
    documento: f.documento,
    tipo: f.tipo,
    concepto: f.concepto,
    descripcion: f.descripcion,
    importe: f.importe,
    fechaEmision: isoToYyyymmdd(f.fecha_emision),
    fechaServicioDesde: isoToYyyymmdd(f.fecha_servicio_desde),
    fechaServicioHasta: isoToYyyymmdd(f.fecha_servicio_hasta),
    fechaVencimiento: isoToYyyymmdd(f.fecha_vencimiento),
  };
}

// Procesa todas las facturas programadas cuya fecha de emisión ya llegó.
export async function emitirProgramadasVencidas() {
  let svc;
  try {
    svc = supabaseService();
  } catch (e) {
    console.warn('Scheduler: ', e.message, '— se omite hasta configurar la service role key.');
    return { skipped: true };
  }

  const hoy = hoyISO();
  const { data: pendientes, error } = await svc
    .from('facturas').select('*')
    .eq('estado', 'programada')
    .lte('fecha_emision', hoy)
    .order('user_id');
  if (error) { console.error('Scheduler query error:', error.message); return { error: error.message }; }
  if (!pendientes?.length) return { emitidas: 0 };

  // Agrupar por usuario.
  const porUsuario = new Map();
  for (const f of pendientes) {
    if (!porUsuario.has(f.user_id)) porUsuario.set(f.user_id, []);
    porUsuario.get(f.user_id).push(f);
  }

  let totalEmitidas = 0;
  for (const [userId, facturas] of porUsuario) {
    try {
      const settings = await getSettings(svc, userId);
      if (!settings.cuit || !settings.accessToken) continue; // usuario sin AFIP configurado
      const rows = facturas.map(facturaARow);
      const { resultados } = await procesarFacturas(rows, settings);

      const emitidasOk = [];
      for (let i = 0; i < facturas.length; i++) {
        const f = facturas[i];
        const r = resultados[i];
        if (r.estado === 'ok') {
          await svc.from('facturas').update({
            estado: 'emitida', cae: r.cae, cae_vto: r.caeVto,
            nro_comprobante: r.nroComprobante, punto_venta: r.puntoVenta,
            neto: r.neto, iva: r.iva, ambiente: settings.production ? 'producción' : 'homologación',
          }).eq('id', f.id);
          emitidasOk.push({ ...f, cae: r.cae });
          totalEmitidas += 1;
        } else {
          await svc.from('facturas').update({ estado: 'error', error_msg: r.error }).eq('id', f.id);
        }
      }

      // Notificación por mail del resumen del día.
      if (emitidasOk.length && settings.notifEmail) {
        try {
          await enviarResumenEmisiones(
            settings.notifEmail, emitidasOk, settings.production ? 'producción' : 'homologación'
          );
        } catch (e) { console.error('Mail resumen falló:', e.message); }
      }
    } catch (e) {
      console.error(`Scheduler usuario ${userId}:`, e.message);
    }
  }
  console.log(`Scheduler: ${totalEmitidas} factura(s) programada(s) emitida(s).`);
  return { emitidas: totalEmitidas };
}

// Arranca el cron diario (09:00). Requiere SUPABASE_SERVICE_ROLE_KEY.
export function startScheduler() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('⚠️  Scheduler deshabilitado: falta SUPABASE_SERVICE_ROLE_KEY.');
    return;
  }
  cron.schedule('0 9 * * *', () => {
    emitirProgramadasVencidas().catch((e) => console.error('Scheduler error:', e.message));
  });
  console.log('🕘 Scheduler activo: revisa facturas programadas todos los días a las 09:00.');
}
