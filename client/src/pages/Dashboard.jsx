import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase, apiFetch } from '../supabaseClient.js';
import Icon from '../ui/Icon.jsx';

const money = (n) => Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
const fmtFecha = (d) => d ? d.split('-').reverse().join('/') : '-';

const PAGINA = 50;

// yyyy-mm-dd local (sin corrimiento por timezone).
const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

// Devuelve { desde, hasta } (yyyy-mm-dd, inclusive) para el rango elegido.
// null en un extremo = sin límite.
function boundsRango(rango, desde, hasta) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (rango === 'mes') return { desde: ymd(new Date(y, m, 1)), hasta: ymd(new Date(y, m + 1, 0)) };
  if (rango === 'mesAnterior') return { desde: ymd(new Date(y, m - 1, 1)), hasta: ymd(new Date(y, m, 0)) };
  if (rango === '3meses') return { desde: ymd(new Date(y, m - 2, 1)), hasta: ymd(new Date(y, m + 1, 0)) };
  if (rango === 'personalizado') return { desde: desde || null, hasta: hasta || null };
  return { desde: null, hasta: null }; // 'todo'
}

export default function Dashboard() {
  const [facturas, setFacturas] = useState(null);
  const [filtro, setFiltro] = useState('todas'); // todas | emitida | error | programada
  const [visibles, setVisibles] = useState(PAGINA);
  const [verId, setVerId] = useState(null); // factura cuyo PDF se está abriendo
  const [verError, setVerError] = useState(null);
  const [verif, setVerif] = useState({}); // id -> {estado:'ok'|'fail'|'error', txt}
  const [verificandoId, setVerificandoId] = useState(null);
  const [verifTodas, setVerifTodas] = useState(null); // {cargando} | {tipo,txt}
  const [ambiente, setAmbiente] = useState('produccion'); // produccion | pruebas | todos
  const [rango, setRango] = useState('mes'); // mes | mesAnterior | 3meses | todo | personalizado
  const [desde, setDesde] = useState(''); // yyyy-mm-dd (rango personalizado)
  const [hasta, setHasta] = useState('');

  // Recarga las facturas desde Supabase (para refrescar badges persistidos).
  async function recargar() {
    const { data } = await supabase.from('facturas').select('*').order('created_at', { ascending: false }).limit(500);
    const rows = data || [];
    setFacturas(rows);
    const yaVerif = {};
    for (const f of rows) if (f.verificada_arca) yaVerif[f.id] = { estado: 'ok', txt: 'Verificada en ARCA' };
    setVerif(yaVerif);
  }

  // Verifica en ARCA, de una, todas las emitidas que aún no fueron verificadas.
  async function verificarTodas() {
    setVerifTodas({ cargando: true });
    try {
      const r = await apiFetch('/api/facturas/verificar-todas', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) { setVerifTodas({ tipo: 'err', txt: d.error || 'No se pudo verificar el lote.' }); return; }
      await recargar();
      if (d.total === 0) { setVerifTodas({ tipo: 'ok', txt: 'No había facturas pendientes de verificar.' }); return; }
      const extra = [];
      if (d.noEncontradas) extra.push(`${d.noEncontradas} sin coincidencia`);
      if (d.errores) extra.push(`${d.errores} con error`);
      setVerifTodas({
        tipo: d.noEncontradas || d.errores ? 'err' : 'ok',
        txt: `${d.verificadas} verificada(s)${extra.length ? ' · ' + extra.join(' · ') : ''}.`,
      });
    } catch { setVerifTodas({ tipo: 'err', txt: 'Error de red al verificar el lote.' }); }
  }

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
      .then(({ data }) => {
        const rows = data || [];
        setFacturas(rows);
        // Precargar badges de las que ya fueron verificadas en ARCA (persistido en DB).
        const yaVerif = {};
        for (const f of rows) if (f.verificada_arca) yaVerif[f.id] = { estado: 'ok', txt: 'Verificada en ARCA' };
        setVerif(yaVerif);
      });
  }, []);

  // Base: facturas que pasan los filtros de ambiente y rango de fecha.
  const base = useMemo(() => {
    const f = facturas || [];
    const b = boundsRango(rango, desde, hasta);
    const matchAmb = (x) => ambiente === 'todos' ? true
      : ambiente === 'produccion' ? x.ambiente === 'producción'
        : x.ambiente !== 'producción';
    return f.filter((x) => {
      if (!matchAmb(x)) return false;
      const fecha = (x.fecha_emision || x.created_at || '').slice(0, 10);
      if (b.desde && fecha < b.desde) return false;
      if (b.hasta && fecha > b.hasta) return false;
      return true;
    });
  }, [facturas, ambiente, rango, desde, hasta]);

  const metricas = useMemo(() => {
    const emitidas = base.filter((x) => x.estado === 'emitida');
    return {
      facturado: emitidas.reduce((s, x) => s + Number(x.importe || 0), 0),
      emitidas: emitidas.length,
      programadas: base.filter((x) => x.estado === 'programada').length,
      conError: base.filter((x) => x.estado === 'error').length,
    };
  }, [base]);

  const filtradas = useMemo(
    () => filtro === 'todas' ? base : base.filter((x) => x.estado === filtro),
    [base, filtro],
  );

  // Reset del paginado al cambiar de filtro o de los filtros de arriba.
  useEffect(() => { setVisibles(PAGINA); }, [filtro, ambiente, rango, desde, hasta]);

  if (!facturas) return <div className="card"><div className="spinner-lg" /></div>;

  return (
    <div>
      <h2>Dashboard</h2>

      <div className="filtros">
        <div>
          <label>Ambiente</label>
          <select value={ambiente} onChange={(e) => setAmbiente(e.target.value)}>
            <option value="produccion">Producción</option>
            <option value="pruebas">Pruebas</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <div>
          <label>Período</label>
          <select value={rango} onChange={(e) => setRango(e.target.value)}>
            <option value="mes">Mes actual</option>
            <option value="mesAnterior">Mes anterior</option>
            <option value="3meses">Últimos 3 meses</option>
            <option value="todo">Todo</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </div>
        {rango === 'personalizado' && (
          <>
            <div><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          </>
        )}
      </div>

      <div className="metricas" style={{ marginTop: 12 }}>
        <div className="mcard"><span className="lbl">Facturado (período)</span><span className="val">{money(metricas.facturado)}</span></div>
        <div className="mcard"><span className="lbl">Emitidas</span><span className="val ok">{metricas.emitidas}</span></div>
        <div className="mcard"><span className="lbl">Programadas</span><span className="val prog">{metricas.programadas}</span></div>
        <div className="mcard"><span className="lbl">Con error</span><span className="val err">{metricas.conError}</span></div>
      </div>

      <div className="card">
        <div className="row" style={{ marginTop: 0, justifyContent: 'space-between' }}>
          <b>Historial de facturas</b>
          <div className="row" style={{ marginTop: 0, gap: 8 }}>
            <button className="btn btn-ghost sm" disabled={verifTodas?.cargando} onClick={verificarTodas}>
              {verifTodas?.cargando ? 'Verificando…' : <><Icon name="check" size="14" /> Verificar todas</>}
            </button>
            <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: 'auto' }}>
              <option value="todas">Todas</option><option value="emitida">Emitidas</option>
              <option value="programada">Programadas</option><option value="error">Con error</option>
            </select>
          </div>
        </div>
        {verifTodas && !verifTodas.cargando && (
          <div className={`status ${verifTodas.tipo}`} style={{ marginTop: 10 }}>{verifTodas.txt}</div>
        )}
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
                        <td>
                          <span className={`pill ${f.estado === 'emitida' ? 'ok' : err ? 'err' : 'prog'}`}><span className="d" />{f.estado}</span>
                          {f.ambiente !== 'producción' && <span className="muted sm" style={{ marginLeft: 6 }} title="Ambiente de pruebas (sin validez fiscal)">prueba</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {f.estado === 'emitida'
                            ? <div className="acciones">
                                {verif[f.id]
                                  ? <span
                                      className={`pill ${verif[f.id].estado === 'ok' ? 'ok' : 'err'}`}
                                      title={verif[f.id].txt}>
                                      <span className="d" />{verif[f.id].estado === 'ok' ? 'Verificada' : verif[f.id].txt}
                                    </span>
                                  : <button className="btn btn-ghost sm" disabled={verificandoId === f.id} onClick={() => verificarArca(f)}>
                                      {verificandoId === f.id ? '...' : <><Icon name="check" size="14" /> Verificar</>}
                                    </button>}
                                <button className="btn btn-ghost sm" disabled={verId === f.id} onClick={() => verFactura(f)}>
                                  {verId === f.id ? '...' : <><Icon name="file" size="14" /> Ver PDF</>}
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
