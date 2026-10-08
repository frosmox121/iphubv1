'use strict';
// IPHub Monitor (EXE): red local + sesión de la misma cuenta de la página.
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path'), fs = require('fs'), http = require('http'), https = require('https');
const crypto = require('crypto'), { exec } = require('child_process');
const core = require('./core');
const icp = require('./intercept');
const cap = require('./capture');
const { getEngine } = require('./telemetry-engine');
const teleEngine = getEngine();

function logf() { return path.join(app.getPath('userData'), 'iphub-exe.log'); }
function log(m) { try { fs.mkdirSync(path.dirname(logf()), { recursive: true }); fs.appendFileSync(logf(), new Date().toISOString() + ' ' + m + '\n'); } catch (_) {} }
function cloudFile() { return path.join(app.getPath('userData'), 'iphub-cloud.json'); }
const SITE = (process.env.IPHUB_URL || 'https://iphub.com.ar').replace(/\/$/, '');
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
const CANDS = ['https://iphub.com.ar', 'https://www.iphub.com.ar'];
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

// Login con el NAVEGADOR del sistema (igual que el login/registro normal de IPHub).
// 1) El exe crea un código aleatorio y abre el navegador AL INSTANTE (sin esperar a la red) en una página local 127.0.0.1
//    que busca sola el dominio de IPHub que responde y te redirige ahí. 2) El exe espera por long-poll (instantáneo).
let launcher = null, linkSt = { id: 0, pending: false, error: '', url: '' };
function launcherHtml(bases, code, p) {
  return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>IPHub</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,Segoe UI,sans-serif;background:#0a1628;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}.b{max-width:460px;padding:2rem}.s{width:44px;height:44px;border:4px solid #1e293b;border-top-color:#06b6d4;border-radius:50%;animation:r 1s linear infinite;margin:0 auto 1.2rem}@keyframes r{to{transform:rotate(360deg)}}a{color:#06b6d4}button{background:#06b6d4;border:0;color:#04141f;font-weight:700;padding:.6rem 1.2rem;border-radius:8px;cursor:pointer;margin-top:1rem}</style></head><body><div class="b"><div class="s" id="s"></div><h2 id="t">Conectando con IPHub…</h2><p id="m" style="color:#94a3b8">Si el servidor estaba dormido puede tardar unos segundos. No cierres esta pestaña.</p></div><script>'
    + 'var B=' + JSON.stringify(bases) + ',C=' + JSON.stringify(code) + ',P=' + JSON.stringify(p) + ',done=false,fails=0;'
    + 'function go(b){if(done)return;done=true;location.replace(b+"/?conectar="+C+(P?"&p="+P:""));}'
    + 'function run(){done=false;fails=0;B.forEach(function(b,i){setTimeout(function(){fetch(b+"/api/auth/config",{mode:"no-cors",cache:"no-store"}).then(function(){go(b)}).catch(function(){if(++fails>=B.length&&!done)fallback()})},i*300)})}'
    + 'function fallback(){document.getElementById("s").style.display="none";document.getElementById("t").textContent="No se pudo contactar con IPHub";document.getElementById("m").innerHTML="Revisá tu conexión a internet y reintentá.<br>O abrí directamente: "+B.map(function(b){return \'<a href="\'+b+"/?conectar="+C+(P?"&p="+P:"")+\'">\'+b+"</a>"}).join(" · ")+\'<br><button onclick="location.reload()">Reintentar</button>\'}'
    + 'run();setTimeout(function(){if(!done)go(B[0])},45000);'
    + '</script></body></html>';
}
function ensureLauncher() {
  return new Promise(res => {
    if (launcher && launcher.port) return res(launcher.port);
    try {
      const srv = http.createServer((req, rsp) => {
        try {
          const u = new URL(req.url, 'http://127.0.0.1');
          const code = String(u.searchParams.get('code') || '').replace(/[^a-f0-9]/gi, '').slice(0, 64), p = /^(google|discord)$/.test(u.searchParams.get('p') || '') ? u.searchParams.get('p') : '';
          if (u.pathname === '/go' && code.length >= 24) { rsp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return rsp.end(launcherHtml([...new Set([curBase(), ...CANDS])], code, p)); }
        } catch (_) {}
        rsp.writeHead(404); rsp.end();
      });
      srv.on('error', e => { log('launcher error ' + e.message); res(0); });
      srv.listen(0, '127.0.0.1', () => { launcher = { srv, port: srv.address().port }; log('launcher en 127.0.0.1:' + launcher.port); res(launcher.port); });
    } catch (e) { log('launcher fallo ' + e.message); res(0); }
  });
}
async function openBrowser(url) {
  try { await shell.openExternal(url); log('navegador abierto'); return true; }
  catch (e) { log('shell.openExternal fallo: ' + e.message); }
  if (process.platform === 'win32') { try { exec('start "" "' + url.replace(/"/g, '') + '"', { windowsHide: true }); log('abierto con start'); return true; } catch (e) { log('start fallo ' + e.message); } }
  return false;
}
function startBrowserLogin(provider) {
  const id = linkSt.id + 1, code = crypto.randomBytes(16).toString('hex');
  const p = provider === 'discord' ? 'discord' : provider === 'google' ? 'google' : '';
  linkSt = { id, pending: true, error: '', url: '' };
  const mine = () => linkSt.id === id;
  log('login navegador provider=' + (p || 'normal') + ' id=' + id);
  (async () => {
    try {
      const port = await ensureLauncher();
      const url = port ? 'http://127.0.0.1:' + port + '/go?code=' + code + (p ? '&p=' + p : '') : curBase() + '/?conectar=' + code + (p ? '&p=' + p : '');
      if (mine()) linkSt.url = url;
      const opened = await openBrowser(url);
      if (!opened && mine()) linkSt.error = 'No se pudo abrir el navegador automáticamente. Copiá el enlace de abajo y pegalo en tu navegador.';
      const until = Date.now() + 10 * 60 * 1000;
      while (mine() && Date.now() < until) {
        let base; try { base = await pickBase(); } catch (e) { await sleep(2000); continue; }
        const t0 = Date.now(); let r = null;
        try { r = await apiCall(base, 'GET', '/api/agent/link/status?wait=20&code=' + code, null, null, 30000); }
        catch (e) { await sleep(1500); continue; }
        if (r && r.token) {
          const u = r.user || {}, isOwner = !!(u.isOwner || String(u.email || '').toLowerCase() === 'iphuboficial@gmail.com');
          writeCloud({ base, token: r.token, user: { name: u.name, email: u.email, isOwner, role: u.role || (isOwner ? 'owner' : undefined) } });
          liveBase = base; liveAt = Date.now(); log('login OK ' + (u.email || ''));
          if (mine()) linkSt = { id, pending: false, error: '', url: '' };
          pushNow();
          const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
          return;
        }
        if (Date.now() - t0 < 500) await sleep(700);
      }
      if (mine()) throw new Error('Se agotó el tiempo (10 min) para iniciar sesión en el navegador. Probá de nuevo.');
    } catch (e) { log('login error ' + (e && e.message)); if (mine()) linkSt = { id, pending: false, error: String(e && e.message || e), url: '' }; }
  })();
  return { pending: true };
}
async function diagnose() {
  const bases = [...new Set([curBase(), ...CANDS])], out = [];
  await Promise.all(bases.map(async b => { const t0 = Date.now(); try { await apiCall(b, 'GET', '/api/auth/config', null, null, 20000); out.push({ base: b, ok: true, ms: Date.now() - t0 }); } catch (e) { out.push({ base: b, ok: false, ms: Date.now() - t0, error: String(e.message || e) }); } }));
  return { saved: readCloud().base || null, version: app.getVersion(), platform: process.platform + ' ' + process.arch, electron: process.versions.electron, log: logf(), launcher: launcher && launcher.port || 0, bases: out };
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
    log('exe iniciado v' + app.getVersion() + ' base=' + curBase());
    ensureLauncher();
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
          case 'cloudStatus': { const c = readCloud(); return { ...c, base: normBase(c.base || SITE), push: pushInfo, pending: linkSt.pending, linkError: linkSt.error, linkUrl: linkSt.url }; }
          case 'cloudLogin': {
            const base = await pickBase();
            const d = await apiRetry(base, 'POST', '/api/auth/login', { email: String(a.email || '').trim(), password: a.password }, null, 2, 15000);
            if (!d.token) throw new Error(d.needsVerification ? 'Tenés que verificar tu correo en la página antes de conectar el exe.' : (d.error || 'No se pudo entrar'));
            const u = d.user || {}, isOwner = !!(u.isOwner || String(u.email || '').toLowerCase() === 'iphuboficial@gmail.com');
            writeCloud({ base, token: d.token, user: { name: u.name, email: u.email, isOwner, role: u.role || (isOwner ? 'owner' : undefined) } });
            pushNow(); return { ...readCloud(), push: pushInfo };
          }
          case 'cloudWeb': return startBrowserLogin(a && a.provider);
          case 'cloudCancel': linkSt = { id: linkSt.id + 1, pending: false, error: '', url: '' }; return { ok: true };
          case 'cloudDiag': return await diagnose();
          case 'cloudLink': return { error: 'Iniciá sesión con tu correo y contraseña.' };
          case 'cloudPoll': {
            const c = readCloud();
            const d = await apiRetry(normBase(c.base), 'GET', '/api/agent/link/status?code=' + encodeURIComponent(a || c.pending));
            if (d.token) { writeCloud({ base: c.base, token: d.token, user: d.user }); schedulePush(); }
            return d.token ? readCloud() : d;
          }
          case 'cloudLogout': linkSt = { id: linkSt.id + 1, pending: false, error: '', url: '' }; writeCloud({ base: curBase() }); pushInfo = { ok: null, at: 0, error: '' }; return readCloud();
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
