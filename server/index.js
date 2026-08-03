import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const archiver = require('archiver');
import { fileURLToPath } from 'node:url';
import { requireAuth } from './middleware/auth.js';
import { log } from './services/log.js';
import { cifradoDisponible } from './services/crypto.js';
import { buildTemplateWorkbook } from './services/template.js';
import { getSettings, saveSettings } from './services/settings.js';
import { testConnection, generarCertificado, consultarPadron } from './services/afip.js';
import { readFacturasFromBuffer } from './services/reader.js';
import { procesarFacturas, validarFilas } from './services/facturador.js';
import { guardarFacturas, guardarProgramadas, mapCondicionPorDoc } from './services/persistencia.js';
import { enviarResumenEmisiones } from './services/mailer.js';
import { startScheduler } from './services/scheduler.js';
import { guardarResultados, buildResultadosWorkbook } from './services/exporter.js';
import { generarPDFs, regenerarPDFBuffer } from './services/pdf.js';
import { getAuthUrl, exchangeCode, verifyState, subirCarpetaADrive, driveDisponible } from './services/drive.js';

// Último resultado por usuario, para re-descargar el Excel.
const ultimoResultado = new Map();

// Fecha de HOY en Argentina como yyyymmdd (number), para comparar con las fechas del Excel.
function hoyYyyymmdd() {
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  return Number(s.replace(/-/g, ''));
}

// Pipeline completo de emisión: emite en AFIP, guarda Excel de resultados, genera PDFs,
// sube a Drive (según preferencia) y persiste en Supabase. Devuelve el result enriquecido.
async function ejecutarEmision(req, settings, rows, { generarPdf = true, subirDrive = false } = {}) {
  // Enriquecer cada fila con la condición IVA real del cliente (traída del padrón
  // al darlo de alta) para que AFIP no rechace por condición de receptor incorrecta.
  const condicionPorDoc = await mapCondicionPorDoc(
    req.supabase, req.userId, rows.map((r) => r.documento)
  );
  for (const r of rows) {
    const doc = String(r.documento ?? '').replace(/\D/g, '');
    if (doc && condicionPorDoc[doc]) r.condicionIVAReceptor = condicionPorDoc[doc];
  }

  const result = await procesarFacturas(rows, settings);

  let carpeta = null;
  try {
    const out = await guardarResultados(result, settings);
    carpeta = out.carpeta;
    result.carpeta = carpeta;
  } catch (e) {
    console.error('No se pudo guardar el Excel de resultados:', e.message);
    result.carpetaError = e.message;
  }

  if (generarPdf && carpeta && result.resumen.realizadas > 0) {
    try {
      result.pdf = await generarPDFs(result.resultados, settings, carpeta);
    } catch (e) {
      console.error('Error generando PDFs:', e.message);
      result.pdf = { generados: 0, errores: [{ error: e.message }] };
    }
  }

  const destino = settings.destinoSalida || 'local';
  const quiereDrive = destino === 'drive' || destino === 'ambos' || subirDrive;
  if (quiereDrive && carpeta) {
    try {
      result.drive = await subirCarpetaADrive(carpeta, settings);
    } catch (e) {
      console.error('Error subiendo a Drive:', e.message);
      result.drive = { error: e.message };
    }
  }

  try {
    result.persistencia = await guardarFacturas(
      req.supabase, req.userId, result.resultados, result.resumen.ambiente
    );
  } catch (e) {
    console.error('Error persistiendo facturas:', e.message);
    result.persistencia = { guardadas: 0, errores: [{ error: e.message }] };
  }

  if (result.resumen.realizadas > 0 && settings.notifEmail) {
    try {
      const emitidas = result.resultados.filter((r) => r.estado === 'ok')
        .map((r) => ({ tipo: r.tipo, nombre: r.nombre, importe: r.importeNum, cae: r.cae }));
      await enviarResumenEmisiones(settings.notifEmail, emitidas, result.resumen.ambiente);
    } catch (e) { console.error('Mail resumen falló:', e.message); }
  }

  return result;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Detrás del proxy de Railway/Render: confiar en el primer hop para que req.ip
// y el rate-limit funcionen bien (X-Forwarded-For).
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
// Orígenes permitidos del frontend (coma-separados). El primero se usa como
// destino del postMessage del callback de Drive. Se normaliza la barra final
// para tolerar valores como "https://app.vercel.app/".
const norm = (s) => String(s).trim().replace(/\/+$/, '');
const ORIGENES = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',').map(norm).filter(Boolean);
const CLIENT_ORIGIN = ORIGENES[0];

