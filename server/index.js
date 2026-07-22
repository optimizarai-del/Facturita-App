import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './middleware/auth.js';
import { buildTemplateWorkbook } from './services/template.js';
import { readSettings, saveSettings } from './config/settings.js';
import { testConnection, generarCertificado } from './services/afip.js';
import { readFacturasFromBuffer } from './services/reader.js';
import { procesarFacturas } from './services/facturador.js';
import { guardarResultados, buildResultadosWorkbook } from './services/exporter.js';
import { generarPDFs } from './services/pdf.js';
import { getAuthUrl, exchangeCode, subirCarpetaADrive } from './services/drive.js';

// Guardamos el último resultado en memoria para permitir re-descargar el Excel.
let ultimoResultado = null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Fase 0: verificar el login. Devuelve el usuario si el JWT de Supabase es válido.
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ userId: req.userId, email: req.userEmail });
});

// Milestone 1: descarga de la plantilla modelo
app.get('/api/plantilla', async (req, res) => {
  try {
    const wb = await buildTemplateWorkbook();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="plantilla-facturas.xlsx"'
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error generando la plantilla:', err);
    res.status(500).json({ error: 'No se pudo generar la plantilla' });
  }
});

// Milestone 2: leer configuración (nunca devolvemos el access token entero)
app.get('/api/config', async (req, res) => {
  try {
    const s = await readSettings();
    res.json({
      cuit: s.cuit,
      production: s.production,
      carpetaSalida: s.carpetaSalida,
      razonSocial: s.razonSocial,
      puntoVenta: s.puntoVenta,
      condicionIVAEmisor: s.condicionIVAEmisor,
      domicilio: s.domicilio,
      ingresosBrutos: s.ingresosBrutos,
      inicioActividades: s.inicioActividades,
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

// Milestone 2: guardar configuración
app.post('/api/config', async (req, res) => {
  try {
    const {
      cuit, production, accessToken, carpetaSalida, razonSocial,
      puntoVenta, condicionIVAEmisor, domicilio, ingresosBrutos, inicioActividades,
      driveClientId, driveClientSecret, driveFolderId,
    } = req.body || {};
    const patch = {};
    if (cuit !== undefined) patch.cuit = String(cuit).replace(/\D/g, '');
    if (production !== undefined) patch.production = Boolean(production);
    if (accessToken !== undefined) patch.accessToken = String(accessToken);
    if (carpetaSalida !== undefined) patch.carpetaSalida = String(carpetaSalida);
    if (razonSocial !== undefined) patch.razonSocial = String(razonSocial);
    if (puntoVenta !== undefined) patch.puntoVenta = Number(puntoVenta) || 1;
    if (condicionIVAEmisor !== undefined) patch.condicionIVAEmisor = String(condicionIVAEmisor);
    if (domicilio !== undefined) patch.domicilio = String(domicilio);
    if (ingresosBrutos !== undefined) patch.ingresosBrutos = String(ingresosBrutos);
    if (inicioActividades !== undefined) patch.inicioActividades = String(inicioActividades);
    if (driveClientId !== undefined) patch.driveClientId = String(driveClientId).trim();
    if (driveClientSecret !== undefined) patch.driveClientSecret = String(driveClientSecret).trim();
    if (driveFolderId !== undefined) patch.driveFolderId = String(driveFolderId).trim();
    const next = await saveSettings(patch);
    res.json({ ok: true, cuit: next.cuit, production: next.production });
  } catch (err) {
    console.error('Error guardando config:', err);
    res.status(500).json({ error: 'No se pudo guardar la configuración' });
  }
});

// Milestone 2: probar conexión con AFIP
app.post('/api/afip/test', async (req, res) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (err) {
    console.error('Error probando conexión AFIP:', err);
    res.status(502).json({
      ok: false,
      error: err.message || 'No se pudo conectar con AFIP',
    });
  }
});

// Generar certificado con AFIP SDK (usa la clave fiscal de forma transitoria)
app.post('/api/afip/cert', async (req, res) => {
  try {
    const { password, username, alias } = req.body || {};
    const result = await generarCertificado({ password, username, alias });
    res.json(result);
  } catch (err) {
    console.error('Error generando certificado:', err?.message);
    res.status(502).json({
      ok: false,
      error: err?.data?.message || err.message || 'No se pudo generar el certificado',
    });
  }
});

// Milestone 5: obtener la URL de autorización de Google Drive
app.get('/api/drive/auth-url', async (req, res) => {
  try {
    const url = await getAuthUrl();
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Milestone 5: callback OAuth de Google (guarda el refresh token)
app.get('/api/drive/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.send(paginaCierre(`No se autorizó el acceso: ${error}`, false));
  }
  try {
    await exchangeCode(String(code));
    res.send(paginaCierre('✅ Google Drive conectado. Ya podés cerrar esta pestaña.', true));
  } catch (err) {
    res.send(paginaCierre(`Error al conectar: ${err.message}`, false));
  }
});

function paginaCierre(msg, ok) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Google Drive</title>
    <style>body{font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#fbfbfd}
    .c{text-align:center;padding:32px;border-radius:16px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.08);max-width:420px}
    .m{color:${ok ? '#1d7a3d' : '#c0362c'};font-size:1.05rem}</style></head>
    <body><div class="c"><div class="m">${msg}</div></div>
    <script>try{window.opener&&window.opener.postMessage('drive-'+${ok},'*')}catch(e){}</script>
    </body></html>`;
}

// Milestone 3: subir Excel y emitir las facturas
app.post('/api/facturar', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo Excel.' });
    }
    const rows = await readFacturasFromBuffer(req.file.buffer);
    if (!rows.length) {
      return res.status(400).json({ error: 'El Excel no tiene filas de facturas para procesar.' });
    }
    const result = await procesarFacturas(rows);
    ultimoResultado = result;

    // Guardar Excel de resultados en la carpeta de salida.
    const settings = await readSettings();
    let carpeta = null;
    try {
      const out = await guardarResultados(result, settings);
      carpeta = out.carpeta;
      result.carpeta = carpeta;
    } catch (e) {
      console.error('No se pudo guardar el Excel de resultados:', e.message);
      result.carpetaError = e.message;
    }

    // Generar PDFs de las facturas realizadas (si se pidió y hay carpeta).
    const quierePdf = String(req.body?.generarPdf ?? 'true') !== 'false';
    if (quierePdf && carpeta && result.resumen.realizadas > 0) {
      try {
        const pdf = await generarPDFs(result.resultados, settings, carpeta);
        result.pdf = pdf;
      } catch (e) {
        console.error('Error generando PDFs:', e.message);
        result.pdf = { generados: 0, errores: [{ error: e.message }] };
      }
    }

    // Subir la carpeta a Google Drive (si se pidió y está conectado).
    const quiereDrive = String(req.body?.subirDrive ?? 'false') === 'true';
    if (quiereDrive && carpeta) {
      try {
        result.drive = await subirCarpetaADrive(carpeta);
      } catch (e) {
        console.error('Error subiendo a Drive:', e.message);
        result.drive = { error: e.message };
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Error al facturar:', err);
    res.status(500).json({ error: err.message || 'No se pudieron procesar las facturas' });
  }
});

// Descargar el Excel de resultados del último procesamiento.
app.get('/api/resultados.xlsx', async (req, res) => {
  try {
    if (!ultimoResultado) {
      return res.status(404).json({ error: 'Todavía no se generó ningún resultado.' });
    }
    const wb = await buildResultadosWorkbook(ultimoResultado);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="resultados-facturas.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error al descargar resultados:', err);
    res.status(500).json({ error: 'No se pudo generar el Excel de resultados' });
  }
});

// Servir el frontend estático
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`FacturitaApp corriendo en http://localhost:${PORT}`);
});
