import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../supabaseClient.js';
import { nombreCarpetaGuardada, guardarEnCarpeta } from '../fsFolder.js';
import { useConfirm } from '../ui/Confirm.jsx';
import Icon from '../ui/Icon.jsx';
import Config from './Config.jsx';

const money = (n) => isNaN(Number(n)) ? n : Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

export default function Facturacion() {
  const confirm = useConfirm();
  const [seccion, setSeccion] = useState('emitir'); // 'emitir' | 'config'
  const [produccion, setProduccion] = useState(false);
  const [archivo, setArchivo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [estado, setEstado] = useState(null); // {tipo,txt}
  const [cargando, setCargando] = useState(false);
  const fileInputRef = useRef(null);

  // Paso actual del wizard: 1 subir · 2 revisar · 3 emitir.
  const paso = resultado ? 3 : preview ? 2 : 1;

  useEffect(() => {
    apiFetch('/api/config').then((r) => r.json()).then((d) => setProduccion(Boolean(d.production))).catch(() => {});
  }, [seccion]);

  // Confirmación fuerte antes de operar en producción (facturas reales).
  function confirmarProduccion(accion) {
    if (!produccion) return Promise.resolve(true);
    return confirm({
      tone: 'danger',
      title: 'Estás en producción',
      message: `Las facturas que se emitan son reales, tienen validez fiscal ante AFIP y no se pueden borrar (solo anular con nota de crédito).\n\n¿Confirmás ${accion}?`,
      confirmText: 'Sí, emitir',
    });
  }

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

  // Quita el archivo elegido y limpia el preview/estado. Resetea el input para
  // poder volver a elegir el mismo archivo (si no, onChange no dispararía).
  function quitarArchivo() {
    setArchivo(null); setPreview(null); setEstado(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function emitir() {
    if (!archivo) return;
    if (!(await confirmarProduccion('emitir estas facturas ahora'))) return;
    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('generarPdf', 'true'); // siempre generamos el PDF (se necesita para guardar)
    setCargando(true); setEstado({ tipo: 'loading', txt: 'Emitiendo en AFIP…' });
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
    if (!(await confirmarProduccion('programar/emitir estas facturas'))) return;
    const fd = new FormData(); fd.append('archivo', archivo);
    setCargando(true); setEstado({ tipo: 'loading', txt: 'Programando…' });
    try {
      const r = await apiFetch('/api/programar', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) { setEstado({ tipo: 'err', txt: d.error }); return; }
      const partes = [];
      if (d.emitidasAhora) partes.push(`${d.emitidasAhora} emitida(s) ahora`);
      if (d.conErrorAhora) partes.push(`${d.conErrorAhora} con error`);
      if (d.programadas) {
        const fechas = d.fechasFuturas?.length ? ` (${d.fechasFuturas.join(', ')})` : '';
        partes.push(`${d.programadas} programada(s)${fechas}`);
      }
      setEstado({ tipo: d.conErrorAhora ? 'err' : 'ok', txt: partes.join(' · ') || 'Nada para procesar.' });
      // Si se emitió algo ahora, mostramos la tabla; si no, limpiamos.
      if (d.resultado && d.emitidasAhora) setResultado(d.resultado);
      setPreview(null); setArchivo(null);
    } catch { setEstado({ tipo: 'err', txt: 'Error al programar.' }); }
    finally { setCargando(false); }
  }

  const [guardando, setGuardando] = useState(false);
  const [guardadoMsg, setGuardadoMsg] = useState(null);

  async function descargar(path, nombre) {
    const r = await apiFetch(path);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
  }

  // Guarda en local: si el usuario configuró una carpeta, escribe los archivos
  // ahí directamente; si no, descarga un ZIP con el "Guardar como" del navegador.
  async function guardarLocal() {
    setGuardadoMsg(null); setGuardando(true);
    try {
      const carpeta = await nombreCarpetaGuardada();
      if (carpeta) {
        const r = await apiFetch('/api/comprobantes.json');
        const d = await r.json();
        if (!r.ok) { setGuardadoMsg({ tipo: 'err', txt: 'No hay comprobantes para guardar.' }); return; }
        try {
          const out = await guardarEnCarpeta(d.archivos);
          setGuardadoMsg({ tipo: 'ok', txt: `${out.guardados} archivo(s) guardado(s) en "${out.carpeta}".` });
          return;
        } catch (e) {
          if (e.message === 'sin_permiso') { setGuardadoMsg({ tipo: 'err', txt: 'Permiso denegado sobre la carpeta. Volvé a elegirla en Configuración.' }); return; }
          // sin_carpeta u otro: cae al ZIP
        }
      }
      await descargarZip();
    } catch { setGuardadoMsg({ tipo: 'err', txt: 'Error al guardar en local.' }); }
    finally { setGuardando(false); }
  }

  // Descarga el ZIP de comprobantes. Usa el "Guardar como" nativo si el navegador
  // lo soporta (Chrome/Edge); si no, cae en la descarga normal.
  async function descargarZip() {
    setGuardadoMsg(null);
    try {
      const r = await apiFetch('/api/comprobantes.zip');
      if (!r.ok) { setGuardadoMsg({ tipo: 'err', txt: 'No hay comprobantes para descargar.' }); return; }
      const blob = await r.blob();
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: 'comprobantes.zip',
            types: [{ description: 'Archivo ZIP', accept: { 'application/zip': ['.zip'] } }],
          });
          const w = await handle.createWritable(); await w.write(blob); await w.close();
          setGuardadoMsg({ tipo: 'ok', txt: 'Comprobantes guardados en tu carpeta.' });
          return;
        } catch (e) { if (e.name === 'AbortError') return; /* si falla, sigue con descarga normal */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'comprobantes.zip'; a.click();
      URL.revokeObjectURL(url);
      setGuardadoMsg({ tipo: 'ok', txt: 'Descarga iniciada.' });
    } catch { setGuardadoMsg({ tipo: 'err', txt: 'Error al descargar.' }); }
    finally { setGuardando(false); }
  }

  async function guardarEnDrive() {
    setGuardadoMsg(null); setGuardando(true);
    try {
      const r = await apiFetch('/api/drive/subir-ultimo', { method: 'POST' });
      const d = await r.json();
      if (r.status === 409 && d.error === 'no_conectado') {
        setGuardadoMsg({ tipo: 'err', txt: 'Google Drive no está conectado. Andá a Configuración → Google Drive para conectarlo.' });
        return;
      }
      if (!r.ok) { setGuardadoMsg({ tipo: 'err', txt: d.error || 'No se pudo subir a Drive.' }); return; }
      setGuardadoMsg({ tipo: 'ok', txt: `${d.subidos} archivo(s) subido(s) a Drive.`, link: d.link });
    } catch { setGuardadoMsg({ tipo: 'err', txt: 'Error al subir a Drive.' }); }
    finally { setGuardando(false); }
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
          {produccion && (
            <div className="prod-banner">
              <span className="dot" /> Modo <b>PRODUCCIÓN</b> — las facturas que emitas son <b>reales</b> (validez fiscal, no se borran).
            </div>
          )}
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
                  <div className="drop-ic" aria-hidden="true"><Icon name="upload" size="22" /></div>
                  <h3>Elegí tu Excel de facturas</h3>
                  <p>Usá la plantilla (incluye la columna de IVA). Vas a ver un resumen antes de emitir.</p>
                  {archivo && <span className="file-tag"><Icon name="file" size="15" /> {archivo.name}</span>}
                  <input ref={fileInputRef} type="file" accept=".xlsx" hidden onChange={elegir} />
                </label>
                <div className="row">
                  <button className="btn btn-ghost sm" onClick={() => descargar('/api/plantilla', 'plantilla-facturas.xlsx')}><Icon name="download" /> Descargar plantilla</button>
                  {archivo && (
                    <button className="btn btn-ghost sm" disabled={cargando} onClick={quitarArchivo}>
                      <Icon name="trash" /> Quitar archivo
                    </button>
                  )}
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
                  <span className="spacer" />
                  <button className="btn btn-ghost" disabled={bloqueado} onClick={programar}><Icon name="calendar" /> Programar por fecha</button>
                  <button className="btn btn-primary" disabled={bloqueado} onClick={emitir}>
                    {cargando ? '...' : <><Icon name="bolt" /> Emitir ahora</>}
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
                {resultado.resumen.realizadas > 0 && (
                  <div className="save-box">
                    <b>¿Dónde querés guardar los comprobantes?</b>
                    <div className="row" style={{ marginTop: 12 }}>
                      <button className="btn btn-primary" disabled={guardando} onClick={guardarLocal}><Icon name="download" /> Guardar en local</button>
                      <button className="btn btn-blue" disabled={guardando} onClick={guardarEnDrive}><Icon name="cloud" /> Guardar en Google Drive</button>
                    </div>
                    {guardadoMsg && (
                      <div className={`status ${guardadoMsg.tipo}`}>
                        {guardadoMsg.txt}
                        {guardadoMsg.link && <> · <a href={guardadoMsg.link} target="_blank" rel="noreferrer">abrir en Drive ↗</a></>}
                      </div>
                    )}
                  </div>
                )}
                <div className="row" style={{ marginTop: 14 }}>
                  <button className="btn btn-ghost sm" onClick={() => descargar('/api/resultados.xlsx', 'resultados-facturas.xlsx')}><Icon name="download" /> Solo el Excel</button>
                  <button className="btn btn-ghost sm" onClick={() => { setResultado(null); setPreview(null); setArchivo(null); setEstado(null); setGuardadoMsg(null); }}>Emitir otro lote</button>
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
