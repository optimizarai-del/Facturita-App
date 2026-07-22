import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON) {
  console.warn('⚠️  Faltan SUPABASE_URL / SUPABASE_ANON_KEY en el .env del server.');
}

// Cliente con la clave pública, usado para verificar el JWT del usuario.
export const supabaseAnon = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Cliente "en nombre del usuario": respeta RLS usando el access token del usuario.
// Con esto el backend lee/escribe solo las filas del usuario logueado.
export function supabaseForUser(accessToken) {
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Cliente con service role (bypassea RLS). Solo para tareas de servidor sin
// usuario en contexto, como el scheduler (Fase 7). Requiere la clave secreta.
export function supabaseService() {
  if (!SERVICE) {
    throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY (necesaria para tareas del servidor).');
  }
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Verifica un access token de Supabase y devuelve el usuario (o null).
export async function getUserFromToken(accessToken) {
  if (!accessToken) return null;
  const { data, error } = await supabaseAnon.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
}
