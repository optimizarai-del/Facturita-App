# Contexto — FacturitaApp (handoff)

## Qué es
App web para emitir facturas electrónicas de AFIP desde un Excel, multiusuario. Cada usuario = un negocio con su propio CUIT/certificado. Se va a vender.

## Ubicación y repo
- Carpeta local: `C:\Users\aleja\Desktop\Facturita-App`
- GitHub: `github.com/optimizarai-del/Facturita-App` — rama `main` (todo el trabajo está acá; `v2` quedó igual que main).
- Forma de trabajo: por milestones, validando cada uno; voseo argentino.

## Arquitectura (mismo origen)
- Frontend React (Vite) en `client/`.
- Backend Node/Express en `server/` — motor AFIP (`@afipsdk/afip.js`), PDF, Drive, scheduler (node-cron), mail (nodemailer).
- Clave del deploy actual: el backend sirve también el frontend (`client/dist`) → un solo dominio, sin CORS. Esto arregló un bug de guardado que teníamos con dominios separados.
- Supabase — Postgres + Auth + RLS + Storage. Proyecto id `uskadkxmxizcnhvhbwql`, URL `https://uskadkxmxizcnhvhbwql.supabase.co`, publishable key `sb_publishable_JrX1jjcRjrX3prVCEQsjOA_v5krGdnW`.

## Deploy ACTUAL (funcionando)
- VPS Hostinger + EasyPanel. IP del VPS: `72.61.52.206` (panel en `:3000`).
- Servicio EasyPanel: proyecto `afipsdk` → servicio `facturita-app` (deploy desde GitHub `main`, Nixpacks, Node 22, puerto 3000).
- URL pública (dominio gratis de EasyPanel, con HTTPS): `https://afipsdk-acturita-appp.3buyoj.easypanel.host`
- Build: `npm run build` (compila el client) → `npm start` (server que sirve todo). Guía en `DEPLOY-EASYPANEL.md`.
- Login con Google ✅ funciona. Guardar config ✅ funciona. Emisión en homologación ✅ (probada, factura `1-00000083`).

## Variables de entorno (en EasyPanel → Entorno)
Backend (secretos → salen del `.env` local): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, `OAUTH_STATE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AFIPSDK_ACCESS_TOKEN`, `SMTP_*`, `PORT=3000`, `CLIENT_ORIGIN=https://afipsdk-acturita-appp.3buyoj.easypanel.host`, `OAUTH_REDIRECT_URI=https://afipsdk-acturita-appp.3buyoj.easypanel.host/api/drive/callback`.
Frontend (públicas, para el build): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. NO poner `VITE_API_URL` (mismo origen).

## Estado / pendientes
1. ⚠️ Drive tira `invalid_client`: faltan cargar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en EasyPanel (Entorno) → cargar y redeploy. Es lo primero a resolver.
2. Falta redeployar el último commit (`4ce8ce9`) para ver el Dashboard interactivo.
3. Validación pendiente: homologación (ya OK) → producción (1 factura real chica de prueba). Solo la cuenta `gerogambuli2002@gmail.com` (Gianfranco, CUIT 23346897899) tiene token+cert+producción listos.
4. Migrar a dominio propio (hoy usa el gratis de EasyPanel) cuando lo tengan.

## Últimos features agregados
- Dashboard interactivo: botón "Ver factura" (regenera el PDF on-demand, endpoint `GET /api/factura/:id/pdf`); badge de error debajo de cada factura fallida; programadas muestran "en cola".
- Programadas → Drive automático: el scheduler, al emitir una programada, genera PDF y lo sube a Drive.
- UI Apple: sidebar macOS, wizard de emisión (Subir→Revisar→Emitir), toggles iOS, modal de confirmación propio, íconos SVG (componente `client/src/ui/Icon.jsx`), tema claro/oscuro.
- Guardado configurable: al emitir, elegís guardar en local (carpeta elegible con File System Access API) o Drive (un click, credenciales de la app en el server, no del usuario).
- Programar por fecha: emite las vencidas al toque y deja programadas las futuras (salen su día 9:00, timezone Argentina).
- Seguridad: cifrado AES-256-GCM de cert/key/tokens en la DB; helmet, rate-limit, `trust proxy`; OAuth de Drive con state firmado (anti-CSRF).
- Fiscal: IVA multi-alícuota, validación condición IVA receptor (padrón AFIP en alta de cliente), fix de fecha off-by-one (ExcelJS UTC).

## Archivos clave
- Backend: `server/index.js` (endpoints + sirve frontend), `server/services/` (`afip.js`, `facturador.js`, `pdf.js`, `drive.js`, `scheduler.js`, `persistencia.js`, `settings.js`, `crypto.js`, `exporter.js`, `reader.js`, `mailer.js`, `supabase.js`, `log.js`), `server/middleware/auth.js`, `server/config/columns.js`.
- Frontend: `client/src/App.jsx`, `pages/` (`Login`, `Home`, `Facturacion`, `Config`, `Dashboard`, `Clientes`), `ui/` (`Icon`, `Toggle`, `Confirm`), `fsFolder.js`, `supabaseClient.js`, `styles.css`.

## Config de terceros (con las URLs de producción ya cargadas)
- Google Cloud (cliente OAuth `469785027300-3qms...`): redirects = Supabase callback + `.../api/drive/callback` local + `https://afipsdk-acturita-appp.3buyoj.easypanel.host/api/drive/callback`.
- Supabase Auth: Site URL + Redirect = la URL de EasyPanel.
- afipsdk.com: plan mensual pago activo (necesario para generar certificados en producción).

## Notas
- Homologación = sin validez fiscal (para probar). Producción = facturas reales, irreversibles (solo se anulan con nota de crédito — feature de notas de crédito NO existe todavía, es un pendiente pensado).
- Cuentas de prueba en la DB: gerogambuli2002 (prod-ready), optimizar.ai, tdls.mec, gianantonel (nuevas/vacías), test-fase0.
