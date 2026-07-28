import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient.js';

const money = (n) => Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
const fmtFecha = (d) => d ? d.split('-').reverse().join('/') : '-';

const PAGINA = 50;

export default function Dashboard() {
  const [facturas, setFacturas] = useState(null);
  const [filtro, setFiltro] = useState('todas'); // todas | emitida | error | programada
  const [visibles, setVisibles] = useState(PAGINA);

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
          <div className="tabla-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>N°</th><th>Importe</th><th>Estado</th></tr></thead>
              <tbody>
                {filtradas.slice(0, visibles).map((f) => {
                  const prog = f.estado === 'programada';
                  return (
                    <tr key={f.id}>
                      <td>{prog
                        ? <span title="Se emite en esta fecha">📅 {fmtFecha(f.fecha_emision)}</span>
                        : fmtFecha(f.fecha_emision)}</td>
                      <td>{f.nombre_cliente || '-'}</td>
                      <td>{f.tipo || '-'}</td>
                      <td>{f.nro_comprobante ? `${f.punto_venta}-${String(f.nro_comprobante).padStart(8, '0')}` : '-'}</td>
                      <td>{money(f.importe)}</td>
                      <td><span className={`pill ${f.estado === 'emitida' ? 'ok' : f.estado === 'error' ? 'err' : 'prog'}`}><span className="d" />{f.estado}</span></td>
                    </tr>
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
        )}
      </div>
    </div>
  );
}