// --- Hardening ---
// helmet: cabeceras de seguridad. Se desactiva la CSP porque la página de callback
// de Drive usa un <script> inline (postMessage) y el SPA servido en producción trae
// sus propios assets; crossOriginResourcePolicy relajado para las descargas en dev.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS mínimo: solo el origen del frontend, con Authorization.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ORIGENES.includes(norm(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));

// Rate limit general y otro más estricto para operaciones sensibles/costosas.
const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const sensitiveLimiter = rateLimit({
  windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos. Esperá un minuto y reintentá.' },
});
app.use('/api/', apiLimiter);

// Verificar el login.
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ userId: req.userId, email: req.userEmail });
});

// Descarga de la plantilla modelo (pública, no requiere auth).
app.get('/api/plantilla', async (req, res) => {
  try {
    const wb = await buildTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-facturas.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error generando la plantilla:', err);
    res.status(500).json({ error: 'No se pudo generar la plantilla' });
  }
});

// Leer configuración del usuario (sin datos sensibles).
app.get('/api/config', requireAuth, async (req, res) => {
  try {
    const s = await getSettings(req.supabase, req.userId);
    res.json({
      cuit: s.cuit,
      production: s.production,
      carpetaSalida: s.carpetaSalida,
      destinoSalida: s.destinoSalida,
      razonSocial: s.razonSocial,
      puntoVenta: s.puntoVenta,
      condicionIVAEmisor: s.condicionIVAEmisor,
      domicilio: s.domicilio,
      ingresosBrutos: s.ingresosBrutos,
      inicioActividades: s.inicioActividades,
      notifEmail: s.notifEmail,
      driveDisponible: driveDisponible(),
      driveConectado: Boolean(s.driveRefreshToken),
      driveFolderId: s.driveFolderId,
      tieneAccessToken: Boolean(s.accessToken),
      tieneCertificado: Boolean(s.cert && s.key),
      certAlias: s.certAlias,
    });
  } catch (err) {
    console.error('Error leyendo config:', err);
    res.status(500).json({ error: 'No se pudo leer la configuración' });
  }
});

// Guardar configuración del usuario.
app.post('/api/config', requireAuth, async (req, res) => {
  try {
    const {
      cuit, production, accessToken, carpetaSalida, destinoSalida, razonSocial,
      puntoVenta, condicionIVAEmisor, domicilio, ingresosBrutos, inicioActividades, notifEmail,
      driveClientId, driveClientSecret, driveFolderId,
    } = req.body || {};
    const patch = {};
    if (cuit !== undefined) patch.cuit = String(cuit).replace(/\D/g, '');
    if (production !== undefined) patch.production = Boolean(production);
    if (accessToken !== undefined) patch.accessToken = String(accessToken);
    if (carpetaSalida !== undefined) patch.carpetaSalida = String(carpetaSalida);
    if (destinoSalida !== undefined) patch.destinoSalida = String(destinoSalida);
    if (razonSocial !== undefined) patch.razonSocial = String(razonSocial);
    if (puntoVenta !== undefined) patch.puntoVenta = Number(puntoVenta) || 1;
    if (condicionIVAEmisor !== undefined) patch.condicionIVAEmisor = String(condicionIVAEmisor);
    if (domicilio !== undefined) patch.domicilio = String(domicilio);
    if (ingresosBrutos !== undefined) patch.ingresosBrutos = String(ingresosBrutos);
    if (inicioActividades !== undefined) patch.inicioActividades = String(inicioActividades);
    if (notifEmail !== undefined) patch.notifEmail = String(notifEmail);
    if (driveClientId !== undefined) patch.driveClientId = String(driveClientId).trim();
    if (driveClientSecret !== undefined) patch.driveClientSecret = String(driveClientSecret).trim();
    if (driveFolderId !== undefined) patch.driveFolderId = String(driveFolderId).trim();

    // Gate de producción: no permitir emitir facturas reales sin las credenciales
    // necesarias (certificado + clave + access token de AFIP SDK).
    if (patch.production === true) {
      const actual = await getSettings(req.supabase, req.userId);
      const accessToken = patch.accessToken !== undefined ? patch.accessToken : actual.accessToken;
      const faltan = [];
      if (!actual.cert || !actual.key) faltan.push('certificado digital');
      if (!accessToken) faltan.push('access token de AFIP SDK');
      if (!(patch.cuit || actual.cuit)) faltan.push('CUIT');
      if (faltan.length) {
        return res.status(400).json({
          error: `Para activar producción (facturas reales) falta: ${faltan.join(', ')}. Configuralo y probá la conexión primero.`,
        });
      }
    }

    const next = await saveSettings(req.supabase, req.userId, patch);
    res.json({ ok: true, cuit: next.cuit, production: next.production });
  } catch (err) {
    console.error('Error guardando config:', err);
    res.status(500).json({ error: 'No se pudo guardar la configuración' });
  }
});

