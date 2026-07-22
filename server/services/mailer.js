import nodemailer from 'nodemailer';

// Config SMTP desde variables de entorno (a definir por el usuario).
// Ej. Gmail: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=... SMTP_PASS=<app password>
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

function transporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 465,
    secure: Number(SMTP_PORT) !== 587, // 465 = SSL, 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// Envía un resumen de las facturas emitidas. Si no hay SMTP configurado, no falla.
export async function enviarResumenEmisiones(to, emitidas, ambiente) {
  const tx = transporter();
  if (!tx) return { skipped: true, motivo: 'SMTP no configurado' };
  if (!to) return { skipped: true, motivo: 'sin email destino' };
  if (!emitidas.length) return { skipped: true, motivo: 'nada para notificar' };

  const filas = emitidas.map((f) =>
    `<tr><td>${f.tipo || ''}</td><td>${f.nombre_cliente || f.nombre || ''}</td>
     <td style="text-align:right">$ ${Number(f.importe || 0).toLocaleString('es-AR')}</td>
     <td>${f.cae || ''}</td></tr>`
  ).join('');

  const total = emitidas.reduce((s, f) => s + Number(f.importe || 0), 0);
  const html = `
    <div style="font-family:system-ui;max-width:560px">
      <h2>FacturitaApp — ${emitidas.length} factura(s) emitida(s)</h2>
      <p>Ambiente: <b>${ambiente}</b> · Total: <b>$ ${total.toLocaleString('es-AR')}</b></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px" border="1" cellpadding="6">
        <thead><tr><th>Tipo</th><th>Cliente</th><th>Importe</th><th>CAE</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;

  await tx.sendMail({
    from: MAIL_FROM || SMTP_USER,
    to,
    subject: `FacturitaApp: ${emitidas.length} factura(s) emitida(s)`,
    html,
  });
  return { enviado: true, cantidad: emitidas.length };
}
