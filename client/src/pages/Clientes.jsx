import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient.js';

export default function Clientes({ session }) {
  const [clientes, setClientes] = useState(null);
  const [form, setForm] = useState({ nombre: '', documento: '', email: '' });
  const [estado, setEstado] = useState(null);

  async function cargar() {
    const { data } = await supabase.from('clientes').select('*').order('nombre');
    setClientes(data || []);
  }
  useEffect(() => { cargar(); }, []);

  async function agregar(e) {
    e.preventDefault();
    setEstado(null);
    const doc = form.documento.replace(/\D/g, '');
    const { error } = await supabase.from('clientes').insert({
      user_id: session.user.id,
      nombre: form.nombre,
      documento: doc,
      tipo_doc: doc.length === 11 ? 'CUIT' : doc ? 'DNI' : '',
      email: form.email,
    });
    if (error) setEstado({ tipo: 'err', txt: error.message.includes('duplicate') ? 'Ya existe un cliente con ese documento.' : error.message });
    else { setForm({ nombre: '', documento: '', email: '' }); cargar(); }
  }

  async function borrar(id) {
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
            <div><label>Nombre / Razón social</label><input value={form.nombre} required onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
            <div><label>CUIT / DNI</label><input value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} /></div>
            <div><label>Email (opcional)</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
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
              <thead><tr><th>Nombre</th><th>Documento</th><th>Email</th><th></th></tr></thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nombre}</td><td>{c.documento || '-'}</td><td>{c.email || '-'}</td>
                    <td><button className="btn btn-ghost sm" onClick={() => borrar(c.id)}>Borrar</button></td>
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
