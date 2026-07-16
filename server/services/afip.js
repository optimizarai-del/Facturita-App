import Afip from '@afipsdk/afip.js';
import { readSettings } from '../config/settings.js';

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
