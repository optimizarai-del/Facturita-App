import crypto from 'node:crypto';

// Cifrado at-rest de credenciales sensibles (cert AFIP, clave privada, access tokens,
// secret y refresh token de Drive). Usa AES-256-GCM con APP_ENCRYPTION_KEY.
//
// Formato del texto cifrado:  enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
// Los valores en texto plano viejos (sin el prefijo) se devuelven tal cual al
// desencriptar, así la migración de datos existentes es transparente.

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) return null; // sin clave configurada: se opera en texto plano (con aviso)
  // Acepta hex (64 chars) o base64.
  let buf;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY debe ser de 32 bytes (64 hex chars). Generala con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  cachedKey = buf;
  return cachedKey;
}

// ¿El cifrado está disponible (hay clave)?
export function cifradoDisponible() {
  return Boolean(getKey());
}

// Cifra un string. Si no hay clave, lo devuelve tal cual (texto plano).
export function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  const key = getKey();
  if (!key) return plaintext; // sin clave: no ciframos (evita romper si aún no la configuraron)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

// Desencripta un valor. Si no tiene el prefijo, se asume texto plano (dato viejo).
export function decrypt(value) {
  if (value === null || value === undefined || value === '') return value;
  const s = String(value);
  if (!s.startsWith(PREFIX)) return value; // dato en texto plano (legacy)
  const key = getKey();
  if (!key) throw new Error('Hay datos cifrados pero falta APP_ENCRYPTION_KEY para desencriptarlos.');
  const [, , ivB64, tagB64, ctB64] = s.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
