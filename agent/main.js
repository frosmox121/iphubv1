'use strict';
// IPHub Monitor (EXE): red local + sesión de la misma cuenta de la página.
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path'), fs = require('fs'), http = require('http'), https = require('https');
const core = require('./core');
const icp = require('./intercept');
const cap = require('./capture');
const { getEngine } = require('./telemetry-engine');
const teleEngine = getEngine();

function cloudFile() { return path.join(app.getPath('userData'), 'iphub-cloud.json'); }
const SITE = (process.env.IPHUB_URL || 'https://iphuboficial.onrender.com').replace(/\/$/, '');
function readCloud() { try { return JSON.parse(fs.readFileSync(cloudFile(), 'utf8')); } catch (_) { return { base: SITE }; } }
function writeCloud(d) { fs.mkdirSync(path.dirname(cloudFile()), { recursive: true }); fs.writeFileSync(cloudFile(), JSON.stringify(d)); }
const agentHttps = new https.Agent({ keepAlive: true, maxSockets: 8 }), agentHttp = new http.Agent({ keepAlive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
function apiCall(base, method, urlPath, body, token, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlPath, base); } catch (e) { return reject(e); }
    const isS = u.protocol === 'https:', lib = isS ? https : http;
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    let fin = false; const end = (fn, v) => { if (fin) return; fin = true; clearTimeout(to); fn(v); };
    const req = lib.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, agent: isS ? agentHttps : agentHttp, headers: { 'Content-Type': 'application/json', 'x-iphub-agent': '1', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Length': data.length } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { let j = {}; try { j = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (_) {} if (res.statusCode >= 400) end(reject, new Error(j.error || ('HTTP ' + res.statusCode))); else end(resolve, j); });
    });
    // Tiempo límite TOTAL (incluye conectar/TLS), no solo inactividad: así nunca queda colgado
    const to = setTimeout(() => { const e = new Error('El servidor tardó demasiado en responder'); end(reject, e); req.destroy(e); }, timeout);
    req.on('error', e => end(reject, e)); if (data) req.write(data); req.end();
  });
}
const CANDS = ['https://iphub.onrender.com', 'https://iphuboficial.onrender.com'];
const normBase = b => { b = String(b || '').trim().replace(/\/+$/, ''); if (!b) return SITE; if (!/^https?:\/\//i.test(b)) b = 'https://' + b; return b; };
const curBase = () => normBase(readCloud().base || SITE);
async function apiRetry(base, method, p, body, token, tries = 2, timeout = 15000) { // Render Free devuelve 502/503 o corta la conexión mientras despierta
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await apiCall(base, method, p, body, token, timeout); }
    catch (e) {
      last = e; const m = String(e.message || '');
      if (!/HTTP 50[234]|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|tardó demasiado/i.test(m) || i === tries - 1) break;
      await sleep(1200);
    }
  }
  const m = String(last && last.message || last);
  if (/ENOTFOUND|ECONNREFUSED/.test(m)) throw new Error('No se encontró la página (' + base + '). Revisá la dirección y tu conexión a internet.');
  throw last;
}
// Elige el dominio que responde PRIMERO (en paralelo) y lo recuerda: no más esperar 40 s por un dominio caído.
let liveBase = null, liveAt = 0, picking = null;
function pickBase(force) {
  if (!force && liveBase && Date.now() - liveAt < 180000) return Promise.resolve(liveBase);
  if (picking) return picking;
  const bases = [...new Set([curBase(), ...CANDS])];
  picking = Promise.any(bases.map((b, i) => sleep(i * 350).then(() => apiCall(b, 'GET', '/api/auth/config', null, null, 70000)).then(() => b)))
    .then(b => { liveBase = b; liveAt = Date.now(); return b; })
    .catch(() => { throw new Error('No se pudo conectar con IPHub. Revisá tu conexión a internet (probé: ' + bases.join(', ') + ').'); })
    .finally(() => { picking = null; });
  return picking;
}

