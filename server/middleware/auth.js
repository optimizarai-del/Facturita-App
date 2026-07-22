import { getUserFromToken, supabaseForUser } from '../services/supabase.js';

// Middleware que exige un usuario logueado. Espera el header:
//   Authorization: Bearer <supabase access token>
// Si es válido, expone req.userId, req.userEmail y req.supabase (cliente con RLS del usuario).
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = await getUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: 'No autorizado. Iniciá sesión.' });
    }
    req.userId = user.id;
    req.userEmail = user.email;
    req.accessToken = token;
    req.supabase = supabaseForUser(token);
    next();
  } catch (err) {
    console.error('Error de auth:', err.message);
    res.status(401).json({ error: 'No autorizado.' });
  }
}
