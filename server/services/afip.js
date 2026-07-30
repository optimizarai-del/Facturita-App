import Afip from '@afipsdk/afip.js';

// Construye una instancia de Afip a partir de un objeto settings (de Supabase).
// Token de AFIP SDK: preferimos el de la app (env) y caemos al del usuario (legacy).
export function afipAccessToken(settings = {}) {
  return process.env.AFIPSDK_ACCESS_TOKEN || settings.accessToken || '';
}

export function getAfipClient(settings) {
  if (!settings.cuit) {
    throw new Error('Falta configurar el CUIT');
  }
  const options = {
    CUIT: Number(settings.cuit),
    production: settings.production === true,
  };
  // AFIP SDK exige access_token incluso en homologación (sin él devuelve 401).
  const token = afipAccessToken(settings);
  if (token) options.access_token = token;
  // Certificado y clave privada (necesarios para emitir con CUIT propio).
  if (settings.cert && settings.key) {
    options.cert = settings.cert;
    options.key = settings.key;
  }
  return new Afip(options);
}

// --- Padrón AFIP (constancia de inscripción) ---
// Dado un CUIT, devuelve datos reales del contribuyente: razón social/nombre,
// condición frente al IVA y domicilio. Solo funciona con CUIT (11 dígitos) y
// requiere que el WS de padrón esté habilitado para el certificado.
// Devuelve null si no se puede resolver (para que el front no rompa).
export async function consultarPadron(settings, docRaw) {
  const doc = String(docRaw ?? '').replace(/\D/g, '');
  if (doc.length !== 11) return null; // solo CUIT/CUIL
  const afip = getAfipClient(settings);

  // El SDK expone varios padrones; usamos el A13 (el más disponible).
  const registro = afip.RegisterScopeThirteen || afip.RegisterScopeFive || afip.RegisterScopeFour;
  if (!registro?.getTaxpayerDetails) {
    throw new Error('El web service de Padrón no está disponible en este certificado.');
  }
  let data;
  try {
    data = await registro.getTaxpayerDetails(Number(doc));
  } catch (e) {
    const msg = e?.response?.data?.message || e?.data?.message || e?.message || '';
    // El padrón es un WS aparte: puede no estar autorizado en el cert o no existir
    // en homologación. Damos un mensaje accionable en vez del error crudo del SDK.
    throw new Error(
      'No se pudo consultar el padrón de AFIP. El servicio de padrón puede no estar ' +
      'habilitado para tu certificado o no estar disponible en homologación. ' +
      'Podés completar los datos del cliente a mano.' + (msg ? ` (detalle: ${msg})` : '')
    );
  }
  if (!data) return null;

  const nombre = armarNombre(data);
  const condicionIVA = derivarCondicionDesdePadron(data);
  return {
    documento: doc,
    tipoDoc: 'CUIT',
    nombre,
    condicionIVA, // texto legible
    condicionIVAId: CONDICION_IVA_ID[condicionIVA] ?? null,
    domicilio: armarDomicilio(data),
  };
}

function armarNombre(d) {
  const p = d?.datosGenerales || d || {};
  if (p.razonSocial) return String(p.razonSocial).trim();
  const nom = [p.apellido, p.nombre].filter(Boolean).join(', ');
  return nom || '';
}

function armarDomicilio(d) {
  const dom = d?.datosGenerales?.domicilioFiscal || {};
  return [dom.direccion, dom.localidad, dom.descripcionProvincia].filter(Boolean).join(', ');
}

// Deriva la condición IVA (texto) a partir de la respuesta del padrón.
function derivarCondicionDesdePadron(d) {
  if (d?.datosMonotributo) return 'Responsable Monotributo';
  const rg = d?.datosRegimenGeneral;
  if (rg) {
    const impuestos = (rg.impuesto || []).map((i) => Number(i.idImpuesto));
    // Impuesto 30 = IVA; si está inscripto en IVA => Responsable Inscripto.
    if (impuestos.includes(30)) return 'Responsable Inscripto';
    return 'IVA Sujeto Exento';
  }
  return 'Consumidor Final';
}

// Mapa condición IVA (texto) -> Id de AFIP (RG 5616, campo CondicionIVAReceptorId).
export const CONDICION_IVA_ID = {
  'Responsable Inscripto': 1,
  'IVA Sujeto Exento': 4,
  'Consumidor Final': 5,
  'Responsable Monotributo': 6,
  'Sujeto no Categorizado': 7,
  'Proveedor del Exterior': 8,
  'Cliente del Exterior': 9,
  'IVA No Alcanzado': 15,
};

// Prueba la conexión consultando el estado de los servidores de AFIP.
export async function testConnection(settings) {
  if (!afipAccessToken(settings)) {
    throw new Error(
      'Falta el access token de AFIP SDK a nivel servidor (AFIPSDK_ACCESS_TOKEN).'
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
  if (!afipAccessToken(settings)) throw new Error('Falta el access token de AFIP SDK a nivel servidor (AFIPSDK_ACCESS_TOKEN).');
  if (!password) throw new Error('Falta la clave fiscal.');

  const user = String(username || settings.cuit).trim();
  const certAlias = String(alias || 'facturitaapp').trim();
  const afip = getAfipClient(settings);

  let cert;
  try {
    cert = await afip.CreateCert(user, password, certAlias);
  } catch (e) {
    // El interceptor de afipsdk pone el cuerpo real en e.data (no en e.response.data).
    const body = e?.data ?? e?.response?.data;
    try {
      console.error('[cert] status:', e?.status ?? e?.response?.status);
      console.error('[cert] data:', typeof body === 'string' ? body : JSON.stringify(body));
      console.error('[cert] message:', e?.message);
    } catch { /* noop */ }
    const detalle = body?.message || body?.error || body?.detail || body?.msg
      || (typeof body === 'string' ? body : '') || e.message || '';
    const amb = settings.production === true ? 'producción' : 'homologación';
    throw new Error(
      `AFIP rechazó la generación del certificado en ${amb}. ` +
      'Revisá que el CUIT y la clave fiscal sean correctos y que el access token de AFIP SDK ' +
      `sea válido para ${amb}.` + (detalle ? ` Detalle de AFIP: ${detalle}` : '')
    );
  }
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

  // Autorizar también el padrón (constancia de inscripción) para el autofill de clientes.
  // Es best-effort: si falla o no está disponible, no rompe la generación del cert.
  let padronAuth = 'omitida';
  try {
    await afip.CreateWSAuth(user, password, certAlias, 'ws_sr_constancia_inscripcion');
    padronAuth = 'ok';
  } catch (e) {
    padronAuth = `advertencia: ${e?.data?.message || e.message}`;
  }

  return { ok: true, alias: certAlias, wsauth, padronAuth, cert: cert.cert, key: cert.key };
}
