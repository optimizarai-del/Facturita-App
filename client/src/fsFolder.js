// Manejo de la "carpeta local" elegida por el usuario para guardar comprobantes.
// Usa el File System Access API (Chrome/Edge) y persiste el handle en IndexedDB,
// así se recuerda entre sesiones y no hay que elegirla cada vez.

const DB = 'facturita';
const STORE = 'handles';
const KEY = 'carpetaLocal';

export function soportaCarpeta() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    tx.onsuccess = () => resolve(tx.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbSet(key, val) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Devuelve el nombre de la carpeta guardada (o null).
export async function nombreCarpetaGuardada() {
  try {
    const h = await idbGet(KEY);
    return h ? h.name : null;
  } catch { return null; }
}

// Abre el selector de carpetas, guarda el handle y devuelve su nombre.
export async function elegirCarpeta() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idbSet(KEY, handle);
  return handle.name;
}

async function asegurarPermiso(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

// Escribe los archivos [{name, b64}] en la carpeta guardada. Lanza si no hay carpeta.
export async function guardarEnCarpeta(archivos) {
  const handle = await idbGet(KEY);
  if (!handle) throw new Error('sin_carpeta');
  if (!(await asegurarPermiso(handle))) throw new Error('sin_permiso');
  for (const a of archivos) {
    const bytes = Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0));
    const fh = await handle.getFileHandle(a.name, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
  }
  return { guardados: archivos.length, carpeta: handle.name };
}
