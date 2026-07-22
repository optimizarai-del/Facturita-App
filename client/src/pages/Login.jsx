import { useState } from 'react';
import { supabase } from '../supabaseClient.js';

export default function Login({ tema, toggleTema }) {
  const [modo, setModo] = useState('login'); // 'login' | 'registro'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    setCargando(true);
    try {
      if (modo === 'registro') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg({ tipo: 'ok', txt: 'Cuenta creada. Revisá tu email si pide confirmación, o iniciá sesión.' });
        setModo('login');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // onAuthStateChange en App redirige solo
      }
    } catch (err) {
      setMsg({ tipo: 'err', txt: traducir(err.message) });
    } finally {
      setCargando(false);
    }
  }

  async function google() {
    setMsg(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) setMsg({ tipo: 'err', txt: traducir(error.message) });
  }

  return (
    <div className="auth-wrap">
      <button className="theme-btn abs" onClick={toggleTema} title="Cambiar tema">
        {tema === 'light' ? '☀️' : '🌙'}
      </button>
      <div className="auth-card">
        <div className="auth-logo">🧾</div>
        <h1>FacturitaApp</h1>
        <p className="muted">{modo === 'login' ? 'Iniciá sesión para continuar' : 'Creá tu cuenta'}</p>

        <form onSubmit={submit}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="vos@email.com" required />
          <label>Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" required minLength={6} />

          {msg && <div className={`status ${msg.tipo}`}>{msg.txt}</div>}

          <button className="btn btn-primary full" disabled={cargando} type="submit">
            {cargando ? '...' : (modo === 'login' ? 'Entrar' : 'Crear cuenta')}
          </button>
        </form>

        <div className="divider"><span>o</span></div>
        <button className="btn btn-ghost full" onClick={google} type="button">
          Continuar con Google
        </button>

        <p className="switch-modo">
          {modo === 'login' ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?'}{' '}
          <a onClick={() => { setModo(modo === 'login' ? 'registro' : 'login'); setMsg(null); }}>
            {modo === 'login' ? 'Registrate' : 'Iniciá sesión'}
          </a>
        </p>
      </div>
    </div>
  );
}

function traducir(m) {
  if (/Invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/already registered/i.test(m)) return 'Ese email ya está registrado.';
  if (/provider is not enabled/i.test(m)) return 'El login con Google todavía no está habilitado en Supabase.';
  return m;
}
