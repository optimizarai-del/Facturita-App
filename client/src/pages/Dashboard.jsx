import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase, apiFetch } from '../supabaseClient.js';
import Icon from '../ui/Icon.jsx';

const money = (n) => Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
const fmtFecha = (d) => d ? d.split('-').reverse().join('/') : '-';

const PAGINA = 50;

export default function Dashboard() {
  const [facturas, setFacturas] = useState(null);
  const [filtro, setFiltro] = useState('todas'); // todas | emitida | error | programada
  const [visibles, setVisibles] = useState(PAGINA);
  const [verId, setVerId] = useState(null); // factura cuyo PDF se está abriendo
  const [verError, setVerError] = useState(null);
  const [verif, setVerif] = useState({}); // id -> {estado:'ok'|'fail'|'error', txt}
  const [verificandoId, setVerificandoId] = useState(null);

  // Consulta el comprobante en ARCA (FECompConsultar) y muestra un badge.
  async function verificarArca(f) {
    setVerificandoId(f.id);
    try {
      const r = await apiFetch(`/api/factura/${f.id}/verificar`);
      const d = await r.json();
      if (!r.ok) { setVerif((v) => ({ ...v, [f.id]: { estado: 'error', txt: d.error || 'Error al verificar.' } })); return; }
      if (d.verificada) setVerif((v) => ({ ...v, [f.id]: { estado: 'ok', txt: 'Verificada en ARCA' } }));
      else if (!d.arca?.existe) setVerif((v) => ({ ...v, [f.id]: { estado: 'fail', txt: 'ARCA no la encuentra' } }));
      else setVerif((v) => ({ ...v, [f.id]: { estado: 'fail', txt: 'No coincide con ARCA' } }));
    } catch { setVerif((v) => ({ ...v, [f.id]: { estado: 'error', txt: 'Error de red.' } })); }
    finally { setVerificandoId(null); }
  }

  // Abre el PDF de una factura emitida en una pestaña nueva.
  async function verFactura(f) {
    setVerError(null); setVerId(f.id);
    const win = window.open('', '_blank'); // abrir ya (evita el bloqueo de popups)
    try {
      const r = await apiFetch(`/api/factura/${f.id}/pdf`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (win) win.close();
        setVerError(d.error || 'No se pudo abrir la factura.');
        return;
      }
      const url = URL.createObjectURL(await r.blob());
      if (win) win.location = url; else window.open(url, '_blank');
    } catch {
      if (win) win.close();
      setVerError('Error al abrir la factura.');
    } finally { setVerId(null); }
  }

  useEffect(() => {
    supabase.from('facturas').select('*').order('created_at', { ascending: false }).limit(500)
      .then(({ data }) => setFacturas(data || []));
  }, []);

  const metricas = useMemo(() => {
    const f = facturas || [];
    const emitidas = f.filter((x) => x.estado === 'emitida');
    const mesActual = new Date().toISOString().slice(0, 7);
    const facturadoMes = emitidas
      .filter((x) => (x.fecha_emision || x.created_at || '').startsWith(mesActual))
      .reduce((s, x) => s + Number(x.importe || 0), 0);
    return {
      facturadoMes,
      emitidas: emitidas.length,
      programadas: f.filter((x) => x.estado === 'programada').length,
      conError: f.filter((x) => x.estado === 'error').length,
    };
  }, [facturas]);

  const filtradas = useMemo(() => {
    const f = facturas || [];
    return filtro === 'todas' ? f : f.filter((x) => x.estado === filtro);
  }, [facturas, filtro]);

  // Reset del paginado al cambiar de filtro.
  useEffect(() => { setVisibles(PAGINA); }, [filtro]);

  if (!facturas) return <div className="card"><div className="spinner-lg" /></div>;

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="metricas">
        <div className="mcard"><span className="lbl">Facturado (mes)</span><span className="val">{money(metricas.facturadoMes)}</span></div>
        <div className="mcard"><span className="lbl">Emitidas</span><span className="val ok">{metricas.emitidas}</span></div>
        <div className="mcard"><span className="lbl">Programadas</span><span className="val prog">{metricas.programadas}</span></div>
        <div className="mcard"><span className="lbl">Con error</span><span className="val err">{metricas.conError}</span></div>
      </div>

      <div className="card">
        <div className="row" style={{ marginTop: 0, justifyContent: 'space-between' }}>
          <b>Historial de facturas</b>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: 'auto' }}>
            <option value="todas">Todas</option><option value="emitida">Emitidas</option>
            <option value="programada">Programadas</option><option value="error">Con error</option>
          </select>
        </div>
        {filtradas.length === 0 ? (
          <p className="muted" style={{ marginTop: 16 }}>Todavía no hay facturas. Emití desde la pestaña Facturación.</p>
        ) : (
          <>
          {verError && <div className="status err" style={{ marginTop: 12 }}>{verError}</div>}
          <div className="tabla-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>N°</th><th>Importe</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {filtradas.slice(0, visibles).map((f) => {
                  const prog = f.estado === 'programada';
                  const err = f.estado === 'error';
                  return (
                    <Fragment key={f.id}>
                      <tr>
                        <td>{prog
                          ? <span title="Se emite en esta fecha"><Icon name="calendar" size="13" /> {fmtFecha(f.fecha_emision)}</span>
                          : fmtFecha(f.fecha_emision)}</td>
                        <td>{f.nombre_cliente || '-'}</td>
                        <td>{f.tipo || '-'}</td>
                        <td>{f.nro_comprobante ? `${f.punto_venta}-${String(f.nro_comprobante).padStart(8, '0')}` : '-'}</td>
                        <td>{money(f.importe)}</td>
                        <td><span className={`pill ${f.estado === 'emitida' ? 'ok' : err ? 'err' : 'prog'}`}><span className="d" />{f.estado}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          {f.estado === 'emitida'
                            ? <div className="row" style={{ marginTop: 0, gap: 6, justifyContent: 'flex-end' }}>
                                {verif[f.id]
                                  ? <span
                                      className={`pill ${verif[f.id].estado === 'ok' ? 'ok' : 'err'}`}
                                      title={verif[f.id].estado === 'error' ? verif[f.id].txt : undefined}>
                                      <span className="d" />{verif[f.id].txt}
                                    </span>
                                  : <button className="btn btn-ghost sm" disabled={verificandoId === f.id} onClick={() => verificarArca(f)}>
                                      {verificandoId === f.id ? '...' : <><Icon name="check" size="14" /> Verificar en ARCA</>}
                                    </button>}
                                <button className="btn btn-ghost sm" disabled={verId === f.id} onClick={() => verFactura(f)}>
                                  {verId === f.id ? '...' : <><Icon name="file" size="14" /> Ver factura</>}
                                </button>
                              </div>
                            : prog ? <span className="muted sm">en cola</span> : ''}
                        </td>
                      </tr>
                      {err && f.error_msg && (
                        <tr className="detalle-row">
                          <td colSpan={7}>
                            <span className="err-badge"><Icon name="alert" size="14" /> {f.error_msg}</span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {filtradas.length > visibles && (
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn btn-ghost sm" onClick={() => setVisibles((v) => v + PAGINA)}>
                  Ver más ({filtradas.length - visibles} restantes)
                </button>
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
