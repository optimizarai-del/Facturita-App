import { useState } from 'react';
import { supabase } from '../supabaseClient.js';
import Facturacion from './Facturacion.jsx';
import Dashboard from './Dashboard.jsx';
import Clientes from './Clientes.jsx';

const TABS = ['Facturación', 'Dashboard', 'Clientes'];

export default function Home({ session, tema, toggleTema }) {
  const [tab, setTab] = useState('Facturación');
  const iniciales = (session.user.email || '?').slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">🧾</span>
        <span className="brand">FacturitaApp</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
        <span className="right">
          <button className="theme-btn" onClick={toggleTema} title="Cambiar tema">{tema === 'light' ? '☀️' : '🌙'}</button>
          <span className="avatar" title={session.user.email}>{iniciales}</span>
          <button className="btn btn-ghost sm" onClick={() => supabase.auth.signOut()}>Salir</button>
        </span>
      </header>

      <main className="content">
        {tab === 'Facturación' && <Facturacion />}
        {tab === 'Dashboard' && <Dashboard />}
        {tab === 'Clientes' && <Clientes session={session} />}
      </main>
    </div>
  );
}
