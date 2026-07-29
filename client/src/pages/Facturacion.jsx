import { useState } from 'react';
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

  // Paso actual del wizard: 1 subir · 2 revisar · 3 emitir.
  const paso = resultado ? 3 : preview ? 2 : 1;

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
      setEstado({ tipo: pendientes === 0 ? 'ok' : 'err', txt: `${realizadas} realizada(s) · ${pendientes} con error` });
    } catch { setEstado({ tipo: 'err', txt: 'Error de red al emitir.' }); }
    finally { setCargando(false); }
  }

  async function programar() {
    if (!archivo) return;
    const fd = new FormData(); fd.append('archivo', archivo);
    setCargando(true); setEstado({ tipo: 'loading', txt: '⏳ Programando…' });
    try {
      const r = await apiFetch('/api/programar', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) { setEstado({ tipo: 'err', txt: d.error }); return; }
      const partes = [];
      if (d.emitidasAhora) partes.push(`⚡ ${d.emitidasAhora} emitida(s) ahora`);
      if (d.conErrorAhora) partes.push(`${d.conErrorAhora} con error`);
      if (d.programadas) {
        const fechas = d.fechasFuturas?.length ? ` (${d.fechasFuturas.join(', ')})` : '';
        partes.push(`📅 ${d.programadas} programada(s)${fechas}`);
      }
      setEstado({ tipo: d.conErrorAhora ? 'err' : 'ok', txt: partes.join(' · ') || 'Nada para procesar.' });
      // Si se emitió algo ahora, mostramos la tabla; si no, limpiamos.
      if (d.resultado && d.emitidasAhora) setResultado(d.resultado);
      setPreview(null); setArchivo(null);
    } catch { setEstado({ tipo: 'err', txt: 'Error al programar.' }); }
    finally { setCargando(false); }
  }

  async function descargar(path, nombre) {
    const r = await apiFetch(path);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
  }

  const bloqueado = cargando || (preview && preview.conError === preview.cantidad);

  return (
    <div>
      <div className="subtabs">
        <button className={seccion === 'emitir' ? 'on' : ''} onClick={() => setSeccion('emitir')}>Emitir</button>
        <button className={seccion === 'config' ? 'on' : ''} onClick={() => setSeccion('config')}>Configuración</button>
      </div>

      {seccion === 'config' && <Config />}

      {seccion === 'emitir' && (
        <>
          <div className="steps">
            <div className={`step ${paso > 1 ? 'done' : 'cur'}`}>
              <span className="n">{paso > 1 ? '✓' : '1'}</span><span className="lbl">Subir Excel</span>
            </div>
            <span className="line" style={paso > 1 ? { background: 'var(--accent)' } : undefined} />
            <div className={`step ${paso > 2 ? 'done' : paso === 2 ? 'cur' : ''}`}>
              <span className="n">{paso > 2 ? '✓' : '2'}</span><span className="lbl">Revisar</span>
            </div>
            <span className="line" style={paso > 2 ? { background: 'var(--accent)' } : undefined} />
            <div className={`step ${paso === 3 ? 'cur' : ''}`}>
              <span className="n">3</span><span className="lbl">Emitir</span>
            </div>
          </div>

          <div className="card">
            {!resultado && (
              <>
                <label className="drop">
                  <div className="drop-ic" aria-hidden="true">⬆️</div>
                  <h3>Elegí tu Excel de facturas</h3>
                  <p>Usá la plantilla (incluye la columna de IVA). Vas a ver un resumen antes de emitir.</p>
                  {archivo && <span className="file-tag">📄 {archivo.name}</span>}
                  <input type="file" accept=".xlsx" hidden onChange={elegir} />
                </label>
                <div className="row">
                  <button className="btn btn-ghost sm" onClick={() => descargar('/api/plantilla', 'plantilla-facturas.xlsx')}>⬇️ Descargar plantilla</button>
                </div>
              </>
            )}

            {preview && !resultado && (
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
                  <label className="tgl"><input type="checkbox" style={{ width: 'auto' }} checked={generarPdf} onChange={(e) => setGenerarPdf(e.target.checked)} /> Generar PDF</label>
                  <label className="tgl"><input type="checkbox" style={{ width: 'auto' }} checked={subirDrive} onChange={(e) => setSubirDrive(e.target.checked)} /> Subir a Drive</label>
                  <span className="spacer" />
                  <button className="btn btn-ghost" disabled={bloqueado} onClick={programar}>📅 Programar por fecha</button>
                  <button className="btn btn-primary" disabled={bloqueado} onClick={emitir}>
                    {cargando ? '...' : 'Emitir ahora ⚡'}
                  </button>
                </div>
                <p className="muted sm" style={{ marginTop: 10 }}>Programar: cada factura se emite sola en su “Fecha de emisión” (las sin fecha, en la próxima corrida).</p>
              </div>
            )}

            {estado && <div className={`status ${estado.tipo}`}>{estado.txt}</div>}

            {resultado && (
              <div className="resultado">
                <div className="chips">
                  <div className="chip"><b>{resultado.resumen.total}</b><span>Total</span></div>
                  <div className="chip ok"><b>{resultado.resumen.realizadas}</b><span>Realizadas</span></div>
                  <div className="chip err"><b>{resultado.resumen.pendientes}</b><span>Con error</span></div>
                </div>
                <div className="row" style={{ marginTop: 0 }}>
                  <button className="btn btn-ghost sm" onClick={() => descargar('/api/resultados.xlsx', 'resultados-facturas.xlsx')}>⬇️ Excel de resultados</button>
                  <button className="btn btn-ghost sm" onClick={() => { setResultado(null); setPreview(null); setArchivo(null); setEstado(null); }}>Emitir otro lote</button>
                </div>
                <div className="tabla-wrap">
                  <table>
                    <thead><tr><th>Fila</th><th>Cliente</th><th>Tipo</th><th>Importe</th><th>Estado</th><th>Detalle</th></tr></thead>
                    <tbody>
                      {resultado.resultados.map((f) => {
                        const ok = f.estado === 'ok';
                        return (
                          <tr key={f.fila}>
                            <td>{f.fila}</td><td>{f.nombre || '-'}</td><td>{f.tipo}</td><td>{money(f.importe)}</td>
                            <td><span className={`pill ${ok ? 'ok' : 'err'}`}><span className="d" />{ok ? 'OK' : 'Error'}</span></td>
                            <td className="detalle">{ok ? `CAE ${f.cae} · ${f.puntoVenta}-${String(f.nroComprobante).padStart(8, '0')}` : f.error}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {resultado.persistencia && <p className="muted sm" style={{ marginTop: 12 }}>Guardadas en tu historial: {resultado.persistencia.guardadas}</p>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
