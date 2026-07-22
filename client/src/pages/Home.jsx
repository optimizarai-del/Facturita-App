import { useEffect, useState } from 'react';
import { supabase, apiFetch } from '../supabaseClient.js';

const TABS = ['Facturación', 'Dashboard', 'Clientes'];

export default function Home({ session, tema, toggleTema }) {
  const [tab, setTab] = useState('Facturación');
  const [backend, setBackend] = useState(null);

  useEffect(() => {
    // Verifica que el backend Node reconozca el login (Fase 0).
    apiFetch('/api/me')
      .then((r) => r.json())
      .then((d) => setBackend(d))
      .catch(() => setBackend({ error: 'sin conexión al backend' }));
  }, []);

  const iniciales = (session.user.email || '?').slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">🧾</span>
        <span className="brand">FacturitaApp</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <span className="right">
          <button className="theme-btn" onClick={toggleTema} title="Cambiar tema">
            {tema === 'light' ? '☀️' : '🌙'}
          </button>
          <span className="avatar" title={session.user.email}>{iniciales}</span>
          <button className="btn btn-ghost sm" onClick={() => supabase.auth.signOut()}>Salir</button>
        </span>
      </header>

      <main className="content">
        {tab === 'Facturación' && (
          <div className="placeholder">
            <h2>Facturación</h2>
            <p className="muted">Acá va el asistente de facturación (Fases 1-3). En construcción.</p>
          </div>
        )}
        {tab === 'Dashboard' && (
          <div className="placeholder">
            <h2>Dashboard</h2>
            <p className="muted">Historial y métricas de facturas (Fase 5). En construcción.</p>
          </div>
        )}
        {tab === 'Clientes' && (
          <div className="placeholder">
            <h2>Clientes</h2>
            <p className="muted">Gestión de clientes (Fase 4). En construcción.</p>
          </div>
        )}

        <div className="debug">
          <b>Estado de conexión (Fase 0):</b><br />
          Usuario: {session.user.email}<br />
          Backend /api/me: {backend
            ? (backend.error ? `❌ ${backend.error}` : `✅ userId ${backend.userId?.slice(0, 8)}…`)
            : '⏳'}
        </div>
      </main>
    </div>
  );
}
