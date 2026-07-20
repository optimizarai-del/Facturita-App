import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTemplateWorkbook } from './services/template.js';
import { readSettings, saveSettings } from './config/settings.js';
import { testConnection, generarCertificado } from './services/afip.js';
import { readFacturasFromBuffer } from './services/reader.js';
import { procesarFacturas } from './services/facturador.js';
import { guardarResultados, buildResultadosWorkbook } from './services/exporter.js';
import { generarPDFs } from './services/pdf.js';

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