// Probar conexión con AFIP.
app.post('/api/afip/test', sensitiveLimiter, requireAuth, async (req, res) => {
  try {
    const settings = await getSettings(req.supabase, req.userId);
    const result = await testConnection(settings);
    res.json(result);
  } catch (err) {
    console.error('Error probando conexión AFIP:', err.message);
    res.status(502).json({ ok: false, error: err.message || 'No se pudo conectar con AFIP' });
  }
});

// Generar certificado con AFIP SDK (clave fiscal transitoria; guarda cert+key).
app.post('/api/afip/cert', sensitiveLimiter, requireAuth, async (req, res) => {
  try {
    const { password, username, alias } = req.body || {};
    const settings = await getSettings(req.supabase, req.userId);
    const result = await generarCertificado(settings, { password, username, alias });
    await saveSettings(req.supabase, req.userId, {
      cert: result.cert, key: result.key, certAlias: result.alias,
    });
    res.json({ ok: true, alias: result.alias, wsauth: result.wsauth });
  } catch (err) {
    console.error('Error generando certificado:', err?.message);
    res.status(502).json({ ok: false, error: err?.data?.message || err.message || 'No se pudo generar el certificado' });
  }
});

// Consulta el padrón AFIP por CUIT y devuelve datos del contribuyente para
// autocompletar el alta de cliente (nombre, condición IVA, domicilio).
app.get('/api/padron', sensitiveLimiter, requireAuth, async (req, res) => {
  try {
    const doc = String(req.query.doc || '').replace(/\D/g, '');
    if (doc.length !== 11) {
      return res.status(400).json({ error: 'El padrón solo se puede consultar con un CUIT de 11 dígitos.' });
    }
    const settings = await getSettings(req.supabase, req.userId);
    if (!settings.accessToken || !settings.cert || !settings.key) {
      return res.status(400).json({ error: 'Configurá el certificado y el access token de AFIP para consultar el padrón.' });
    }
    const datos = await consultarPadron(settings, doc);
    if (!datos) return res.status(404).json({ error: 'No se encontró el CUIT en el padrón.' });
    res.json({ ok: true, ...datos });
  } catch (err) {
    log.error('Consulta de padrón falló', { err: err.message });
    res.status(502).json({ error: err.message || 'No se pudo consultar el padrón de AFIP.' });
  }
});

