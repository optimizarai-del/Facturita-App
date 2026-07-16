import Afip from '@afipsdk/afip.js';
import { readSettings, saveSettings } from '../config/settings.js';

// Construye una instancia de Afip a partir de la config guardada.
// En homologación (production=false) no se necesita cert ni access_token:
// AFIP SDK usa credenciales de prueba compartidas.
export async function getAfipClient() {
  const settings = await readSettings();
  if (!settings.cuit) {
    throw new Error('Falta configurar el CUIT');
  }

  const options = {
    CUIT: Number(settings.cuit),
    production: settings.production === true,
  };

  // AFIP SDK exige access_token incluso en homologación (sin él devuelve 401).
  if (settings.accessToken) {
    options.access_token = settings.accessToken;
  }

  // Certificado y clave privada (necesarios para emitir con CUIT propio).
  if (settings.cert && settings.key) {
    options.cert = settings.cert;
    options.key = settings.key;
  }

  return new Afip(options);
}

// Prueba la conexión consultando el estado de los servidores de AFIP.
// Devuelve { ok, ambiente, status } o lanza con un mensaje claro.
export async function testConnection() {
  const settings = await readSettings();
  if (!settings.accessToken) {
    throw new Error(
      'Falta el access_token de AFIP SDK. Obtenelo gratis en https://app.afipsdk.com/ y pegalo en la configuración.'
    );
  }
  const afip = await getAfipClient();
  const status = await afip.ElectronicBilling.getServerStatus();

  // getServerStatus devuelve { AppServer, DbServer, AuthServer } con 'OK'
  const ok =
    status &&
    status.AppServer === 'OK' &&
    status.DbServer === 'OK' &&
    status.AuthServer === 'OK';

  return {
    ok,
    ambiente: settings.production ? 'producción' : 'homologación',
    status,
  };
}

// Genera el certificado y su key con AFIP SDK usando la clave fiscal,
// autoriza el web service de facturación (wsfe) y guarda SOLO cert+key.
// La clave fiscal se usa de forma transitoria y NO se persiste.
export async function generarCertificado({ password, username, alias }) {
  const settings = await readSettings();
  if (!settings.cuit) throw new Error('Falta configurar el CUIT.');
  if (!settings.accessToken) {
    throw new Error('Falta el access_token de AFIP SDK. Configuralo primero.');
  }
  if (!password) throw new Error('Falta la clave fiscal.');

  const user = String(username || settings.cuit).trim();
  const certAlias = String(alias || 'facturitaapp').trim();
  const afip = await getAfipClient();

  // 1) Generar el certificado (dev u prod según production).
  const cert = await afip.CreateCert(user, password, certAlias);
  if (!cert?.cert || !cert?.key) {
    throw new Error('AFIP SDK no devolvió el certificado esperado.');
  }

  // 2) Autorizar el web service de facturación electrónica (wsfe).
  let wsauth = 'omitida';
  try {
    await afip.CreateWSAuth(user, password, certAlias, 'wsfe');
    wsauth = 'ok';
  } catch (e) {
    // En homologación a veces ya está autorizado; no es bloqueante.
    wsauth = `advertencia: ${e?.data?.message || e.message}`;
  }

  // 3) Persistir SOLO cert + key (nunca la clave fiscal).
  await saveSettings({ cert: cert.cert, key: cert.key, certAlias });

  return { ok: true, alias: certAlias, wsauth };
}
