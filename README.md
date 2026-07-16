# 🧾 FacturitaApp

Web app local que genera facturas electrónicas de AFIP a partir de un Excel, y exporta el resultado con un resumen de comprobantes realizados y pendientes.

## Cómo funciona

1. **Descargás una plantilla Excel** con las columnas necesarias y una fila de ejemplo.
2. La completás con las facturas a emitir (una fila por factura).
3. Configurás tu CUIT y tu access token de AFIP SDK.
4. Subís el Excel y se emiten las facturas automáticamente.
5. Obtenés un Excel/carpeta de salida con el resultado y un resumen.

## Columnas de la plantilla

| Nombre / Razón social | CUIT/DNI | Tipo (A/B/C) | Concepto | Descripción | Importe total |
|---|---|---|---|---|---|

## Requisitos

- Node.js 18+
- Una cuenta gratuita en [app.afipsdk.com](https://app.afipsdk.com/) para obtener el **access token**
  (necesario incluso en homologación).

## Uso

```bash
npm install
npm run dev
# abrí http://localhost:3000
```

## Entornos

- **Homologación** (por defecto): facturas de prueba sin validez fiscal.
- **Producción**: facturas reales (requiere access token de producción y certificado).

## Stack

Node + Express · `@afipsdk/afip.js` · `exceljs` · frontend HTML/JS estático.

---

_Este software no tiene relación con AFIP/ARCA. Usa AFIP SDK como intermediario._
