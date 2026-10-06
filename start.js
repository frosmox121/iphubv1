const path = require('path'), fs = require('fs');
try { require('dotenv').config({ path: path.join(__dirname, '.env'), override: false }); } catch (_) {}
function resolveDbFile() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (fs.existsSync('/var/data') && fs.statSync('/var/data').isDirectory()) return path.join('/var/data', 'iphub-db.json');
  return path.join(__dirname, 'db.json');
}
const dbFile = resolveDbFile();
const st = {};
try {
  if (fs.existsSync(dbFile)) Object.assign(st, JSON.parse(fs.readFileSync(dbFile, 'utf8') || '{}'));
} catch (e) { console.warn('[start] no se pudo leer DB:', e.message); }
const old = path.join(__dirname, 'db.json');
if (!Object.keys(st).length && old !== dbFile && fs.existsSync(old)) {
  try { Object.assign(st, JSON.parse(fs.readFileSync(old, 'utf8') || '{}')); } catch (_) {}
}
const remote = require('./remote-store');
(async () => {
  if (remote.enabled) {
    const r = await remote.load();
    if (r && Object.keys(r).length) { Object.assign(st, r); console.log('[start] base restaurada desde Upstash'); }
    else console.log('[start] Upstash activo pero sin datos previos (base nueva)');
  } else console.log('[start] AVISO: sin UPSTASH_REDIS_REST_URL/TOKEN: los datos se pierden al reiniciar en Render Free');
  global.__IPHUB_STATE = st;
  console.log('[start] DB path=', dbFile, 'users=', (st.users || []).length);
  require('./server');
})();
