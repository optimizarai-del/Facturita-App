# Deploy en EasyPanel (VPS)

Un solo servicio sirve **frontend + backend** desde el mismo dominio (sin CORS).
EasyPanel compila el frontend en el build y el servidor Node lo sirve junto a la API.

---

## 1) Crear el servicio

1. En EasyPanel → tu proyecto → **+ Service → App**.
2. **Source**: GitHub → repo `optimizarai-del/Facturita-App`, branch **`main`**.
   (Si no conectaste GitHub, EasyPanel te guía para autorizarlo.)
3. **Build**: dejá **Nixpacks** (por defecto). Va a:
   - instalar dependencias del backend,
   - correr `npm run build` (compila el frontend),
   - arrancar con `npm start` (el server que sirve todo).
   - Usa **Node 22** automáticamente (por el `.nvmrc` / `engines`).
4. **Port**: `3000` (el server escucha en `process.env.PORT || 3000`).

## 2) Variables de entorno

En el servicio → **Environment**, pegá TODO esto (mismos valores del `.env` local):

```
# Supabase
SUPABASE_URL=https://uskadkxmxizcnhvhbwql.supabase.co
SUPABASE_ANON_KEY=sb_publishable_JrX1jjcRjrX3prVCEQsjOA_v5krGdnW
SUPABASE_SERVICE_ROLE_KEY=...

# Seguridad
APP_ENCRYPTION_KEY=...
OAUTH_STATE_SECRET=...

# Google (login + Drive)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# AFIP SDK
AFIPSDK_ACCESS_TOKEN=...

# SMTP (opcional)
SMTP_HOST=...  SMTP_PORT=465  SMTP_USER=...  SMTP_PASS=...  MAIL_FROM=...

# URLs (reemplazá TU-DOMINIO por el dominio real que uses en EasyPanel)
CLIENT_ORIGIN=https://TU-DOMINIO
OAUTH_REDIRECT_URI=https://TU-DOMINIO/api/drive/callback
PORT=3000

# Para compilar el frontend (se "hornean" en el build). NO pongas VITE_API_URL:
# al ser mismo origen, el front llama a /api relativo.
VITE_SUPABASE_URL=https://uskadkxmxizcnhvhbwql.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_JrX1jjcRjrX3prVCEQsjOA_v5krGdnW
```

> Las `VITE_*` tienen que estar cargadas ANTES del build (EasyPanel las tiene
> disponibles en build y runtime, así que con ponerlas alcanza).

## 3) Dominio + SSL

1. En el servicio → **Domains** → agregá tu dominio (o el subdominio que te da EasyPanel).
2. EasyPanel provisiona el **SSL (HTTPS) automático**. Esperá a que quede en verde.
3. Anotá la URL final `https://TU-DOMINIO` — es la que va en `CLIENT_ORIGIN` y `OAUTH_REDIRECT_URI` (paso 2). Si la pusiste con placeholder, corregila y redeploy.

## 4) Deploy

Apretá **Deploy**. En los logs deberías ver el build del frontend y después:
```
FacturitaApp backend en http://localhost:3000
🕘 Scheduler activo
```

## 5) Actualizar Google + Supabase (con el dominio real)

### Google Cloud → cliente OAuth → URIs de redirección
Agregá (dejá las que ya están):
```
https://uskadkxmxizcnhvhbwql.supabase.co/auth/v1/callback   (login, no tocar)
https://TU-DOMINIO/api/drive/callback                        (Drive en prod)
```

### Supabase → Auth → URL Configuration
- **Site URL**: `https://TU-DOMINIO`
- **Redirect URLs**: `https://TU-DOMINIO/**`

---

## Checklist
- [ ] Servicio App creado desde GitHub (main), Nixpacks, port 3000
- [ ] Todas las variables cargadas (incluidas las `VITE_*` para el build)
- [ ] Dominio + SSL en verde
- [ ] `CLIENT_ORIGIN` y `OAUTH_REDIRECT_URI` con el dominio real
- [ ] Redirect de Drive agregado en Google Cloud
- [ ] Site URL + Redirect en Supabase con el dominio real
- [ ] Probado: login, guardar config, emitir, Drive

> Ventaja de este modelo: frontend y backend en el mismo origen → sin CORS, y el
> bug de "no guarda" que veíamos con dominios separados no debería aparecer.
