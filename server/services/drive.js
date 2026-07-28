import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { google } from 'googleapis';
import { supabaseService } from './supabase.js';
import { encrypt, decrypt } from './crypto.js';

// URI de redirección OAuth (debe coincidir con la registrada en Google Cloud Console).
// Configurable por env para producción (dominio real).
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/api/drive/callback';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// --- State firmado para el OAuth (anti-CSRF / confused deputy) ---
// El callback de Google no lleva el JWT del usuario, así que el userId viaja en el
// `state`. Para que no sea falsificable, lo firmamos con HMAC y le ponemos vencimiento.
const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.APP_ENCRYPTION_KEY || '';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

function signState(userId) {
  const payload = `${userId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('base64url');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

// Verifica el state y devuelve el userId, o lanza si es inválido/vencido.
export function verifyState(state) {
  if (!STATE_SECRET) throw new Error('Falta OAUTH_STATE_SECRET en el server.');
  let decoded;
  try { decoded = Buffer.from(String(state), 'base64url').toString('utf8'); }
  catch { throw new Error('State inválido.'); }
  const [userId, ts, sig] = decoded.split('.');
  if (!userId || !ts || !sig) throw new Error('State malformado.');
  const expected = crypto.createHmac('sha256', STATE_SECRET).update(`${userId}.${ts}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Firma del state inválida.');
  if (Date.now() - Number(ts) > STATE_TTL_MS) throw new Error('El pedido de autorización venció. Reintentá.');
  return userId;
}

// MIME types por extensión para subir con el tipo correcto.
const MIME = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
};

// Crea el cliente OAuth a partir de la config (sin refresh token todavía).
function oauthClient(settings) {
  if (!settings.driveClientId || !settings.driveClientSecret) {
    throw new Error('Faltan las credenciales de Google (Client ID y Client Secret).');
  }
  return new google.auth.OAuth2(
    settings.driveClientId,
    settings.driveClientSecret,
    REDIRECT_URI
  );
}

// Devuelve la URL de autorización. Codifica el userId en el `state` para
// recuperarlo en el callback (que no lleva el JWT del usuario).
export function getAuthUrl(settings, userId) {
  const client = oauthClient(settings);
  return client.generateAuthUrl({
    access_type: 'offline', // para obtener refresh token
    prompt: 'consent', // fuerza refresh token aunque ya haya autorizado
    scope: SCOPES,
    state: signState(userId), // firmado, no el userId crudo
  });
}

// Intercambia el código por tokens y guarda el refresh token del usuario (por state).
// Usa el service client porque el callback de Google no trae el JWT del usuario.
export async function exchangeCode(code, userId) {
  const svc = supabaseService();
  const { data: cred } = await svc
    .from('drive_credentials').select('*').eq('user_id', userId).single();
  if (!cred) throw new Error('Usuario no encontrado.');

  const client = oauthClient({
    driveClientId: cred.client_id,
    driveClientSecret: decrypt(cred.client_secret), // guardado cifrado
  });
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google no devolvió un refresh token. Revocá el acceso y volvé a autorizar.');
  }
  const { error } = await svc
    .from('drive_credentials')
    .update({ refresh_token: encrypt(tokens.refresh_token), updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// Devuelve un cliente Drive autenticado y listo para usar.
function driveClient(settings) {
  if (!settings.driveRefreshToken) {
    throw new Error('Google Drive no está conectado. Autorizá el acceso primero.');
  }
  const client = oauthClient(settings);
  client.setCredentials({ refresh_token: settings.driveRefreshToken });
  return google.drive({ version: 'v3', auth: client });
}

// Crea una carpeta en Drive (dentro de la carpeta padre si está configurada).
async function crearCarpetaDrive(drive, nombre, parentId) {
  const res = await drive.files.create({
    requestBody: {
      name: nombre,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id, webViewLink',
  });
  return res.data; // { id, webViewLink }
}

// Sube todos los archivos de una carpeta local a una carpeta nueva en Drive.
// Devuelve { subidos, link } o lanza con mensaje claro.
export async function subirCarpetaADrive(carpetaLocal, settings) {
  const drive = driveClient(settings);

  const nombreCarpeta = path.basename(carpetaLocal);
  const carpetaDrive = await crearCarpetaDrive(drive, nombreCarpeta, settings.driveFolderId);

  const archivos = await fsp.readdir(carpetaLocal);
  let subidos = 0;
  for (const nombre of archivos) {
    const full = path.join(carpetaLocal, nombre);
    const stat = await fsp.stat(full);
    if (!stat.isFile()) continue;
    const ext = path.extname(nombre).toLowerCase();
    // eslint-disable-next-line no-await-in-loop
    await drive.files.create({
      requestBody: { name: nombre, parents: [carpetaDrive.id] },
      media: { mimeType: MIME[ext] || 'application/octet-stream', body: fs.createReadStream(full) },
      fields: 'id',
    });
    subidos += 1;
  }

  return { subidos, link: carpetaDrive.webViewLink, carpetaId: carpetaDrive.id };
}
