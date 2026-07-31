# Deploy de FacturitaApp

Arquitectura: **frontend en Vercel** (estático) + **backend en Railway o Render**
(servidor Node persistente, necesario por el scheduler, los archivos y AFIP SDK).

---

## 1) Backend en Railway (recomendado) o Render

### Railway
1. Entrá a https://railway.app → **New Project → Deploy from GitHub repo** → elegí
   `optimizarai-del/Facturita-App`, rama `v2`.
2. Railway detecta Node y usa `npm start` (`node server/index.js`) del `Procfile`.
3. En **Variables**, cargá TODO esto (los mismos valores del `.env` local):
   ```
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   APP_ENCRYPTION_KEY=...
   OAUTH_STATE_SECRET=...
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   AFIPSDK_ACCESS_TOKEN=...
   SMTP_HOST=...  SMTP_PORT=...  SMTP_USER=...  SMTP_PASS=...  MAIL_FROM=...
   CLIENT_ORIGIN=https://TU-APP.vercel.app
   OAUTH_REDIRECT_URI=https://TU-BACKEND.up.railway.app/api/drive/callback
   ```
   > No pongas `PORT`: Railway lo inyecta solo.
4. Deploy. Railway te da una URL pública, ej. `https://facturita-api.up.railway.app`.
   Esa es la **URL del backend** (la vas a necesitar en Vercel y en Google).

### Render (alternativa)
- **New → Web Service** → repo `Facturita-App`, rama `v2`.
- Build: `npm install` · Start: `node server/index.js`.
- Mismas variables de entorno que arriba.

---

## 2) Frontend en Vercel

1. Entrá a https://vercel.com → **Add New → Project** → importá `Facturita-App`.
2. **Root Directory**: `client`  ← importante (el frontend vive ahí).
3. Framework: **Vite** (se detecta solo). Build: `npm run build` · Output: `dist`.
4. **Environment Variables**:
   ```
   VITE_SUPABASE_URL=https://uskadkxmxizcnhvhbwql.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_JrX1jjcRjrX3prVCEQsjOA_v5krGdnW
   VITE_API_URL=https://TU-BACKEND.up.railway.app
   ```
5. Deploy. Vercel te da la URL del frontend, ej. `https://facturita.vercel.app`.

> Después del primer deploy, volvé al backend (Railway) y poné en `CLIENT_ORIGIN`
> la URL real de Vercel. Redeploy del backend.

---

## 3) Actualizar Google OAuth y Supabase (con las URLs reales)

### Google Cloud → tu cliente OAuth → URIs de redirección autorizados
Agregá las de producción (además de las de localhost):
```
https://uskadkxmxizcnhvhbwql.supabase.co/auth/v1/callback      (login, ya está)
https://TU-BACKEND.up.railway.app/api/drive/callback           (Drive en prod)
```

### Supabase → Auth → URL Configuration
- **Site URL**: `https://TU-APP.vercel.app`
- **Redirect URLs**: agregá `https://TU-APP.vercel.app/**`

---

## Checklist final
- [ ] Backend en Railway/Render con todas las variables
- [ ] `VITE_API_URL` en Vercel apunta al backend
- [ ] `CLIENT_ORIGIN` en el backend apunta a Vercel
- [ ] `OAUTH_REDIRECT_URI` en el backend = `https://backend/api/drive/callback`
- [ ] Redirect de Drive agregado en Google Cloud
- [ ] Site URL + Redirect URLs en Supabase apuntan a Vercel
- [ ] Login con Google, emisión y guardado probados en producción