// URL de autorización de Google Drive (userId codificado en el state).
app.get('/api/drive/auth-url', requireAuth, async (req, res) => {
  try {
    const settings = await getSettings(req.supabase, req.userId);
    const url = getAuthUrl(settings, req.userId);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Callback OAuth de Google (NO lleva JWT; recupera el usuario del state).
app.get('/api/drive/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (error) return res.send(paginaCierre(`No se autorizó el acceso: ${error}`, false));
  try {
    const userId = verifyState(state); // valida firma + vencimiento (anti-CSRF)
    await exchangeCode(String(code), userId);
    res.send(paginaCierre('✅ Google Drive conectado. Ya podés cerrar esta pestaña.', true));
  } catch (err) {
    log.error('Drive callback falló', { err: err.message });
    res.send(paginaCierre(`Error al conectar: ${err.message}`, false));
  }
});

function paginaCierre(msg, ok) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Google Drive</title>
    <style>body{font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0b0d12;color:#e7e9ee}
    .c{text-align:center;padding:32px;border-radius:16px;background:#151821;max-width:420px}
    .m{color:${ok ? '#4fe0a6' : '#ff7a7a'};font-size:1.05rem}</style></head>
    <body><div class="c"><div class="m">${msg}</div></div>
    <script>try{window.opener&&window.opener.postMessage('drive-'+${ok},${JSON.stringify(CLIENT_ORIGIN)})}catch(e){}</script>
    </body></html>`;
}

// Fase 3: validar el Excel SIN emitir (preview con total y problemas por fila).
app.post('/api/validar', requireAuth, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo Excel.' });
    const rows = await readFacturasFromBuffer(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'El Excel no tiene filas para procesar.' });
    res.json(validarFilas(rows));
  } catch (err) {
    console.error('Error validando:', err);
    res.status(500).json({ error: err.message || 'No se pudo validar el Excel' });
  }
});

// Programar por fecha: emite YA las filas cuya fecha de emisión es hoy o anterior
// (o sin fecha), y deja programadas las de fecha futura (salen su día a las 09:00).
app.post('/api/programar', sensitiveLimiter, requireAuth, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo Excel.' });
    const rows = await readFacturasFromBuffer(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'El Excel no tiene filas para procesar.' });

    const hoy = hoyYyyymmdd();
    // Vencidas: sin fecha o con fecha <= hoy => se emiten ahora.
    // Futuras: fecha > hoy => quedan programadas.
    const vencidas = rows.filter((r) => !r.fechaEmision || Number(r.fechaEmision) <= hoy);
    const futuras = rows.filter((r) => r.fechaEmision && Number(r.fechaEmision) > hoy);

    const settings = await getSettings(req.supabase, req.userId);

    let emision = null;
    if (vencidas.length) {
      emision = await ejecutarEmision(req, settings, vencidas, { generarPdf: true });
      ultimoResultado.set(req.userId, emision);
    }

    let programadas = { guardadas: 0 };
    if (futuras.length) {
      programadas = await guardarProgramadas(req.supabase, req.userId, futuras);
    }

    // Fechas (yyyymmdd -> dd/mm) de las que quedaron en cola, para mostrarlas.
    const fechasFuturas = [...new Set(futuras.map((r) => Number(r.fechaEmision)))]
      .sort((a, b) => a - b)
      .map((n) => { const s = String(n); return `${s.slice(6, 8)}/${s.slice(4, 6)}`; });

    res.json({
      ok: true,
      emitidasAhora: emision ? emision.resumen.realizadas : 0,
      conErrorAhora: emision ? emision.resumen.pendientes : 0,
      programadas: programadas.guardadas,
      fechasFuturas,
      resultado: emision, // para mostrar la tabla de lo emitido ahora
    });
  } catch (err) {
    console.error('Error programando:', err);
    res.status(500).json({ error: err.message || 'No se pudieron programar las facturas' });
  }
});

// Subir Excel y emitir las facturas.
app.post('/api/facturar', sensitiveLimiter, requireAuth, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo Excel.' });
    const rows = await readFacturasFromBuffer(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'El Excel no tiene filas de facturas para procesar.' });

    const settings = await getSettings(req.supabase, req.userId);
    const generarPdf = String(req.body?.generarPdf ?? 'true') !== 'false';
    const subirDrive = String(req.body?.subirDrive ?? 'false') === 'true';

    const result = await ejecutarEmision(req, settings, rows, { generarPdf, subirDrive });
    ultimoResultado.set(req.userId, result);
    res.json(result);
  } catch (err) {
    console.error('Error al facturar:', err);
    res.status(500).json({ error: err.message || 'No se pudieron procesar las facturas' });
  }
});

// Re-descargar el Excel de resultados del último procesamiento del usuario.
app.get('/api/resultados.xlsx', requireAuth, async (req, res) => {
  try {
    const result = ultimoResultado.get(req.userId);
    if (!result) return res.status(404).json({ error: 'Todavía no se generó ningún resultado.' });
    const wb = await buildResultadosWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="resultados-facturas.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error al descargar resultados:', err);
    res.status(500).json({ error: 'No se pudo generar el Excel de resultados' });
  }
});

// Descargar TODOS los comprobantes del último lote (PDFs + Excel) como ZIP.
// El navegador abre el "Guardar como" para elegir la carpeta local.
app.get('/api/comprobantes.zip', requireAuth, async (req, res) => {
  try {
    const result = ultimoResultado.get(req.userId);
    if (!result || !result.carpeta || !fs.existsSync(result.carpeta)) {
      return res.status(404).json({ error: 'No hay comprobantes del último lote para descargar.' });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="comprobantes.zip"');
    const zip = archiver('zip', { zlib: { level: 9 } });
    zip.on('error', (e) => { console.error('Error armando ZIP:', e.message); try { res.status(500).end(); } catch { /* noop */ } });
    zip.pipe(res);
    zip.directory(result.carpeta, false); // agrega todos los archivos de la carpeta
    await zip.finalize();
  } catch (err) {
    console.error('Error generando ZIP:', err);
    res.status(500).json({ error: 'No se pudo generar el ZIP de comprobantes' });
  }
});

// Devuelve los archivos del último lote como base64, para que el navegador los
// escriba en la carpeta local que el usuario eligió (File System Access API).
app.get('/api/comprobantes.json', requireAuth, async (req, res) => {
  try {
    const result = ultimoResultado.get(req.userId);
    if (!result || !result.carpeta || !fs.existsSync(result.carpeta)) {
      return res.status(404).json({ error: 'No hay comprobantes del último lote.' });
    }
    const nombres = fs.readdirSync(result.carpeta).filter((n) => fs.statSync(path.join(result.carpeta, n)).isFile());
    const archivos = nombres.map((name) => ({
      name,
      b64: fs.readFileSync(path.join(result.carpeta, name)).toString('base64'),
    }));
    res.json({ ok: true, archivos });
  } catch (err) {
    console.error('Error leyendo comprobantes:', err);
    res.status(500).json({ error: 'No se pudieron leer los comprobantes' });
  }
});

// Subir a Google Drive los comprobantes del último lote (a pedido del usuario).
app.post('/api/drive/subir-ultimo', requireAuth, async (req, res) => {
  try {
    const result = ultimoResultado.get(req.userId);
    if (!result || !result.carpeta || !fs.existsSync(result.carpeta)) {
      return res.status(404).json({ error: 'No hay comprobantes del último lote para subir.' });
    }
    const settings = await getSettings(req.supabase, req.userId);
    if (!settings.driveRefreshToken) {
      return res.status(409).json({ error: 'no_conectado', mensaje: 'Google Drive no está conectado. Conectá tu cuenta primero.' });
    }
    const out = await subirCarpetaADrive(result.carpeta, settings);
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('Error subiendo a Drive:', err.message);
    res.status(502).json({ error: err.message || 'No se pudo subir a Google Drive' });
  }
});

// Ver el PDF de una factura emitida (regenera el comprobante on-demand).
app.get('/api/factura/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { data: f, error } = await req.supabase
      .from('facturas').select('*').eq('id', req.params.id).single();
    if (error || !f) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (f.estado !== 'emitida' || !f.cae) {
      return res.status(400).json({ error: 'La factura todavía no está emitida.' });
    }
    const settings = await getSettings(req.supabase, req.userId);
    const { buffer, nombre } = await regenerarPDFBuffer(f, settings);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error regenerando PDF:', err.message);
    res.status(502).json({ error: err.message || 'No se pudo generar el PDF' });
  }
});

// En producción (VPS): servir el build de React desde el mismo servidor.
// Así el frontend y el backend comparten origen y no hace falta CORS.
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(CLIENT_DIST));
// Fallback SPA: cualquier ruta que no sea /api devuelve index.html.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => { if (err) next(); });
});

app.listen(PORT, () => {
  console.log(`FacturitaApp backend en http://localhost:${PORT}`);
  startScheduler(); // Fase 7: emisión automática de programadas (requiere service role key)
});
