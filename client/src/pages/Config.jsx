import { useEffect, useState } from 'react';
import { apiFetch } from '../supabaseClient.js';
import { soportaCarpeta, nombreCarpetaGuardada, elegirCarpeta } from '../fsFolder.js';
import Toggle from '../ui/Toggle.jsx';
import { useConfirm } from '../ui/Confirm.jsx';

const EyeIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {off
      ? <><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a13.2 13.2 0 0 1-1.67 2.68M6.6 6.6C3.6 8.24 2 12 2 12s3 8 10 8a9.3 9.3 0 0 0 5.4-1.6M14.1 14.1a3 3 0 0 1-4.24-4.24" /><path d="m2 2 20 20" /></>
      : <><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>
);

export default function Config() {
  const confirm = useConfirm();
  const [c, setC] = useState(null);
  const [form, setForm] = useState({});
  const [token, setToken] = useState('');
  const [clave, setClave] = useState('');
  const [alias, setAlias] = useState('facturitaapp');
  const [estado, setEstado] = useState(null);
  const [cert, setCert] = useState(null); // {generando, ok}
  const [verClave, setVerClave] = useState(false);
  const [driveSecret, setDriveSecret] = useState('');
  const [driveMsg, setDriveMsg] = useState(null);
  const [carpetaLocal, setCarpetaLocal] = useState(null); // nombre de la carpeta elegida

  useEffect(() => { cargar(); nombreCarpetaGuardada().then(setCarpetaLocal); }, []);

  async function seleccionarCarpeta() {
    try {
      const nombre = await elegirCarpeta();
      setCarpetaLocal(nombre);
      setEstado({ tipo: 'ok', txt: `📁 Carpeta local: ${nombre}` });
    } catch (e) { if (e.name !== 'AbortError') setEstado({ tipo: 'err', txt: 'No se pudo elegir la carpeta.' }); }
  }

  async function cargar() {
    const r = await apiFetch('/api/config');
    const d = await r.json();
    setC(d);
    setForm({
      cuit: d.cuit || '', razonSocial: d.razonSocial || '',
      condicionIVAEmisor: d.condicionIVAEmisor || 'Responsable Monotributo',
      puntoVenta: d.puntoVenta || 1, domicilio: d.domicilio || '',
      ingresosBrutos: d.ingresosBrutos || '', inicioActividades: d.inicioActividades || '',
      destinoSalida: d.destinoSalida || 'local', carpetaSalida: d.carpetaSalida || '',
      production: d.production || false,
      driveClientId: d.driveClientId || '', driveFolderId: d.driveFolderId || '',
    });
    setAlias(d.certAlias || 'facturitaapp');
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function guardar() {
    const body = { ...form };
    if (token.trim()) body.accessToken = token.trim();
    if (driveSecret.trim()) body.driveClientSecret = driveSecret.trim();
    const r = await apiFetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let d = {};
    try { d = await r.json(); } catch { /* sin body */ }
    setEstado(r.ok ? { tipo: 'ok', txt: '✅ Guardado.' } : { tipo: 'err', txt: d.error || 'No se pudo guardar.' });
    if (r.ok) { setToken(''); setDriveSecret(''); cargar(); }
    return r.ok;
  }

  // Guarda las credenciales de Drive y abre el popup de autorización de Google.
  async function conectarDrive() {
    setDriveMsg(null);
    if (!(await guardar())) return;
    const r = await apiFetch('/api/drive/auth-url');
    const d = await r.json();
    if (!r.ok || !d.url) { setDriveMsg({ tipo: 'err', txt: d.error || 'Faltan el Client ID y Secret de Google.' }); return; }
    const popup = window.open(d.url, 'drive-oauth', 'width=520,height=640');
    function onMsg(ev) {
      if (ev.data === 'drive-true') {
        setDriveMsg({ tipo: 'ok', txt: '✅ Google Drive conectado.' });
        cargar(); window.removeEventListener('message', onMsg); try { popup && popup.close(); } catch { /* noop */ }
      } else if (ev.data === 'drive-false') {
        setDriveMsg({ tipo: 'err', txt: 'No se pudo conectar. Revisá las credenciales y volvé a intentar.' });
        window.removeEventListener('message', onMsg);
      }
    }
    window.addEventListener('message', onMsg);
  }

  // Activar producción exige confirmación explícita (emite facturas reales).
  async function handleProduccion(next) {
    if (next) {
      const ok = await confirm({
        tone: 'danger',
        title: 'Activar producción',
        message: 'Las facturas que emitas van a tener validez fiscal real ante AFIP y no se pueden anular desde acá (solo con nota de crédito).',
        confirmText: 'Activar producción',
      });
      if (!ok) return;
    }
    setForm({ ...form, production: next });
  }

  async function probar() {
    await guardar();
    setEstado({ tipo: 'loading', txt: '⏳ Probando conexión con AFIP…' });
    const r = await apiFetch('/api/afip/test', { method: 'POST' });
    const d = await r.json();
    setEstado(d.ok
      ? { tipo: 'ok', txt: `✅ Conexión OK (${d.ambiente}).` }
      : { tipo: 'err', txt: `❌ ${d.error}` });
  }

  async function generarCert() {
    if (!clave) { setCert({ ok: false, msg: 'Ingresá tu clave fiscal.' }); return; }
    await guardar();
    setCert({ generando: true });
    const r = await apiFetch('/api/afip/cert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: clave, alias }),
    });
    const d = await r.json();
    if (d.ok) { setCert({ ok: true, msg: `✅ Certificado generado (wsfe: ${d.wsauth}).` }); setClave(''); cargar(); }
    else setCert({ ok: false, msg: `❌ ${d.error}` });
  }

  if (!c) return <div className="card"><div className="spinner-lg" /></div>;

  return (
    <div className="card">
      <h2>Configuración</h2>

      <h3>Datos del emisor</h3>
      <div className="grid2">
        <div><label>Razón social</label><input value={form.razonSocial} onChange={set('razonSocial')} /></div>
        <div><label>CUIT</label><input value={form.cuit} onChange={set('cuit')} placeholder="27319422590" /></div>
      </div>
      <div className="grid2">
        <div><label>Condición IVA</label>
          <select value={form.condicionIVAEmisor} onChange={set('condicionIVAEmisor')}>
            <option>Responsable Monotributo</option><option>Responsable Inscripto</option><option>Exento</option>
          </select>
        </div>
        <div><label>Punto de venta</label><input value={form.puntoVenta} onChange={set('puntoVenta')} /></div>
      </div>
      <label>Domicilio (opcional)</label><input value={form.domicilio} onChange={set('domicilio')} />
      <div className="grid2">
        <div><label>Ingresos Brutos</label><input value={form.ingresosBrutos} onChange={set('ingresosBrutos')} /></div>
        <div><label>Inicio de actividades</label><input value={form.inicioActividades} onChange={set('inicioActividades')} /></div>
      </div>

      <h3>Conexión AFIP</h3>
      <label>Access token de AFIP SDK {c.tieneAccessToken && <span className="muted">(guardado)</span>}</label>
      <input value={token} onChange={(e) => setToken(e.target.value)} placeholder={c.tieneAccessToken ? '•••••• (dejá vacío para no cambiar)' : 'Pegá tu access token'} />
      <div style={{ marginTop: 14 }}>
        <Toggle checked={!!form.production} onChange={handleProduccion} label="Usar producción (facturas reales)" />
      </div>

      <h3>Destino de salida</h3>
      <div className="grid2">
        <div><label>¿Dónde guardar?</label>
          <select value={form.destinoSalida} onChange={set('destinoSalida')}>
            <option value="local">Carpeta local</option><option value="drive">Google Drive</option><option value="ambos">Ambos</option>
          </select>
        </div>
        <div><label>Carpeta local</label>
          {soportaCarpeta() ? (
            <div className="row" style={{ marginTop: 0 }}>
              <button className="btn btn-ghost" type="button" onClick={seleccionarCarpeta}>📁 Elegir carpeta…</button>
              <span className="muted sm">{carpetaLocal ? `Guardando en: ${carpetaLocal}` : 'Ninguna elegida (se descarga como ZIP)'}</span>
            </div>
          ) : (
            <input value={form.carpetaSalida} onChange={set('carpetaSalida')} placeholder="vacío = carpeta 'salida'" />
          )}
        </div>
      </div>

      <div className="box-inner">
        <div className="box-head">
          <b>Google Drive</b>
          <span className={`pill ${c.driveConectado ? 'ok' : 'err'}`}>{c.driveConectado ? 'conectado ✅' : 'no conectado'}</span>
        </div>
        <p className="muted sm" style={{ margin: '4px 0 10px' }}>Podés reusar el mismo cliente OAuth de Google del login (redirect: <code>http://localhost:3000/api/drive/callback</code>).</p>
        <div className="grid2">
          <div><label>Client ID de Google</label><input value={form.driveClientId || ''} onChange={set('driveClientId')} placeholder="xxxxx.apps.googleusercontent.com" /></div>
          <div><label>Client Secret {c.tieneDriveSecret && <span className="muted">(guardado)</span>}</label>
            <input type="password" value={driveSecret} onChange={(e) => setDriveSecret(e.target.value)} placeholder={c.tieneDriveSecret ? '•••••• (dejá vacío para no cambiar)' : 'Pegá el Client Secret'} /></div>
        </div>
        <label>Carpeta destino en Drive (opcional)</label>
        <input value={form.driveFolderId || ''} onChange={set('driveFolderId')} placeholder="ID de la carpeta (vacío = raíz de tu Drive)" />
        <div className="row">
          <button className="btn btn-blue" onClick={conectarDrive}>☁️ {c.driveConectado ? 'Reconectar' : 'Conectar'} Google Drive</button>
        </div>
        {driveMsg && <div className={`status ${driveMsg.tipo}`}>{driveMsg.txt}</div>}
      </div>

      <div className="row">
        <button className="btn btn-ghost" onClick={guardar}>Guardar</button>
        <button className="btn btn-primary" onClick={probar}>Probar conexión</button>
      </div>
      {estado && <div className={`status ${estado.tipo}`}>{estado.txt}</div>}

      <div className="box-inner">
        <div className="box-head">
          <b>Certificado digital</b>
          <span className={`pill ${c.tieneCertificado ? 'ok' : 'err'}`}>{c.tieneCertificado ? 'configurado ✅' : 'no configurado'}</span>
        </div>
        <p className="aviso">⚠️ Tu clave fiscal se envía a afipsdk.com solo para generar el certificado y no se guarda.</p>
        <label>Clave fiscal de AFIP</label>
        <div className="input-eye">
          <input type={verClave ? 'text' : 'password'} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" />
          <button type="button" className="eye-btn" onClick={() => setVerClave(!verClave)}
            title={verClave ? 'Ocultar' : 'Mostrar'} aria-label={verClave ? 'Ocultar clave' : 'Mostrar clave'}>
            <EyeIcon off={verClave} />
          </button>
        </div>
        <label>Alias</label><input value={alias} onChange={(e) => setAlias(e.target.value)} />
        <div className="row">
          <button className="btn btn-ghost" onClick={generarCert} disabled={cert?.generando}>
            {cert?.generando ? 'Generando… (puede tardar)' : 'Generar certificado'}
          </button>
        </div>
        {cert?.msg && <div className={`status ${cert.ok ? 'ok' : 'err'}`}>{cert.msg}</div>}
      </div>
    </div>
  );
}
