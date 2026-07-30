import { useEffect, useState } from 'react';
import { supabase, apiFetch } from '../supabaseClient.js';
import { useConfirm } from '../ui/Confirm.jsx';
import Icon from '../ui/Icon.jsx';

export default function Clientes({ session }) {
  const confirm = useConfirm();
  const [clientes, setClientes] = useState(null);
  const [form, setForm] = useState({ nombre: '', documento: '', email: '', condicionIVA: '' });
  const [estado, setEstado] = useState(null);
  const [buscando, setBuscando] = useState(false);

  async function cargar() {
    const { data } = await supabase.from('clientes').select('*').order('nombre');
    setClientes(data || []);
  }
  useEffect(() => { cargar(); }, []);

  // Autocompleta desde el padrón de AFIP cuando el documento es un CUIT (11 dígitos).
  async function buscarPadron() {
    const doc = form.documento.replace(/\D/g, '');
    if (doc.length !== 11) return; // solo CUIT
    setEstado(null);
    setBuscando(true);
    try {
      const r = await apiFetch(`/api/padron?doc=${doc}`);
      const d = await r.json();
      if (!r.ok) { setEstado({ tipo: 'err', txt: d.error || 'No se pudo consultar el padrón.' }); return; }
      setForm((f) => ({
        ...f,
        nombre: d.nombre || f.nombre,
        condicionIVA: d.condicionIVA || f.condicionIVA,
      }));
      setEstado({ tipo: 'ok', txt: `Datos traídos de AFIP: ${d.condicionIVA || 'sin condición'}.` });
    } catch {
      setEstado({ tipo: 'err', txt: 'Error de red al consultar el padrón.' });
    } finally {
      setBuscando(false);
    }
  }

  async function agregar(e) {
    e.preventDefault();
    setEstado(null);
    const doc = form.documento.replace(/\D/g, '');
    const { error } = await supabase.from('clientes').insert({
      user_id: session.user.id,
      nombre: form.nombre,
      documento: doc,
      tipo_doc: doc.length === 11 ? 'CUIT' : doc ? 'DNI' : '',
      condicion_iva: form.condicionIVA || '',
      email: form.email,
    });
    if (error) setEstado({ tipo: 'err', txt: error.message.includes('duplicate') ? 'Ya existe un cliente con ese documento.' : error.message });
    else { setForm({ nombre: '', documento: '', email: '', condicionIVA: '' }); cargar(); }
  }

  async function borrar(id, nombre) {
    const ok = await confirm({
      tone: 'danger',
      title: 'Borrar cliente',
      message: `¿Seguro que querés borrar a "${nombre}"? Esta acción no se puede deshacer.`,
      confirmText: 'Borrar',
    });
    if (!ok) return;
    await supabase.from('clientes').delete().eq('id', id);
    cargar();
  }

  if (!clientes) return <div className="card"><div className="spinner-lg" /></div>;

  return (
    <div>
      <h2>Clientes</h2>
      <div className="card">
        <form onSubmit={agregar}>
          <div className="grid3">
            <div>
              <label>CUIT / DNI</label>
              <input
                value={form.documento}
                onChange={(e) => setForm({ ...form, documento: e.target.value })}
                onBlur={buscarPadron}
                placeholder="Ingresá el CUIT y salí del campo"
              />
            </div>
            <div><label>Nombre / Razón social</label><input value={form.nombre} required onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
            <div><label>Email (opcional)</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div className="grid2">
            <div>
              <label>Condición IVA</label>
              <select value={form.condicionIVA} onChange={(e) => setForm({ ...form, condicionIVA: e.target.value })}>
                <option value="">(sin especificar)</option>
                <option>Responsable Inscripto</option>
                <option>Responsable Monotributo</option>
                <option>IVA Sujeto Exento</option>
                <option>Consumidor Final</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={buscarPadron} disabled={buscando || form.documento.replace(/\D/g, '').length !== 11}>
                {buscando ? 'Consultando AFIP…' : <><Icon name="search" /> Traer datos de AFIP</>}
              </button>
            </div>
          </div>
          <div className="row"><button className="btn btn-primary" type="submit">Agregar cliente</button></div>
        </form>
        {estado && <div className={`status ${estado.tipo}`}>{estado.txt}</div>}
      </div>

      <div className="card">
        <b>Mis clientes ({clientes.length})</b>
        {clientes.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>Todavía no cargaste clientes. Se crean solos al facturar, o agregalos acá.</p>
        ) : (
          <div className="tabla-wrap">
            <table>
              <thead><tr><th>Nombre</th><th>Documento</th><th>Condición IVA</th><th>Email</th><th></th></tr></thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nombre}</td><td>{c.documento || '-'}</td><td>{c.condicion_iva || '-'}</td><td>{c.email || '-'}</td>
                    <td><button className="btn btn-ghost sm" onClick={() => borrar(c.id, c.nombre)}>Borrar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
