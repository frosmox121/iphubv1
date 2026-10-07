// Persistencia gratuita en Upstash Redis (REST/HTTP, sin drivers): sobrevive a reinicios de Render Free.
const URL_ = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, ''), TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '', KEY = 'iphub_db';
const enabled = !!(URL_ && TOKEN);
async function cmd(args, ms = 15000) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(ms) });
  const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status); return j.result;
}
async function load() { if (!enabled) return null; try { const v = await cmd(['GET', KEY]); return v ? JSON.parse(v) : null; } catch (e) { console.warn('[remote] no se pudo leer:', e.message); return null; } }
// Se excluye la caché de traducciones (se regenera) y se recorta el historial para respetar el límite de ~1 MB del plan gratis.
function slim(state, lvl) {
  const s = { ...state }; delete s.i18n; const cap = [1000, 300, 60][lvl];
  for (const k of ['audit', 'scans']) if (Array.isArray(s[k])) s[k] = s[k].slice(0, cap);
  return s;
}
let timer = null, busy = false;
async function push(state) {
  if (!enabled || busy) return; busy = true;
  try { let txt = ''; for (let l = 0; l < 3; l++) { txt = JSON.stringify(slim(state, l)); if (txt.length < 900000) break; }
    if (txt.length >= 950000) console.warn('[remote] la base supera ~1 MB; no se guardó en Upstash'); else await cmd(['SET', KEY, txt]); }
  catch (e) { console.warn('[remote] no se pudo guardar:', e.message); } busy = false;
}
function save(state, now) { if (!enabled) return Promise.resolve(); clearTimeout(timer); if (now) return push(state); timer = setTimeout(() => push(state), 3000); return Promise.resolve(); }
const lt = {};
async function loadLang(l) { if (!enabled) return null; try { const v = await cmd(['GET', 'iphub_i18n_' + l]); return v ? JSON.parse(v) : null; } catch (_) { return null; } }
function saveLang(l, map) { if (!enabled) return; clearTimeout(lt[l]); lt[l] = setTimeout(async () => { try { const t = JSON.stringify(map); if (t.length < 900000) await cmd(['SET', 'iphub_i18n_' + l, t]); } catch (_) {} }, 2000); }
module.exports = { enabled, load, save, loadLang, saveLang };
