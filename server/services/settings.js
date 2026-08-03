// Settings por usuario, leídos/escritos en Supabase (reemplaza config.local.json).
// Se usa el cliente Supabase con RLS del usuario (req.supabase), así cada uno
// solo accede a sus propias filas.

import { encrypt, decrypt } from './crypto.js';

// Campos sensibles que se cifran at-rest (por clave de app, no de tabla).
const SENSIBLES = new Set(['accessToken', 'cert', 'key', 'driveClientSecret', 'driveRefreshToken']);

// Devuelve el settings del usuario con las MISMAS keys que usaba el código viejo,
// para que facturador/pdf/exporter/drive sigan funcionando sin cambios de forma.
export async function getSettings(supabase, userId) {
  const [{ data: prof }, { data: afip }, { data: drive }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('afip_credentials').select('*').eq('user_id', userId).single(),
    supabase.from('drive_credentials').select('*').eq('user_id', userId).single(),
  ]);

  const p = prof || {};
  const a = afip || {};
  const d = drive || {};

  return {
    // perfil / emisor
    cuit: p.cuit || '',
    razonSocial: p.razon_social || '',
    condicionIVAEmisor: p.condicion_iva || 'Responsable Monotributo',
    domicilio: p.domicilio || '',
    puntoVenta: p.punto_venta || 1,
    ingresosBrutos: p.ingresos_brutos || '',
    inicioActividades: p.inicio_actividades || '',
    destinoSalida: p.destino_salida || 'local',
    carpetaSalida: p.carpeta_local || '',
    notifEmail: p.notif_email || '',
    // credenciales AFIP (descifradas)
    production: a.production === true,
    accessToken: decrypt(a.access_token) || '',
    cert: decrypt(a.cert) || '',
    key: decrypt(a.key) || '',
    certAlias: a.cert_alias || '',
    // credenciales Drive (descifradas)
    driveClientId: d.client_id || '',
    driveClientSecret: decrypt(d.client_secret) || '',
    driveRefreshToken: decrypt(d.refresh_token) || '',
    driveFolderId: d.folder_id || '',
  };
}

// Mapeo de keys de app -> (tabla, columna).
const PROFILE_MAP = {
  cuit: 'cuit',
  razonSocial: 'razon_social',
  condicionIVAEmisor: 'condicion_iva',
  domicilio: 'domicilio',
  puntoVenta: 'punto_venta',
  ingresosBrutos: 'ingresos_brutos',
  inicioActividades: 'inicio_actividades',
  destinoSalida: 'destino_salida',
  carpetaSalida: 'carpeta_local',
  notifEmail: 'notif_email',
};
const AFIP_MAP = {
  production: 'production',
  accessToken: 'access_token',
  cert: 'cert',
  key: 'key',
  certAlias: 'cert_alias',
};
const DRIVE_MAP = {
  driveClientId: 'client_id',
  driveClientSecret: 'client_secret',
  driveRefreshToken: 'refresh_token',
  driveFolderId: 'folder_id',
};

// Guarda un patch parcial, ruteando cada campo a la tabla correcta.
export async function saveSettings(supabase, userId, patch) {
  const profileUpd = {};
  const afipUpd = {};
  const driveUpd = {};
  for (const [k, rawV] of Object.entries(patch)) {
    const v = SENSIBLES.has(k) ? encrypt(rawV) : rawV;
    if (k in PROFILE_MAP) profileUpd[PROFILE_MAP[k]] = v;
    else if (k in AFIP_MAP) afipUpd[AFIP_MAP[k]] = v;
    else if (k in DRIVE_MAP) driveUpd[DRIVE_MAP[k]] = v;
  }

  // Usamos upsert (no update) para que, si al usuario le falta la fila en
  // afip_credentials/drive_credentials (cuentas nuevas), se cree en vez de
  // actualizar 0 filas y fallar el guardado.
  const ops = [];
  if (Object.keys(profileUpd).length) {
    profileUpd.id = userId;
    ops.push(['profiles', supabase.from('profiles').upsert(profileUpd, { onConflict: 'id' }).select('id')]);
  }
  if (Object.keys(afipUpd).length) {
    afipUpd.user_id = userId;
    afipUpd.updated_at = new Date().toISOString();
    ops.push(['afip_credentials', supabase.from('afip_credentials').upsert(afipUpd, { onConflict: 'user_id' }).select('user_id')]);
  }
  if (Object.keys(driveUpd).length) {
    driveUpd.user_id = userId;
    driveUpd.updated_at = new Date().toISOString();
    ops.push(['drive_credentials', supabase.from('drive_credentials').upsert(driveUpd, { onConflict: 'user_id' }).select('user_id')]);
  }
  const results = await Promise.all(ops.map(([, q]) => q));
  results.forEach((r, i) => {
    const tabla = ops[i][0];
    if (r.error) console.error(`[saveSettings] ${tabla} error:`, r.error.message);
    else console.log(`[saveSettings] ${tabla}: ${r.data?.length ?? 0} fila(s) actualizada(s) para userId=${userId}`);
  });
  const err = results.find((r) => r.error);
  if (err) throw new Error(err.error.message);
  // Si no se actualizó ninguna fila (RLS o fila inexistente), avisamos claro.
  if (results.some((r) => (r.data?.length ?? 0) === 0)) {
    throw new Error('No se pudo guardar: el registro del usuario no se actualizó (revisá permisos/RLS o que exista el perfil).');
  }
  return getSettings(supabase, userId);
}
