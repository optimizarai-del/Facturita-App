import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './middleware/auth.js';
import { buildTemplateWorkbook } from './services/template.js';
import { getSettings, saveSettings } from './services/settings.js';
import { testConnection, generarCertificado } from './services/afip.js';
import { readFacturasFromBuffer } from './services/reader.js';
import { procesarFacturas, validarFilas } from './services/facturador.js';
import { guardarFacturas, guardarProgramadas } from './services/persistencia.js';
import { enviarResumenEmisiones } from './services/mailer.js';
import { startScheduler } from './services/scheduler.js';
import { guardarResultados, buildResultadosWorkbook } from './services/exporter.js';
import { generarPDFs } from './services/pdf.js';
import { getAuthUrl, exchangeCode, subirCarpetaADrive } from './services/drive.js';

// Último resultado por usuario, para re-descargar el Excel.
const ultimoResultado = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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
      driveClientId: s.driveClientId,
      tieneDriveSecret: Boolean(s.driveClientSecret),
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
    const next = await saveSettings(req.supabase, req.userId, patch);
    res.json({ ok: true, cuit: next.cuit, production: next.production });
  } catch (err) {
    console.error('Error guardando config:', err);
    res.status(500).json({ error: 'No se pudo guardar la configuración' });
  }
});

// Probar conexión con AFIP.
app.post('/api/afip/test', requireAuth, async (req, res) => {
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
app.post('/api/afip/cert', requireAuth, async (req, res) => {
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
    await exchangeCode(String(code), String(state));
    res.send(paginaCierre('✅ Google Drive conectado. Ya podés cerrar esta pestaña.', true));
  } catch (err) {
    res.send(paginaCierre(`Error al conectar: ${err.message}`, false));
  }
});

function paginaCierre(msg, ok) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Google Drive</title>
    <style>body{font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0b0d12;color:#e7e9ee}
    .c{text-align:center;padding:32px;border-radius:16px;background:#151821;max-width:420px}
    .m{color:${ok ? '#4fe0a6' : '#ff7a7a'};font-size:1.05rem}</style></head>
    <body><div class="c"><div class="m">${msg}</div></div>
    <script>try{window.opener&&window.opener.postMessage('drive-'+${ok},'*')}catch(e){}</script>
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

// Fase 7: programar facturas (se emiten solas en su fecha de emisión).
app.post('/api/programar', requireAuth, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo Excel.' });
    const rows = await readFacturasFromBuffer(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'El Excel no tiene filas para procesar.' });
    const out = await guardarProgramadas(req.supabase, req.userId, rows);
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('Error programando:', err);
    res.status(500).json({ error: err.message || 'No se pudieron programar las facturas' });
  }
});

// Subir Excel y emitir las facturas.
app.post('/api/facturar', requireAuth, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo Excel.' });
    const rows = await readFacturasFromBuffer(req.file.buffer);
    if (!rows.length) return res.status(400).json({ error: 'El Excel no tiene filas de facturas para procesar.' });

    const settings = await getSettings(req.supabase, req.userId);
    const result = await procesarFacturas(rows, settings);
    ultimoResultado.set(req.userId, result);

    let carpeta = null;
    try {
      const out = await guardarResultados(result, settings);
      carpeta = out.carpeta;
      result.carpeta = carpeta;
    } catch (e) {
      console.error('No se pudo guardar el Excel de resultados:', e.message);
      result.carpetaError = e.message;
    }

    const quierePdf = String(req.body?.generarPdf ?? 'true') !== 'false';
    if (quierePdf && carpeta && result.resumen.realizadas > 0) {
      try {
        result.pdf = await generarPDFs(result.resultados, settings, carpeta);
      } catch (e) {
        console.error('Error generando PDFs:', e.message);
        result.pdf = { generados: 0, errores: [{ error: e.message }] };
      }
    }

    // Respeta la preferencia de destino del usuario (o el checkbox como override).
    const destino = settings.destinoSalida || 'local';
    const quiereDrive = destino === 'drive' || destino === 'ambos'
      || String(req.body?.subirDrive ?? 'false') === 'true';
    if (quiereDrive && carpeta) {
      try {
        result.drive = await subirCarpetaADrive(carpeta, settings);
      } catch (e) {
        console.error('Error subiendo a Drive:', e.message);
        result.drive = { error: e.message };
      }
    }

    // Fase 4: persistir las facturas en Supabase (historial + clientes).
    try {
      result.persistencia = await guardarFacturas(
        req.supabase, req.userId, result.resultados, result.resumen.ambiente
      );
    } catch (e) {
      console.error('Error persistiendo facturas:', e.message);
      result.persistencia = { guardadas: 0, errores: [{ error: e.message }] };
    }

    // Fase 8: notificar por mail el resumen de emitidas (si hay SMTP y email).
    if (result.resumen.realizadas > 0 && settings.notifEmail) {
      try {
        const emitidas = result.resultados.filter((r) => r.estado === 'ok')
          .map((r) => ({ tipo: r.tipo, nombre: r.nombre, importe: r.importeNum, cae: r.cae }));
        await enviarResumenEmisiones(settings.notifEmail, emitidas, result.resumen.ambiente);
      } catch (e) { console.error('Mail resumen falló:', e.message); }
    }

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

// En producción, servir el build de React.
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

app.listen(PORT, () => {
  console.log(`FacturitaApp backend en http://localhost:${PORT}`);
  startScheduler(); // Fase 7: emisión automática de programadas (requiere service role key)
});
