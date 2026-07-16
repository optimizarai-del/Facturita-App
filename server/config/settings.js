import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.local.json');

const DEFAULTS = {
  cuit: '',
  production: false, // false = homologación (testing)
  accessToken: '', // solo necesario en producción
  puntoVenta: 1, // punto de venta AFIP
  razonSocial: '', // razón social del emisor (para el PDF)
  cert: '', // certificado X.509 (PEM) — generado con CreateCert
  key: '', // clave privada (PEM) — generada con CreateCert
  certAlias: '', // alias del certificado en AFIP
  carpetaSalida: '',
};

// Lee la config local (o devuelve defaults si no existe todavía).
export async function readSettings() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULTS };
    throw err;
  }
}

// Guarda parcial o total sobre la config existente.
export async function saveSettings(patch) {
  const current = await readSettings();
  const next = { ...current, ...patch };
  await fs.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
