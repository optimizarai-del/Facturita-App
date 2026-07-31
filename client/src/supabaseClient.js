import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);

// Devuelve el access token actual (para llamar al backend Node).
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

// Base del backend. En dev queda vacío (Vite hace proxy de /api a :3000).
// En producción se setea VITE_API_URL con la URL del backend (Railway/Render).
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// fetch al backend con el token de Supabase en el header.
export async function apiFetch(path, options = {}) {
  const token = await getAccessToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(API_BASE + path, { ...options, headers });
}
