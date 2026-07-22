import Afip from '@afipsdk/afip.js';

// Construye una instancia de Afip a partir de un objeto settings (de Supabase).
export function getAfipClient(settings) {
  if (!settings.cuit) {
    throw new Error('Falta configurar el CUIT');
  }
  const options = {
    CUIT: Number(settings.cuit),
    production: settings.production === true,
  };
  // AFIP SDK exige access_token incluso en homologación (sin él devuelve 401).
  if (settings.accessToken) options.access_token = settings.accessToken;
  // Certificado y clave privada (necesarios para emitir con CUIT propio).
  if (settings.cert && settings.key) {
    options.cert = settings.cert;
    options.key = settings.key;
  }
  return new Afip(options);
}

// Prueba la conexión consultando el estado de los servidores de AFIP.
export async function testConnection(settings) {
  if (!settings.accessToken) {
    throw new Error(
      'Falta el access_token de AFIP SDK. Obtenelo gratis en https://app.afipsdk.com/ y pegalo en la configuración.'
    );
  }
  const afip = getAfipClient(settings);
  const status = await afip.ElectronicBilling.getServerStatus();
  const ok = status && status.AppServer === 'OK' && status.DbServer === 'OK' && status.AuthServer === 'OK';
  return {
    ok,
    ambiente: settings.production ? 'producción' : 'homologación',
    status,
  };
}

// Genera el certificado con AFIP SDK usando la clave fiscal (uso transitorio),
// autoriza wsfe, y DEVUELVE cert+key (el endpoint los persiste en Supabase).
export async function generarCertificado(settings, { password, username, alias }) {
  if (!settings.cuit) throw new Error('Falta configurar el CUIT.');
  if (!settings.accessToken) throw new Error('Falta el access_token de AFIP SDK. Configuralo primero.');
  if (!password) throw new Error('Falta la clave fiscal.');

  const user = String(username || settings.cuit).trim();
  const certAlias = String(alias || 'facturitaapp').trim();
  const afip = getAfipClient(settings);

  const cert = await afip.CreateCert(user, password, certAlias);
  if (!cert?.cert || !cert?.key) {
    throw new Error('AFIP SDK no devolvió el certificado esperado.');
  }

  let wsauth = 'omitida';
  try {
    await afip.CreateWSAuth(user, password, certAlias, 'wsfe');
    wsauth = 'ok';
  } catch (e) {
    wsauth = `advertencia: ${e?.data?.message || e.message}`;
  }

  return { ok: true, alias: certAlias, wsauth, cert: cert.cert, key: cert.key };
}
