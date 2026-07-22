import { useEffect, useState } from 'react';
import { apiFetch } from '../supabaseClient.js';

export default function Config() {
  const [c, setC] = useState(null);
  const [form, setForm] = useState({});
  const [token, setToken] = useState('');
  const [clave, setClave] = useState('');
  const [alias, setAlias] = useState('facturitaapp');
  const [estado, setEstado] = useState(null);
  const [cert, setCert] = useState(null); // {generando, ok}

  useEffect(() => { cargar(); }, []);

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
    });
    setAlias(d.certAlias || 'facturitaapp');
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function guardar() {
    const body = { ...form };
    if (token.trim()) body.accessToken = token.trim();
    const r = await apiFetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    setEstado(r.ok ? { tipo: 'ok', txt: '✅ Guardado.' } : { tipo: 'err', txt: 'No se pudo guardar.' });
    if (r.ok) { setToken(''); cargar(); }
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
      <label className="tgl" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={form.production} onChange={set('production')} /> Usar producción (facturas reales)
      </label>

      <h3>Destino de salida</h3>
      <div className="grid2">
        <div><label>¿Dónde guardar?</label>
          <select value={form.destinoSalida} onChange={set('destinoSalida')}>
            <option value="local">Carpeta local</option><option value="drive">Google Drive</option><option value="ambos">Ambos</option>
          </select>
        </div>
        <div><label>Carpeta local</label><input value={form.carpetaSalida} onChange={set('carpetaSalida')} placeholder="vacío = carpeta 'salida'" /></div>
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
        <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" />
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
