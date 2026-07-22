import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';

export default function App() {
  const [session, setSession] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [tema, setTema] = useState(() => localStorage.getItem('facturita-theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tema);
  }, [tema]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const toggleTema = () => {
    const next = tema === 'dark' ? 'light' : 'dark';
    localStorage.setItem('facturita-theme', next);
    setTema(next);
  };

  if (cargando) {
    return <div className="center"><div className="spinner-lg" /></div>;
  }

  return session
    ? <Home session={session} tema={tema} toggleTema={toggleTema} />
    : <Login tema={tema} toggleTema={toggleTema} />;
}
