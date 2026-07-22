import { useEffect, useState } from 'react';
import { apiFetch } from '../supabaseClient.js';
import Config from './Config.jsx';

const money = (n) => isNaN(Number(n)) ? n : Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

export default function Facturacion() {
  const [seccion, setSeccion] = useState('emitir'); // 'emitir' | 'config'
  const [archivo, setArchivo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [estado, setEstado] = useState(null); // {tipo,txt}
  const [cargando, setCargando] = useState(false);
  const [generarPdf, setGenerarPdf] = useState(true);
  const [subirDrive, setSubirDrive] = useState(false);

  async function validar(file) {
    setPreview(null); setResultado(null); setEstado(null);
    if (!file) return;
    const fd = new FormData(); fd.append('archivo', file);
    setCargando(true);
    try {
      const r = await apiFetch('/api/validar', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) { setEstado({ tipo: 'err', txt: d.error }); return; }
      setPreview(d);
    } catch { setEstado({ tipo: 'err', txt: 'Error al validar el archivo.' }); }
    finally { setCargando(false); }
  }

  function elegir(e) {
    const f = e.target.files[0];
    setArchivo(f);
    validar(f);
  }

  async function emitir() {
    if (!archivo) return;
    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('generarPdf', generarPdf ? 'true' : 'false');
    fd.append('subirDrive', subirDrive ? 'true' : 'false');
    setCargando(true); setEstado({ tipo: 'loading', txt: '⏳ Emitiendo en AFIP…' });
    try {
      const r = await apiFetch('/api/facturar', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) { setEstado({ tipo: 'err', txt: d.error }); return; }
      setResultado(d);
      const { realizadas, pendientes } = d.resumen;
      setEstado({ tipo: pendientes === 0 ? 'ok' : 'err', txt: `${realizadas} realizada(s) · ${pendientes} pendiente(s)` });
    } catch { setEstado({ tipo: 'err', txt: 'Error de red al emitir.' }); }
    finally { setCargando(false); }
  }

  async function descargarPlantilla() {
    const r = await apiFetch('/api/plantilla');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'plantilla-facturas.xlsx'; a.click();
    URL.revokeObjectURL(url);
  }

  async function descargarResultados() {
    const r = await apiFetch('/api/resultados.xlsx');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'resultados-facturas.xlsx'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="subtabs">
        <button className={seccion === 'emitir' ? 'on' : ''} onClick={() => setSeccion('emitir')}>Emitir</button>
        <button className={seccion === 'config' ? 'on' : ''} onClick={() => setSeccion('config')}>Configuración</button>
      </div>

      {seccion === 'config' && <Config />}

      {seccion === 'emitir' && (
        <div className="card">
          <h2>Generá tus facturas</h2>
          <p className="muted">Descargá la plantilla, completala y subila. Vas a ver un resumen antes de emitir.</p>

          <div className="row">
            <button className="btn btn-ghost" onClick={descargarPlantilla}>⬇️ Descargar plantilla</button>
            <label className="btn btn-ghost file-btn">
              Elegir Excel…
              <input type="file" accept=".xlsx" hidden onChange={elegir} />
            </label>
            {archivo && <span className="muted">{archivo.name}</span>}
          </div>

          {preview && (
            <div className="preview">
              <div className="chips">
                <div className="chip"><b>{preview.cantidad}</b><span>Filas</span></div>
                <div className="chip"><b>{money(preview.total)}</b><span>Total</span></div>
                <div className={`chip ${preview.conError ? 'err' : 'ok'}`}><b>{preview.conError}</b><span>Con error</span></div>
              </div>
              {preview.problemas.length > 0 && (
                <ul className="problemas">
                  {preview.problemas.map((p, i) => (
                    <li key={i} className={p.nivel}>Fila {p.fila}: {p.motivo}</li>
                  ))}
                </ul>
              )}
              <div className="row">
                <label className="tgl"><input type="checkbox" checked={generarPdf} onChange={(e) => setGenerarPdf(e.target.checked)} /> Generar PDF</label>
                <label className="tgl"><input type="checkbox" checked={subirDrive} onChange={(e) => setSubirDrive(e.target.checked)} /> Subir a Drive</label>
              </div>
              <button className="btn btn-primary" disabled={cargando || preview.conError === preview.cantidad} onClick={emitir}>
                {cargando ? '...' : 'Emitir facturas ⚡'}
              </button>
            </div>
          )}

          {estado && <div className={`status ${estado.tipo}`}>{estado.txt}</div>}

          {resultado && (
            <div className="resultado">
              <div className="chips">
                <div className="chip"><b>{resultado.resumen.total}</b><span>Total</span></div>
                <div className="chip ok"><b>{resultado.resumen.realizadas}</b><span>Realizadas</span></div>
                <div className="chip err"><b>{resultado.resumen.pendientes}</b><span>Pendientes</span></div>
              </div>
              <button className="btn btn-ghost sm" onClick={descargarResultados}>⬇️ Excel de resultados</button>
              <div className="tabla-wrap">
                <table>
                  <thead><tr><th>Fila</th><th>Cliente</th><th>Tipo</th><th>Importe</th><th>Estado</th><th>Detalle</th></tr></thead>
                  <tbody>
                    {resultado.resultados.map((f) => {
                      const ok = f.estado === 'ok';
                      return (
                        <tr key={f.fila}>
                          <td>{f.fila}</td><td>{f.nombre || '-'}</td><td>{f.tipo}</td><td>{money(f.importe)}</td>
                          <td><span className={`pill ${ok ? 'ok' : 'err'}`}>{ok ? 'OK' : 'Error'}</span></td>
                          <td className="detalle">{ok ? `CAE ${f.cae} · ${f.puntoVenta}-${String(f.nroComprobante).padStart(8, '0')}` : f.error}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {resultado.persistencia && <p className="muted sm">Guardadas en tu historial: {resultado.persistencia.guardadas}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
