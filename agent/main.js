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
function apiCall(base, method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlPath, base); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = lib.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'x-iphub-agent': '1', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Length': data.length } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { let j = {}; try { j = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (_) {} if (res.statusCode >= 400) reject(new Error(j.error || ('HTTP ' + res.statusCode))); else resolve(j); });
    });
    req.setTimeout(40000, () => req.destroy(new Error('El servidor tardó demasiado en responder (puede estar despertando). Probá de nuevo.')));
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const CANDS = ['https://iphub.onrender.com', 'https://iphuboficial.onrender.com'];
const normBase = b => { b = String(b || '').trim().replace(/\/+$/, ''); if (!b) return SITE; if (!/^https?:\/\//i.test(b)) b = 'https://' + b; return b; };
const curBase = () => normBase(readCloud().base || SITE);
async function apiRetry(base, method, p, body, token, tries = 2) { // Render Free devuelve 502/503 o corta la conexión mientras despierta
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await apiCall(base, method, p, body, token); }
    catch (e) {
      last = e; const m = String(e.message || '');
      if (!/HTTP 50[234]|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|tardó demasiado/i.test(m) || i === tries - 1) break;
      await new Promise(r => setTimeout(r, 2500));
    }
  }
  const m = String(last && last.message || last);
  if (/ENOTFOUND|ECONNREFUSED/.test(m)) throw new Error('No se encontró la página (' + base + '). Revisá la dirección y tu conexión a internet.');
  throw last;
}

// Login real: abre la página de IPHub dentro del exe (credenciales, Google y Discord funcionan igual que en el navegador)
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
let webWin = null;
function webLogin(provider) {
  return new Promise((resolve, reject) => {
    if (webWin && !webWin.isDestroyed()) { webWin.focus(); return reject(new Error('La ventana de inicio de sesión ya está abierta')); }
    const base = curBase();
    const btnId = provider === 'discord' ? 'discord-btn' : 'google-btn';
    const w = new BrowserWindow({ width: 520, height: 780, parent: BrowserWindow.getAllWindows()[0], title: 'IPHub · ' + (provider === 'discord' ? 'Discord' : 'Google'), autoHideMenuBar: true, backgroundColor: '#0a1628',
      webPreferences: { partition: 'persist:iphubweb', contextIsolation: true, nodeIntegration: false } });
    webWin = w; w.webContents.setUserAgent(CHROME_UA);
    let done = false, timer = null, clicked = 0;
    const finish = (err, val) => { if (done) return; done = true; clearInterval(timer); if (!w.isDestroyed()) w.destroy(); webWin = null; err ? reject(err) : resolve(val); };
    // Google/Discord abren su popup (accounts.google.com / discord.com) dentro de la misma sesión
    w.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 520, height: 720, parent: w, webPreferences: { partition: 'persist:iphubweb', contextIsolation: true, nodeIntegration: false } } }));
    w.webContents.on('did-create-window', c => c.webContents.setUserAgent(CHROME_UA));
    w.on('closed', () => finish(new Error('Cerraste la ventana sin iniciar sesión')));
    w.webContents.on('did-fail-load', (_e, code, desc, url, main) => { if (main && code !== -3) finish(new Error('No se pudo abrir ' + base + ' (' + desc + '). Revisá tu conexión.')); });
    // Se cierra la sesión previa de la página para que SIEMPRE pida elegir cuenta
    w.webContents.session.clearStorageData({ storages: ['localstorage'] }).catch(() => {}).finally(() => w.loadURL(base + '/?from=exe').catch(() => {}));
    let busy = false, ticks = 0;
    timer = setInterval(async () => {
      if (done || busy || w.isDestroyed()) return; busy = true;
      try {
        if (++ticks > 450) return finish(new Error('Se agotó el tiempo para iniciar sesión'));
        const token = await w.webContents.executeJavaScript("localStorage.getItem('iphub_token')", true);
        if (token) {
          const d = await apiRetry(base, 'GET', '/api/auth/me', null, token, 3);
          if (d && d.user) {
            const u = d.user, isOwner = !!(u.isOwner || String(u.email || '').toLowerCase() === 'iphuboficial@gmail.com');
            writeCloud({ base, token, user: { name: u.name, email: u.email, isOwner, role: u.role || (isOwner ? 'owner' : undefined) } });
            pushNow(); return finish(null, { ...readCloud(), push: pushInfo });
          }
        } else if (!clicked || ticks % 12 === 0) {
          // Hace clic en "Continuar con Google/Discord" de la propia página (ella manda a accounts.google.com / discord.com)
          const r = await w.webContents.executeJavaScript("(function(){var b=document.getElementById('" + btnId + "');if(!b||b.disabled||b.offsetParent===null)return 0;b.click();return 1})()", true);
          if (r) clicked++;
        }
      } catch (_) {} finally { busy = false; }
    }, 1000);
  });
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
          case 'cloudStatus': { const c = readCloud(); return { ...c, base: normBase(c.base || SITE), push: pushInfo }; }
          case 'cloudLogin': {
            const bases = [...new Set([curBase(), ...CANDS])]; let d, base, last;
            for (const b of bases) {
              try { d = await apiRetry(b, 'POST', '/api/auth/login', { email: String(a.email || '').trim(), password: a.password }, null, b === bases[0] ? 4 : 1); base = b; break; }
              catch (e) { last = e; if (!/No se encontró la página|ENOTFOUND/.test(String(e.message))) throw e; }
            }
            if (!d) throw last;
            if (!d.token) throw new Error(d.needsVerification ? 'Tenés que verificar tu correo en la página antes de conectar el exe.' : (d.error || 'No se pudo entrar'));
            const u = d.user || {}, isOwner = !!(u.isOwner || String(u.email || '').toLowerCase() === 'iphuboficial@gmail.com');
            writeCloud({ base, token: d.token, user: { name: u.name, email: u.email, isOwner, role: u.role || (isOwner ? 'owner' : undefined) } });
            pushNow(); return { ...readCloud(), push: pushInfo };
          }
          case 'cloudWeb': return await webLogin(a && a.provider);
          case 'cloudLink': return { error: 'Iniciá sesión con tu correo y contraseña.' };
          case 'cloudPoll': {
            const c = readCloud();
            const d = await apiRetry(normBase(c.base), 'GET', '/api/agent/link/status?code=' + encodeURIComponent(a || c.pending));
            if (d.token) { writeCloud({ base: c.base, token: d.token, user: d.user }); schedulePush(); }
            return d.token ? readCloud() : d;
          }
          case 'cloudLogout': writeCloud({ base: curBase() }); pushInfo = { ok: null, at: 0, error: '' }; return readCloud();
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
    refreshUser().then(pushNow);
    setInterval(pushNow, 60000);
    setInterval(refreshUser, 5 * 60000);
    setInterval(() => core.scan(), 45000);
    setInterval(async () => { try { if (await core.watchNet()) core.scan({ full: true }); } catch (_) {} }, 12000);
  });
  app.on('before-quit', () => { try { teleEngine.stopAll(); } catch (_) {} core.flush(); });
  app.on('window-all-closed', () => app.quit());
}
