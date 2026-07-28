import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient.js';
import Facturacion from './Facturacion.jsx';
import Dashboard from './Dashboard.jsx';
import Clientes from './Clientes.jsx';

const TABS = [
  { key: 'Facturación', ic: '🧾', label: 'Facturación' },
  { key: 'Dashboard', ic: '📊', label: 'Panel' },
  { key: 'Clientes', ic: '👥', label: 'Clientes' },
];

export default function Home({ session, tema, toggleTema }) {
  const [tab, setTab] = useState('Facturación');
  const [nClientes, setNClientes] = useState(null);
  const email = session.user.email || '';
  const iniciales = email.slice(0, 2).toUpperCase();

  useEffect(() => {
    supabase.from('clientes').select('id', { count: 'exact', head: true })
      .then(({ count }) => setNClientes(count ?? 0));
  }, [tab]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-row">
          <span className="logo">🧾</span>
          <span className="brand">FacturitaApp</span>
        </div>
        <div className="nav-lbl">Trabajo</div>
        {TABS.map((t) => (
          <button key={t.key} className={`nav ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <span className="ic" aria-hidden="true">{t.ic}</span>
            {t.label}
            {t.key === 'Clientes' && nClientes != null && <span className="count">{nClientes}</span>}
          </button>
        ))}
        <div className="grow" />
        <div className="user-chip">
          <span className="avatar" title={email}>{iniciales}</span>
          <span className="u-name">{email.split('@')[0]}<small>Tu cuenta</small></span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="page-title">{TABS.find((t) => t.key === tab)?.label}</span>
          <span className="right">
            <button className="theme-btn" onClick={toggleTema} title="Cambiar tema">{tema === 'light' ? '☀️' : '🌙'}</button>
            <button className="btn btn-ghost sm" onClick={() => supabase.auth.signOut()}>Salir</button>
          </span>
        </header>
        <main className="content">
          {tab === 'Facturación' && <Facturacion />}
          {tab === 'Dashboard' && <Dashboard />}
          {tab === 'Clientes' && <Clientes session={session} />}
        </main>
      </div>
    </div>
  );
}
