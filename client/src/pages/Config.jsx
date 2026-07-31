import { useEffect, useState } from 'react';
import { apiFetch } from '../supabaseClient.js';
import { soportaCarpeta, nombreCarpetaGuardada, elegirCarpeta } from '../fsFolder.js';
import Toggle from '../ui/Toggle.jsx';
import Icon from '../ui/Icon.jsx';
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
  const [driveMsg, setDriveMsg] = useState(null);
  const [carpetaLocal, setCarpetaLocal] = useState(null); // nombre de la carpeta elegida

  useEffect(() => { cargar(); nombreCarpetaGuardada().then(setCarpetaLocal); }, []);

  async function seleccionarCarpeta() {
    try {
      const nombre = await elegirCarpeta();
      setCarpetaLocal(nombre);
      setEstado({ tipo: 'ok', txt: `Carpeta local: ${nombre}` });
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

  async function guardar(silencioso = false) {
    const body = { ...form };
    if (token.trim()) body.accessToken = token.trim();
    const r = await apiFetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let d = {};
    try { d = await r.json(); } catch { /* sin body */ }
    if (!silencioso) setEstado(r.ok ? { tipo: 'ok', txt: 'Guardado.' } : { tipo: 'err', txt: d.error || 'No se pudo guardar.' });
    if (r.ok) { setToken(''); cargar(); }
    return r.ok;
  }

  // Guarda las credenciales de Drive y abre el popup de autorización de Google.
  async function conectarDrive() {
    setDriveMsg(null);
    if (!(await guardar(true))) return; // guarda en silencio (no muestra "Guardado")
    const r = await apiFetch('/api/drive/auth-url');
    const d = await r.json();
    if (!r.ok || !d.url) { setDriveMsg({ tipo: 'err', txt: d.error || 'Faltan el Client ID y Secret de Google.' }); return; }
    const popup = window.open(d.url, 'drive-oauth', 'width=520,height=640');
    function onMsg(ev) {
      if (ev.data === 'drive-true') {
        setDriveMsg({ tipo: 'ok', txt: 'Google Drive conectado.' });
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

  async function generarCert() {
    if (!clave) { setCert({ ok: false, msg: 'Ingresá tu clave fiscal.' }); return; }
    await guardar();
    setCert({ generando: true });
    const r = await apiFetch('/api/afip/cert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: clave, alias }),
    });
    const d = await r.json();
    if (d.ok) { setCert({ ok: true, msg: `Certificado generado (wsfe: ${d.wsauth}).` }); setClave(''); cargar(); }
    else setCert({ ok: false, msg: `${d.error}` });
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
      <label>Domicilio (opcional)</label><input value={form.domicilio} onChange={set('domicilio')} autoComplete="off" />

      <h3>Ambiente</h3>
      <Toggle checked={!!form.production} onChange={handleProduccion} label="Usar producción (facturas reales)" />

      <h3>Carpeta local</h3>
      {soportaCarpeta() ? (
        <div className="row" style={{ marginTop: 0 }}>
          <button className="btn btn-ghost" type="button" onClick={seleccionarCarpeta}><Icon name="folder" /> Elegir carpeta…</button>
          <span className="muted sm">{carpetaLocal ? `Guardando en: ${carpetaLocal}` : 'Ninguna elegida (se descarga como ZIP)'}</span>
        </div>
      ) : (
        <input value={form.carpetaSalida} onChange={set('carpetaSalida')} placeholder="vacío = carpeta 'salida'" autoComplete="off" />
      )}

      <div className="box-inner">
        <div className="box-head">
          <b>Google Drive</b>
          <span className={`pill ${c.driveConectado ? 'ok' : 'err'}`}><span className="d" />{c.driveConectado ? 'conectado' : 'no conectado'}</span>
        </div>
        {c.driveDisponible ? (
          <>
            <p className="muted sm" style={{ margin: '4px 0 12px' }}>Conectá tu Google Drive con un click para guardar ahí los comprobantes.</p>
            <label>Carpeta destino en Drive (opcional)</label>
            <input value={form.driveFolderId || ''} onChange={set('driveFolderId')} placeholder="ID de la carpeta (vacío = raíz de tu Drive)"
              name="drive-folder-id" autoComplete="off" data-lpignore="true" data-1p-ignore />
            <div className="row">
              <button className="btn btn-blue" onClick={conectarDrive}><Icon name="cloud" /> {c.driveConectado ? 'Reconectar' : 'Conectar'} Google Drive</button>
            </div>
          </>
        ) : (
          <p className="aviso" style={{ marginTop: 10 }}>Google Drive todavía no está configurado en el servidor (falta cargar las credenciales de la app).</p>
        )}
        {driveMsg && <div className={`status ${driveMsg.tipo}`}>{driveMsg.txt}</div>}
      </div>

      <div className="row">
        <button className="btn btn-primary" onClick={guardar}>Guardar</button>
      </div>
      {estado && <div className={`status ${estado.tipo}`}>{estado.txt}</div>}

      <div className="box-inner">
        <div className="box-head">
          <b>Certificado digital</b>
          <span className={`pill ${c.tieneCertificado ? 'ok' : 'err'}`}><span className="d" />{c.tieneCertificado ? 'configurado' : 'no configurado'}</span>
        </div>
        <p className="aviso"><Icon name="alert" size="15" /> Tu clave fiscal se envía a afipsdk.com solo para generar el certificado y no se guarda.</p>
        <label>Clave fiscal de AFIP</label>
        <div className="input-eye">
          <input type={verClave ? 'text' : 'password'} value={clave} onChange={(e) => setClave(e.target.value)}
            name="afip-clave-fiscal" autoComplete="new-password" data-lpignore="true" data-1p-ignore />
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
