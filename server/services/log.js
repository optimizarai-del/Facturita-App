// Logger estructurado mínimo (sin dependencias). Emite JSON con timestamp, nivel
// y contexto, para poder dar soporte post-venta y correlacionar por usuario.
// Nunca loguear secretos (clave fiscal, tokens, cert/key) a través de acá.

function emit(level, msg, ctx) {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: String(msg),
    ...(ctx && typeof ctx === 'object' ? ctx : {}),
  };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + '\n');
}

export const log = {
  info: (msg, ctx) => emit('info', msg, ctx),
  warn: (msg, ctx) => emit('warn', msg, ctx),
  error: (msg, ctx) => emit('error', msg, ctx),
};