// Login con el NAVEGADOR del sistema (igual que el login/registro normal de IPHub): Google (accounts.google.com),
// Discord (authorize) o correo+contraseña. El exe genera un código, abre la página con ese código y la espera por long-poll (instantáneo).
let linkSt = { id: 0, pending: false, error: '' };
function startBrowserLogin(provider) {
  const id = linkSt.id + 1; linkSt = { id, pending: true, error: '' };
  const mine = () => linkSt.id === id;
  (async () => {
    try {
      const base = await pickBase();
      if (!mine()) return;
      const d = await apiRetry(base, 'POST', '/api/agent/link/start', {}, null, 3, 15000);
      if (!d || !d.code) throw new Error('El servidor no devolvió un código de enlace');
      if (!mine()) return;
      const p = provider === 'discord' ? 'discord' : provider === 'google' ? 'google' : '';
      shell.openExternal(base + '/?conectar=' + encodeURIComponent(d.code) + (p ? '&p=' + p : ''));
      const until = Date.now() + 10 * 60 * 1000;
      while (mine() && Date.now() < until) {
        const t0 = Date.now(); let r = null;
        try { r = await apiCall(base, 'GET', '/api/agent/link/status?wait=20&code=' + encodeURIComponent(d.code), null, null, 30000); }
        catch (e) { if (/vencido/i.test(String(e.message))) throw e; await sleep(1000); continue; }
        if (r && r.token) {
          const u = r.user || {}, isOwner = !!(u.isOwner || String(u.email || '').toLowerCase() === 'iphuboficial@gmail.com');
          writeCloud({ base, token: r.token, user: { name: u.name, email: u.email, isOwner, role: u.role || (isOwner ? 'owner' : undefined) } });
          liveBase = base; liveAt = Date.now();
          if (mine()) linkSt = { id, pending: false, error: '' };
          pushNow();
          const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
          return;
        }
        if (Date.now() - t0 < 500) await sleep(700); // servidor viejo sin long-poll
      }
      if (mine()) throw new Error('Se agotó el tiempo para iniciar sesión en el navegador');
    } catch (e) { if (mine()) linkSt = { id, pending: false, error: String(e && e.message || e) }; }
  })();
  return { pending: true };
}
let pushT = null, pushInfo = { ok: null, at: 0, error: '' };
async function pushNow() {
  const c = readCloud(); if (!c.token || !c.base) return false;
  try {
    const s = core.summary();
    await apiRetry(c.base, 'POST', '/api/agent/snapshot', { ...s, host: require('os').hostname(), devices: s.devices }, c.token, 2);
    pushInfo = { ok: true, at: Date.now(), error: '' }; return true;
  } catch (e) {
    const m = String(e && e.message || e);
    pushInfo = { ok: false, at: Date.now(), error: m };
    // Token vencido o usuario inexistente: se limpia la sesión para no quedar "conectado" sin subir nada
    if (/Usuario no existe|Token inválido|No autenticado|HTTP 401/i.test(m)) writeCloud({ base: c.base });
    return false;
  }
}
function schedulePush() { clearTimeout(pushT); pushT = setTimeout(pushNow, 1500); }
// Refresca los datos de la cuenta (nombre/correo/rol) desde la página para que no queden viejos
async function refreshUser() {
  const c = readCloud(); if (!c.token || !c.base) return;
  try {
    const d = await apiRetry(c.base, 'GET', '/api/auth/me', null, c.token, 2);
    if (d && d.user) {
      const u = d.user, isOwner = !!(u.isOwner || String(u.email || '').toLowerCase() === 'iphuboficial@gmail.com');
      writeCloud({ ...readCloud(), user: { name: u.name, email: u.email, isOwner, role: u.role || (isOwner ? 'owner' : undefined) } });
    }
  } catch (e) { if (/Usuario no existe|Token inválido|No autenticado|HTTP 401/i.test(String(e.message))) writeCloud({ base: c.base }); }
}

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  let win = null;
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  const isLan = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.hostname); } catch (_) { return false; } };

  app.whenReady().then(() => {
    ipcMain.handle('call', async (_e, action, a, b) => {
      try {
        switch (action) {
          case 'scan': return await core.scan({ full: !!a });
          case 'trust': return core.trust(a);
          case 'untrust': return core.untrust(a);
          case 'ignore': return core.ignore(a);
          case 'unignore': return core.unignore(a);
          case 'remove': return core.remove(a);
          case 'restore': return core.restore(a);
          case 'restoreAll': return core.restoreAll();
          case 'trace': return await core.trace(a, !!b);
          case 'intStart': { const c = readCloud(); if (!(c.user && c.user.isOwner)) return { error: 'Solo la cuenta del dueño puede interceptar' }; return icp.start(a); }
          case 'capIfaces': return await cap.ifaces();
          case 'capStart': { const c = readCloud(); if (!(c.user && c.user.isOwner)) return { error: 'Solo la cuenta del dueño puede capturar paquetes' }; return cap.start(a || {}); }
          case 'capStop': return cap.stop();
          case 'capList': return cap.list(a);
          case 'capPacket': return cap.packet(a);
          case 'capClear': return cap.clear();
          case 'intStop': return icp.stop();
          case 'intList': return icp.list(a);
          case 'intClear': return icp.clear();
          case 'note': return core.note(a, b);
          case 'trustAll': return core.trustAll();
          case 'setting': return core.setSetting(a, b);
          case 'wake': return core.wake(a);
          case 'open': if (isLan(a)) shell.openExternal(a); return { ok: true };
          case 'export': {
            const r = await dialog.showSaveDialog(win, { defaultPath: a.name, filters: [{ name: a.name.split('.').pop().toUpperCase(), extensions: [a.name.split('.').pop()] }] });
            if (r.canceled || !r.filePath) return { canceled: true };
            fs.writeFileSync(r.filePath, '\ufeff' + a.content, 'utf8'); return { ok: true, path: r.filePath };
          }
          case 'cloudStatus': { const c = readCloud(); return { ...c, base: normBase(c.base || SITE), push: pushInfo, pending: linkSt.pending, linkError: linkSt.error }; }
          case 'cloudLogin': {
            const base = await pickBase();
            const d = await apiRetry(base, 'POST', '/api/auth/login', { email: String(a.email || '').trim(), password: a.password }, null, 2, 15000);
            if (!d.token) throw new Error(d.needsVerification ? 'Tenés que verificar tu correo en la página antes de conectar el exe.' : (d.error || 'No se pudo entrar'));
            const u = d.user || {}, isOwner = !!(u.isOwner || String(u.email || '').toLowerCase() === 'iphuboficial@gmail.com');
            writeCloud({ base, token: d.token, user: { name: u.name, email: u.email, isOwner, role: u.role || (isOwner ? 'owner' : undefined) } });
            pushNow(); return { ...readCloud(), push: pushInfo };
          }
          case 'cloudWeb': return startBrowserLogin(a && a.provider);
          case 'cloudCancel': linkSt = { id: linkSt.id + 1, pending: false, error: '' }; return { ok: true };
          case 'cloudLink': return { error: 'Iniciá sesión con tu correo y contraseña.' };
          case 'cloudPoll': {
            const c = readCloud();
            const d = await apiRetry(normBase(c.base), 'GET', '/api/agent/link/status?code=' + encodeURIComponent(a || c.pending));
            if (d.token) { writeCloud({ base: c.base, token: d.token, user: d.user }); schedulePush(); }
            return d.token ? readCloud() : d;
          }
          case 'cloudLogout': linkSt = { id: linkSt.id + 1, pending: false, error: '' }; writeCloud({ base: curBase() }); pushInfo = { ok: null, at: 0, error: '' }; return readCloud();
          case 'cloudBase': writeCloud({ ...readCloud(), base: normBase(a) }); return readCloud();
          // Tracking Studio — motor de telemetría (workers)
          case 'teleResources': return teleEngine.resources();
          case 'teleList': return teleEngine.list();
          case 'teleStart': {
            const c = readCloud();
            if (c.token && c.base) teleEngine.setCloud(normBase(c.base), c.token);
            const id = String((a && a.id) || ('w-' + Date.now()));
            return teleEngine.startWorker(id, a && a.config);
          }
          case 'teleStop': return teleEngine.stopWorker(String(a));
          case 'teleStopAll': return teleEngine.stopAll();
          case 'teleConfig': return teleEngine.configure(String(a), b || {});
          case 'teleSetCloud': {
            const c = readCloud();
            teleEngine.setCloud(normBase((a && a.base) || c.base), (a && a.token) || c.token);
            return { ok: true };
          }
          default: return core.summary();
        }
      } catch (e) { return { error: e.message }; }
    });

    const iconPath = path.join(__dirname, 'icon.ico');
    win = new BrowserWindow({
      width: 1360, height: 860, minWidth: 980, minHeight: 620, title: 'IPHub', backgroundColor: '#0a1628', autoHideMenuBar: true,
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.loadFile(path.join(__dirname, 'ui.html'));
    core.bus.on('state', s => { if (win && !win.isDestroyed()) win.webContents.send('state', s); schedulePush(); });
    core.bus.on('newdevice', d => {
      if (core.summary().settings.notify && Notification.isSupported()) new Notification({ title: 'IPHub', body: `${d.name || d.vendor || 'Nuevo dispositivo'} · ${d.ip} · ${d.mac || ''}` }).show();
    });
    core.scan({ full: true });
    pickBase(true).catch(() => {}); setInterval(() => pickBase(true).catch(() => {}), 4 * 60000); // despierta Render y lo mantiene despierto
    refreshUser().then(pushNow);
    setInterval(pushNow, 60000);
    setInterval(refreshUser, 5 * 60000);
    setInterval(() => core.scan(), 45000);
    setInterval(async () => { try { if (await core.watchNet()) core.scan({ full: true }); } catch (_) {} }, 12000);
  });
  app.on('before-quit', () => { try { teleEngine.stopAll(); } catch (_) {} core.flush(); });
  app.on('window-all-closed', () => app.quit());
}
