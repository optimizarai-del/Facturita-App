import cron from 'node-cron';
import { supabaseService } from './supabase.js';
import { getSettings } from './settings.js';
import { procesarFacturas } from './facturador.js';
import { mapCondicionPorDoc } from './persistencia.js';
import { enviarResumenEmisiones, enviarAvisoFallos } from './mailer.js';
import { log } from './log.js';

const MAX_INTENTOS = 3; // reintentos antes de marcar una programada como error definitivo.

// 'YYYY-MM-DD' -> yyyymmdd (number) para el facturador.
function isoToYyyymmdd(iso) {
  if (!iso) return null;
  return Number(String(iso).slice(0, 10).replace(/-/g, ''));
}
// Fecha de HOY en Argentina (yyyy-mm-dd), sin depender del timezone del server.
function hoyISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}
function hoyYyyymmdd() {
  return Number(hoyISO().replace(/-/g, ''));
}

// Reconstruye una "fila" de Excel a partir de una factura programada.
// La fecha del comprobante (CbteFch) se fija a HOY: emitir con la fecha programada
// vieja haría que AFIP rechace el comprobante por estar fuera de su ventana permitida.
function facturaARow(f, idx) {
  return {
    fila: idx + 1,
    nombre: f.nombre_cliente,
    documento: f.documento,
    tipo: f.tipo,
    concepto: f.concepto,
    descripcion: f.descripcion,
    importe: f.importe,
    alicuotaIVA: f.alicuota_iva,
    condicionIVAReceptor: f.condicion_receptor || null,
    fechaEmision: hoyYyyymmdd(),
    fechaServicioDesde: isoToYyyymmdd(f.fecha_servicio_desde),
    fechaServicioHasta: isoToYyyymmdd(f.fecha_servicio_hasta),
    fechaVencimiento: isoToYyyymmdd(f.fecha_vencimiento),
  };
}

// Heurística: ¿el error de AFIP parece transitorio (conviene reintentar) o definitivo?
function esTransitorio(msg) {
  return /timeout|network|ECONN|socket|503|502|500|no disponible|temporar|inténtelo|intente/i.test(String(msg || ''));
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
    // Vencidas (fecha <= hoy) o sin fecha (NULL): estas últimas se emiten ya,
    // así no quedan colgadas para siempre.
    .or(`fecha_emision.is.null,fecha_emision.lte.${hoy}`)
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

      // Resolver condición IVA de cada receptor desde los clientes guardados.
      const condicionPorDoc = await mapCondicionPorDoc(svc, userId, facturas.map((f) => f.documento));
      const facturasConCond = facturas.map((f) => ({
        ...f,
        condicion_receptor: condicionPorDoc[String(f.documento ?? '').replace(/\D/g, '')] || null,
      }));

      const rows = facturasConCond.map(facturaARow);

      let resultados;
      try {
        ({ resultados } = await procesarFacturas(rows, settings));
      } catch (e) {
        // Falla a nivel batch (AFIP caído / sin cert): dejamos todo en 'programada'
        // para reintentar en la próxima corrida. No se pierde nada.
        log.warn('Scheduler: batch falló, se reintenta mañana', { userId, err: e.message });
        continue;
      }

      const emitidasOk = [];
      const fallidas = [];
      for (let i = 0; i < facturas.length; i++) {
        const f = facturas[i];
        const r = resultados[i];
        if (r.estado === 'ok') {
          await svc.from('facturas').update({
            estado: 'emitida', cae: r.cae, cae_vto: r.caeVto,
            nro_comprobante: r.nroComprobante, punto_venta: r.puntoVenta,
            neto: r.neto, iva: r.iva, fecha_emision: hoyISO(),
            ambiente: settings.production ? 'producción' : 'homologación',
          }).eq('id', f.id);
          emitidasOk.push({ ...f, cae: r.cae });
          totalEmitidas += 1;
        } else {
          const intentos = (f.intentos || 0) + 1;
          const definitivo = !esTransitorio(r.error) || intentos >= MAX_INTENTOS;
          await svc.from('facturas').update({
            estado: definitivo ? 'error' : 'programada',
            error_msg: r.error, intentos,
          }).eq('id', f.id);
          if (definitivo) fallidas.push({ ...f, error: r.error });
        }
      }

      const ambiente = settings.production ? 'producción' : 'homologación';
      // Notificación por mail del resumen del día (éxitos).
      if (emitidasOk.length && settings.notifEmail) {
        try { await enviarResumenEmisiones(settings.notifEmail, emitidasOk, ambiente); }
        catch (e) { log.error('Mail resumen falló', { userId, err: e.message }); }
      }
      // Aviso de fallos definitivos (para que el usuario no se entere tarde).
      if (fallidas.length && settings.notifEmail) {
        try { await enviarAvisoFallos(settings.notifEmail, fallidas, ambiente); }
        catch (e) { log.error('Mail aviso de fallos falló', { userId, err: e.message }); }
      }
    } catch (e) {
      log.error('Scheduler usuario falló', { userId, err: e.message });
    }
  }
  log.info('Scheduler: corrida completa', { emitidas: totalEmitidas });
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
  }, { timezone: 'America/Argentina/Buenos_Aires' });
  console.log('🕘 Scheduler activo: revisa facturas programadas todos los días a las 09:00.');
}
