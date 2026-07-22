// Settings por usuario, leídos/escritos en Supabase (reemplaza config.local.json).
// Se usa el cliente Supabase con RLS del usuario (req.supabase), así cada uno
// solo accede a sus propias filas.

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
    // credenciales AFIP
    production: a.production === true,
    accessToken: a.access_token || '',
    cert: a.cert || '',
    key: a.key || '',
    certAlias: a.cert_alias || '',
    // credenciales Drive
    driveClientId: d.client_id || '',
    driveClientSecret: d.client_secret || '',
    driveRefreshToken: d.refresh_token || '',
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
  for (const [k, v] of Object.entries(patch)) {
    if (k in PROFILE_MAP) profileUpd[PROFILE_MAP[k]] = v;
    else if (k in AFIP_MAP) afipUpd[AFIP_MAP[k]] = v;
    else if (k in DRIVE_MAP) driveUpd[DRIVE_MAP[k]] = v;
  }

  const ops = [];
  if (Object.keys(profileUpd).length) {
    ops.push(supabase.from('profiles').update(profileUpd).eq('id', userId));
  }
  if (Object.keys(afipUpd).length) {
    afipUpd.updated_at = new Date().toISOString();
    ops.push(supabase.from('afip_credentials').update(afipUpd).eq('user_id', userId));
  }
  if (Object.keys(driveUpd).length) {
    driveUpd.updated_at = new Date().toISOString();
    ops.push(supabase.from('drive_credentials').update(driveUpd).eq('user_id', userId));
  }
  const results = await Promise.all(ops);
  const err = results.find((r) => r.error);
  if (err) throw new Error(err.error.message);
  return getSettings(supabase, userId);
}
