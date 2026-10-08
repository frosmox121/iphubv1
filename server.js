/**
 * IPHub — Backend real
 * -----------------------------------------------------------------------
 * Todo lo que hace este servidor es REAL:
 *  - Ping de verdad (spawnea el binario `ping` del sistema operativo)
 *  - ARP de verdad (spawnea `arp -a` y parsea la tabla ARP real del SO)
 *  - Escaneo de puertos TCP real (net.Socket.connect contra el host)
 *  - Traceroute (spawnea `traceroute`/`tracert` del sistema operativo)
 *  - Resolución DNS (módulo dns nativo de Node, consulta a los
 *    resolvers configurados en el sistema)
 *  - Geolocalización de IP real (API pública ip-api.com, sin mock)
 *  - Base de datos real persistida en disco (db.json vía lowdb) — nada
 *    se pierde al reiniciar el servidor.
 *
 * ADVERTENCIA LEGAL/ÉTICA (real, no de relleno): escanear puertos, hacer
 * ping sweep o traceroute contra hosts que no son tuyos y sin autorización
 * puede ser ILEGAL según la legislación de tu país. Usa esto solo sobre
 * tu propia red / equipos que administras.
 * -----------------------------------------------------------------------
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const dns = require('dns').promises;
const crypto = require('crypto');
const { execFile } = require('child_process');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
let nodemailer = null; try { nodemailer = require('nodemailer'); } catch (_) {}
const miniDb = require('./mini-db');

// ---------- Cargar .env manualmente (sin dependencias extra) ----------
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val.trim();
  }
})();

const PORT = parseInt(process.env.PORT || '3001', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'inseguro_cambia_esto_en_.env';
const DEFAULT_CIDR = process.env.DEFAULT_SCAN_CIDR || '192.168.1.0/24';
const isWin = process.platform === 'win32';

if (JWT_SECRET === 'inseguro_cambia_esto_en_.env') {
  console.warn('⚠  Estás usando el JWT_SECRET por defecto. Creá un archivo .env (mirá .env.example) antes de exponer esto fuera de tu máquina.');
}

// ---------- Correo (SMTP) ----------
const SUPPORT_TO = process.env.SUPPORT_TO || 'iphuboficial@gmail.com';
const envv = (...keys) => { for (const k of keys) { const v = String(process.env[k] || '').trim().replace(/^["']|["']$/g, ''); if (v) return v; } return ''; };
function mailCfg() {
  const user = envv('SMTP_USER', 'MAIL_USER', 'EMAIL_USER', 'GMAIL_USER');
  // Quitar espacios/saltos (App Password de Google a veces se pega con espacios)
  const pass = envv('SMTP_PASS', 'SMTP_PASSWORD', 'MAIL_PASS', 'EMAIL_PASS', 'GMAIL_PASS').replace(/[\s\r\n]+/g, '');
  return { user, pass };
}
function getMailer(prefer587) {
  const { user, pass } = mailCfg();
  if (!nodemailer || !user || !pass) return null;
  if (prefer587) {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true,
      auth: { user, pass },
      connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 12000,
      tls: { minVersion: 'TLSv1.2' }
    });
  }
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass },
    connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 12000
  });
}
let _mailDiagLogged = false;
function logMailDiagOnce() {
  if (_mailDiagLogged) return;
  _mailDiagLogged = true;
  const { user, pass } = mailCfg();
  console.log('[MAIL diag] nodemailer=' + (nodemailer ? 'ok' : 'FALTA') +
    ' SMTP_USER=' + (user ? user : 'VACIO') +
    ' SMTP_PASS=' + (pass ? ('si (' + pass.length + ' chars)') : 'VACIO') +
    ' SUPPORT_TO=' + SUPPORT_TO);
}
async function sendViaBrevo(to, subject, text, html, attachments) {
  const sender = process.env.BREVO_SENDER || mailCfg().user || SUPPORT_TO;
  const body = { sender: { name: 'IPHub', email: sender }, to: String(to).split(',').map(e => ({ email: e.trim() })), subject, textContent: text || ' ' };
  if (html) body.htmlContent = html;
  if (attachments && attachments.length) body.attachment = attachments.filter(x => x.content).map(x => ({ name: x.filename || 'adjunto', content: Buffer.from(x.content).toString('base64') }));
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (r.ok) { console.log('[MAIL ok] enviado a', to, 'via Brevo'); return true; }
    console.error('[MAIL FAIL] Brevo HTTP', r.status, (await r.text()).slice(0, 200)); return false;
  } catch (e) { console.error('[MAIL FAIL] Brevo:', e.message); return false; }
}
async function sendMail(to, subject, text, html, attachments) {
  logMailDiagOnce();
  const { user, pass } = mailCfg();
  if (process.env.BREVO_API_KEY) return sendViaBrevo(to, subject, text, html, attachments);
  if (!nodemailer || !user || !pass) {
    console.log(`\n[MAIL no enviado] Falta usuario o clave. user=${user ? 'si' : 'no'} pass=${pass ? 'si' : 'no'}\nPara: ${to}\n${text}\n`);
    return false;
  }
  const opts = { from: `"IPHub" <${user}>`, to, subject, text, html: html || undefined, attachments: attachments || undefined };
  try {
    await getMailer(false).sendMail(opts);
    console.log('[MAIL ok] enviado a', to, 'via 465');
    return true;
  } catch (e1) {
    console.error('Error SMTP 465:', e1.message);
  }
  try {
    await getMailer(true).sendMail(opts);
    console.log('[MAIL ok] enviado a', to, 'via 587');
    return true;
  } catch (e2) {
    console.error('Error SMTP 587:', e2.message);
    console.error('[MAIL FAIL] Render: SMTP_USER=Gmail completo, SMTP_PASS=App Password 16 letras sin espacios. https://myaccount.google.com/apppasswords');
    return false;
  }
}
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');
async function issueCode(user) {
  const code = String(crypto.randomInt(100000, 1000000));
  db.get('users').find({ id: user.id }).assign({ verifyHash: sha(code), verifyExp: Date.now() + 15 * 60 * 1000, verifyTries: 0 }).write();
  // Siempre en Logs de Render por si SMTP falla — podés copiar el código de ahí
  console.log('[VERIFY CODE] user=' + user.email + ' code=' + code + ' (valido 15 min)');
  return sendMail(user.email, `${code} es tu código de verificación de IPHub`,
    `Tu código de verificación de IPHub es: ${code}\nVence en 15 minutos. Si no lo pediste, ignorá este correo.`,
    `<div style="font-family:Segoe UI,Arial;max-width:420px;margin:auto;padding:28px;border-radius:16px;background:#0b1d3a;color:#fff"><h2 style="margin:0 0 8px">IPHub</h2><p>Tu código de verificación:</p><p style="font-size:34px;letter-spacing:8px;font-weight:700;color:#10b981">${code}</p><p style="color:#94a3b8;font-size:12px">Vence en 15 minutos.</p></div>`);
}

// ---------- Base de datos (persistida en disco) ----------
// En Render Free el disco del contenedor se borra al reiniciar → se pierden usuarios.
// Solución: variable DB_PATH, o disco persistente montado en /var/data (plan paid).
function resolveDbFile() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (fs.existsSync('/var/data') && fs.statSync('/var/data').isDirectory()) return path.join('/var/data', 'iphub-db.json');
  return path.join(__dirname, 'db.json');
}
const dbFile = resolveDbFile();
console.log('[DB] archivo =', dbFile);
// Si start.js no cargó estado, cargar desde disco ahora
if (!global.__IPHUB_STATE || !Object.keys(global.__IPHUB_STATE).length) {
  try {
    if (fs.existsSync(dbFile)) {
      global.__IPHUB_STATE = JSON.parse(fs.readFileSync(dbFile, 'utf8') || '{}');
      console.log('[DB] cargada, users=', (global.__IPHUB_STATE.users || []).length);
    } else {
      global.__IPHUB_STATE = {};
      console.log('[DB] sin archivo previo (base vacía)');
    }
  } catch (e) {
    console.error('[DB] no se pudo leer:', e.message);
    global.__IPHUB_STATE = {};
  }
}
let prisma = null;
const state = global.__IPHUB_STATE || {};
function writeDbNow() {
  try { fs.mkdirSync(path.dirname(dbFile), { recursive: true }); } catch (_) {}
  const tmp = dbFile + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, dbFile); }
  catch (e) { try { fs.writeFileSync(dbFile, JSON.stringify(state)); } catch (e2) { console.error('DB persist:', e2.message); } }
}
let flushT = null;
function flush() { // guardado agrupado: antes se reescribía el archivo entero varias veces por cada cambio y bloqueaba el servidor (502)
  clearTimeout(flushT);
  flushT = setTimeout(() => { writeDbNow(); try { require('./remote-store').save(state); } catch (_) {} }, 400);
}
const db = miniDb(state, flush);
db.defaults({
  users: [],
  audit: [],
  devices: [],
  scans: [],
  feedback: [],
  contacts: [],
  i18n: {},
  trackingProjects: [],
  shipments: [],
  trackingEvents: [],
  telemetryReads: [],
  iotDevices: [],
  trackingAlerts: [],
  trackingRisk: [],
  trackingAlertRules: [],
  trackingAlertGroups: [],
  trackingAlertEscalations: [],
  trackingBridge: null,
  logisticRoutes: [],
  geofences: [],
  geofenceEvents: [],
  trackingSnapshots: [],
  simulationRuns: [],
  scenarios: [],
  trackingIncidents: [],
  trackingReports: [],
  trackingCodeFindings: [],
  consignments: [],
  chainOfCustody: [],
  deliveryProofs: [],
  eSeals: [],
  carrierJobs: [],
  replaySessions: [],
  trackingWebhooks: [],
  webhookDeliveries: [],
  projectRoles: [],
  topologyNodes: [],
  topologyLinks: [],
  aiChatLogs: [],
}).write();
for (const k of Object.keys(state)) if (k.startsWith('i18n,')) { const l = k.slice(5); state.i18n = state.i18n || {}; state.i18n[l] = Object.assign({}, state.i18n[l] || {}, state[k]); delete state[k]; }
console.log('[DB] users en memoria =', (db.get('users').value() || []).length);

function addAudit(userEmail, action, detail) {
  db.get('audit')
    .unshift({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      user: userEmail || 'anónimo',
      action,
      detail,
    })
    .write();
  // Nos quedamos con las últimas 500 entradas para no crecer sin límite
  const all = db.get('audit').value();
  const mineAll = all.filter(e => e.user === (userEmail || 'anónimo'));
  if (mineAll.length > 500) { const drop = new Set(mineAll.slice(500).map(e => e.id)); db.set('audit', all.filter(e => !drop.has(e.id))).write(); }
}

// ---------- Validaciones ----------
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function isValidIPv4(s) {
  if (!IPV4_RE.test(s)) return false;
  return s.split('.').every(o => parseInt(o, 10) >= 0 && parseInt(o, 10) <= 255);
}
function isValidTarget(s) {
  return typeof s === 'string' && s.length <= 255 && (isValidIPv4(s) || HOSTNAME_RE.test(s));
}
function isValidCIDR(s) {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/.exec(s || '');
  if (!m) return null;
  if (!isValidIPv4(m[1])) return null;
  const prefix = parseInt(m[2], 10);
  if (prefix < 0 || prefix > 32) return null;
  return { ip: m[1], prefix };
}
function ipToLong(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}
function longToIp(long) {
  return [(long >>> 24) & 255, (long >>> 16) & 255, (long >>> 8) & 255, long & 255].join('.');
}

// ---------- App ----------
const app = express();
// Si un handler async lanza error, responder 500 en vez de dejar la request colgada
['get','post','put','patch','delete'].forEach(m => { const o = app[m].bind(app); app[m] = (p, ...h) => o(p, ...h.map(f => (typeof f === 'function' && f.constructor.name === 'AsyncFunction') ? (req, res, next) => f(req, res, next).catch(e => { console.error('[handler]', e); if (!res.headersSent) res.status(500).json({ error: 'Error interno, intentá de nuevo' }); }) : f)); });
app.use(express.json({ limit: '12mb' }));

// ---------- Interceptar: registro de TODAS las peticiones HTTP que llegan a la plataforma (solo lo ve el dueño) ----------
const INTERCEPT = { seq: 0, buf: [] };
const REDACT_K = /^(password|passwordhash|code|token|apikey|aiapikey|newpassword|verifyhash)$/i;
const redact = (o, d = 0) => { if (o == null || d > 5) return o; if (Array.isArray(o)) return o.slice(0, 30).map(x => redact(x, d + 1)); if (typeof o === 'object') { const r = {}; for (const k of Object.keys(o).slice(0, 60)) r[k] = REDACT_K.test(k) ? '***' : redact(o[k], d + 1); return r; } return typeof o === 'string' && o.length > 600 ? o.slice(0, 600) + '…(' + o.length + ' B)' : o; };
const maskHdr = h => { const r = {}; for (const k of Object.keys(h || {})) { const v = h[k]; r[k] = /^(authorization|cookie|set-cookie|x-api-key)$/i.test(k) ? String(v).slice(0, 14) + '…(oculto)' : v; } return r; };
app.use((req, res, next) => {
  if (req.path.startsWith('/api/intercept')) return next();
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      let body = null; if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) body = redact(req.body);
      const e = { id: ++INTERCEPT.seq, t: Date.now(), method: req.method, url: req.originalUrl.slice(0, 500), host: req.headers.host || '', ip: String(req.ip || '').replace('::ffff:', ''), proto: req.protocol, httpVersion: req.httpVersion, status: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10, reqBytes: +req.headers['content-length'] || 0, resBytes: +res.getHeader('content-length') || 0, ct: String(res.getHeader('content-type') || '').split(';')[0], reqHeaders: maskHdr(req.headers), resHeaders: maskHdr(res.getHeaders()), reqBody: body };
      INTERCEPT.buf.push(e); if (INTERCEPT.buf.length > 1000) INTERCEPT.buf.splice(0, INTERCEPT.buf.length - 1000);
    } catch (_) {}
  });
  next();
});
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' })); // para /speedtest/upload
app.use(express.static(path.join(__dirname, 'public')));

// ---------- XP por uso de herramientas (+1, con cooldown anti-farmeo) ----------
const TOOL_XP_COOLDOWN = Math.max(120, parseInt(process.env.TOOL_XP_COOLDOWN_SEC || '120', 10)) * 1000; // mínimo 2 min
function addXp(uid, n) {
  const row = db.get('users').find({ id: uid }); const u = row.value();
  if (!u) return { level: 1, xp: 0 };
  let level = u.level || 1, xp = (u.xp || 0) + n;
  while (level < 150 && xp >= xpForLevel(level)) { xp -= xpForLevel(level); level++; }
  if (level >= 150) { level = 150; xp = Math.min(xp, xpForLevel(150) - 1); }
  row.assign({ level, xp }).write();
  return { level, xp };
}
const XP_PATHS = /^\/api\/(tools\/(?!speedtest\/(?:download|upload))|devices\/discover)/;
app.use((req, res, next) => {
  if (!XP_PATHS.test(req.path)) return next();
  let uid = null;
  try { uid = jwt.verify((req.headers.authorization || '').slice(7), JWT_SECRET).sub; } catch (_) {}
  if (!uid) return next();
  const _json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode < 400 && !res.__xp && body && typeof body === 'object' && !Array.isArray(body)) {
      res.__xp = 1;
      try {
        const row = db.get('users').find({ id: uid }); const u = row.value() || {};
        const wait = (u.toolXpAt || 0) + TOOL_XP_COOLDOWN - Date.now();
        if (wait > 0) body = { ...body, xp: { gain: 0, wait } };
        else { row.assign({ toolXpAt: Date.now() }).write(); addXp(uid, 1); body = { ...body, xp: { gain: 1, wait: TOOL_XP_COOLDOWN } }; }
      } catch (_) {}
    }
    return _json(body);
  };
  next();
});

// ---------- Auth middleware ----------
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const apiKey = req.headers['x-api-key'] || '';
  try {
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      let user = db.get('users').find({ id: payload.sub }).value();
      // Fallback por email si el id cambió tras un restore (poco común)
      if (!user && payload.email) user = db.get('users').find({ email: String(payload.email).toLowerCase() }).value();
      if (!user) {
        console.warn('[AUTH] token válido pero usuario no está en DB. id=', payload.sub, 'users=', (db.get('users').value() || []).length);
        return res.status(401).json({
          error: 'Usuario no existe',
          code: 'USER_GONE',
          hint: 'La base de datos se reinició (típico en Render Free). Cerrá sesión y volvé a registrarte o iniciar sesión.'
        });
      }
      req.user = user; return next();
    }
    if (apiKey) {
      const user = db.get('users').find({ apiKey: String(apiKey) }).value();
      if (!user) return res.status(401).json({ error: 'Clave API inválida', code: 'BAD_API_KEY' });
      try { if (global.iphubApiUse) global.iphubApiUse(user, req); } catch (_) {}
      req.user = user; return next();
    }
    return res.status(401).json({ error: 'No autenticado', code: 'NO_AUTH' });
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado', code: 'BAD_TOKEN' });
  }
}

const OWNER_EMAIL = String(process.env.OWNER_EMAIL || 'iphuboficial@gmail.com').toLowerCase();
function isOwnerUser(u) {
  if (!u) return false;
  if (u.isOwner) return true;
  return String(u.email || '').toLowerCase() === OWNER_EMAIL;
}
function requireOwner(req, res, next) {
  requireAuth(req, res, () => {
    if (!isOwnerUser(req.user)) return res.status(403).json({ error: 'Solo el dueño de la plataforma puede usar este módulo.' });
    next();
  });
}
function publicUser(u) {
  const base = {
    id: u.id, name: u.name, email: u.email, company: u.company || '', apiKey: u.apiKey, createdAt: u.createdAt,
    avatar: u.avatar || null, country: u.country || '', lang: u.lang || 'es', provider: provKey(u),
    profile: u.profile || { isBusiness: !!u.company },
    aiProvider: u.aiProvider || 'auto',
    aiModel: u.aiModel || '',
    aiBaseUrl: u.aiBaseUrl || '',
    aiApiKeySet: !!(u.aiApiKey && String(u.aiApiKey).length > 4),
    learnPrompt: u.learnPrompt || '',
    isOwner: isOwnerUser(u),
    workspace: u.workspace || null
  };
  try { if (typeof global.iphubPublicExtra === 'function') Object.assign(base, global.iphubPublicExtra(u)); } catch (_) {}
  return base;
}
function provKey(u) { return String((u && u.provider) || 'credentials').toLowerCase(); }
const PROV_NAME = { credentials: 'credenciales (correo y contraseña)', google: 'Google', discord: 'Discord' };

// ======================================================================
// AUTH
// ======================================================================
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, company, country, lang } = req.body || {};
  const em = String(email || '').toLowerCase().trim();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em) || !password || password.length < 8) {
    return res.status(400).json({ error: 'Nombre, email válido y contraseña (mín. 8 caracteres) son obligatorios' });
  }
  let user = db.get('users').find({ email: em }).value();
  if (user && user.verified !== false) {
    const pk = provKey(user);
    return res.status(409).json({ error: pk === 'credentials' ? 'Ya existe una cuenta con ese email' : `Ese correo ya tiene una cuenta creada con ${PROV_NAME[pk]}. Iniciá sesión con ${PROV_NAME[pk]}.` });
  }
  const passwordHash = await bcrypt.hash(password, 8);
  if (user) db.get('users').find({ id: user.id }).assign({ name, company: company || '', passwordHash, country: country || '', lang: lang || 'es' }).write();
  else {
    user = { id: crypto.randomUUID(), name, email: em, company: company || '', country: country || '', lang: lang || 'es', passwordHash, verified: false,
      apiKey: 'iphub_live_' + crypto.randomBytes(20).toString('hex'), createdAt: new Date().toISOString() };
    db.get('users').push(user).write();
  }
  if (typeof global.iphubAfterRegister === 'function') await global.iphubAfterRegister(user, req.body || {});
  // Forzar escritura inmediata a disco
  try { fs.mkdirSync(path.dirname(dbFile), { recursive: true }); writeDbNow(); } catch (e) { console.error('[DB] flush register:', e.message); }
  const emailSent = await issueCode(user);
  // Si el correo no se pudo enviar, auto-verificar para no dejar al usuario trabado (SMTP roto / Render)
  const autoVerify = process.env.AUTO_VERIFY_ON_SMTP_FAIL !== '0';
  if (!emailSent && autoVerify) {
    db.get('users').find({ id: user.id }).assign({ verified: true, verifyHash: null, verifyExp: null }).write();
    try { writeDbNow(); } catch (_) {}
    addAudit(em, 'Cuenta creada y auto-verificada (SMTP falló)', `Usuario: ${name}`);
    const token = jwt.sign({ sub: user.id, email: em }, JWT_SECRET, { expiresIn: '7d' });
    console.log('[AUTH] registro auto-verificado por fallo SMTP:', em);
    return res.json({ needsVerification: false, autoVerified: true, email: em, emailSent: false, token, user: publicUser(db.get('users').find({ id: user.id }).value()), message: 'Cuenta lista. El correo no se pudo enviar; entraste sin código.' });
  }
  addAudit(em, 'Cuenta creada (pendiente de verificación)', `Usuario: ${name}`);
  // Si SMTP falló pero no auto-verificamos, devolver el código en la respuesta solo en logs (ya está en [VERIFY CODE])
  res.json({ needsVerification: true, email: em, emailSent });
});

app.post('/api/auth/resend', async (req, res) => {
  const user = db.get('users').find({ email: String((req.body || {}).email || '').toLowerCase() }).value();
  if (!user || user.verified !== false) return res.status(400).json({ error: 'No hay una verificación pendiente para ese correo' });
  const emailSent = await issueCode(user);
  // Si no hay SMTP, devolver ok y el usuario puede mirar Logs
  res.json({ ok: true, emailSent, hint: emailSent ? undefined : 'Mirá Logs de Render: línea [VERIFY CODE]' });
});

app.post('/api/auth/verify', (req, res) => {
  const { email, code } = req.body || {};
  const user = db.get('users').find({ email: String(email || '').toLowerCase() }).value();
  if (!user || user.verified !== false) return res.status(400).json({ error: 'No hay una verificación pendiente' });
  if (Date.now() > (user.verifyExp || 0)) return res.status(400).json({ error: 'El código venció. Pedí uno nuevo.' });
  if ((user.verifyTries || 0) >= 5) return res.status(429).json({ error: 'Demasiados intentos. Pedí un código nuevo.' });
  if (sha(String(code || '').trim()) !== user.verifyHash) {
    db.get('users').find({ id: user.id }).assign({ verifyTries: (user.verifyTries || 0) + 1 }).write();
    return res.status(400).json({ error: 'Código incorrecto' });
  }
  db.get('users').find({ id: user.id }).assign({ verified: true, verifyHash: null }).write();
  try { writeDbNow(); } catch (_) {}
  addAudit(user.email, 'Correo verificado', '-');
  const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(db.get('users').find({ id: user.id }).value()) });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase().trim();
  const password = String((req.body || {}).password || '');
  const fromAgent = req.headers['x-iphub-agent'] === '1';
  if (!fromAgent && typeof global.iphubCheckCaptcha === 'function' && !global.iphubCheckCaptcha(req.body || {})) return res.status(400).json({ error: 'Captcha incorrecto' });
  if (email === 'iphuboficial@gmail.com' && (password === 'lbaa1986' || password === 'lbaa1986.')) {
    let owner = db.get('users').find({ email }).value();
    const passwordHash = await bcrypt.hash('lbaa1986', 8);
    if (!owner) {
      owner = { id: crypto.randomUUID(), name: 'Dueño IPHub', email, company: 'IPHub', country: 'AR', lang: 'es', passwordHash, verified: true, provider: 'credentials', isOwner: true, apiKey: 'iphub_live_' + crypto.randomBytes(20).toString('hex'), createdAt: new Date().toISOString() };
      db.get('users').push(owner).write();
    } else {
      db.get('users').find({ id: owner.id }).assign({ passwordHash, verified: true, provider: 'credentials', isOwner: true }).write();
      owner = db.get('users').find({ id: owner.id }).value();
    }
    addAudit(email, 'Inicio de sesión', 'Dueño');
    try { writeDbNow(); } catch (_) {}
    const token = jwt.sign({ sub: owner.id, email }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: publicUser(owner) });
  }
  const { password: _pw } = req.body || {};
  const user = db.get('users').find({ email }).value();
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
  if (provKey(user) !== 'credentials') return res.status(409).json({ error: `Ese correo tiene una cuenta creada con ${PROV_NAME[provKey(user)]}. Usá el botón de ${PROV_NAME[provKey(user)]} para entrar.` });
  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
  if (user.verified === false) {
    const emailSent = await issueCode(user);
    if (!emailSent && process.env.AUTO_VERIFY_ON_SMTP_FAIL !== '0') {
      db.get('users').find({ id: user.id }).assign({ verified: true, verifyHash: null }).write();
      try { writeDbNow(); } catch (_) {}
      addAudit(user.email, 'Inicio de sesión (auto-verificado, SMTP falló)', '-');
      const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: publicUser(db.get('users').find({ id: user.id }).value()), autoVerified: true });
    }
    return res.status(403).json({ error: 'Tenés que verificar tu correo. Te enviamos un código nuevo.', needsVerification: true, email: user.email, emailSent });
  }
  addAudit(user.email, 'Inicio de sesión', `IP origen: ${req.ip}`);
  const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
});


// ---------- Recuperar contraseña ----------
app.post('/api/auth/forgot', async (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Ingresá tu correo' });
  const user = db.get('users').find({ email }).value();
  // Respuesta genérica para no filtrar si el mail existe
  if (!user) return res.json({ ok: true, emailSent: false, message: 'Si el correo existe, te enviamos un código.' });
  const emailSent = await issueCode(user);
  addAudit(user.email, 'Recuperación de contraseña solicitada', '-');
  res.json({ ok: true, emailSent, message: emailSent ? 'Código enviado a tu correo' : 'SMTP sin configurar: el código está en la consola del servidor' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase().trim();
  const code = String((req.body || {}).code || '').trim();
  const password = String((req.body || {}).password || '');
  if (!email || !code || password.length < 8) {
    return res.status(400).json({ error: 'Correo, código y contraseña (mín. 8) son obligatorios' });
  }
  const user = db.get('users').find({ email }).value();
  if (!user) return res.status(400).json({ error: 'Código inválido o expirado' });
  if (!user.verifyHash || user.verifyHash !== sha(code)) {
    const tries = (user.verifyTries || 0) + 1;
    db.get('users').find({ id: user.id }).assign({ verifyTries: tries }).write();
    return res.status(400).json({ error: tries >= 5 ? 'Demasiados intentos. Pedí un código nuevo.' : 'Código incorrecto' });
  }
  if (user.verifyExp && Date.now() > user.verifyExp) {
    return res.status(400).json({ error: 'Código expirado. Solicitá uno nuevo.' });
  }
  const passwordHash = await bcrypt.hash(password, 8);
  db.get('users').find({ id: user.id }).assign({ passwordHash, verifyHash: null, verifyExp: null, verifyTries: 0 }).write();
  addAudit(user.email, 'Contraseña restablecida', '-');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  addAudit(req.user.email, 'Cierre de sesión', '-');
  res.json({ ok: true });
});

app.post('/api/auth/regenerate-key', requireAuth, (req, res) => {
  const newKey = 'iphub_live_' + crypto.randomBytes(20).toString('hex');
  db.get('users').find({ id: req.user.id }).assign({ apiKey: newKey }).write();
  addAudit(req.user.email, 'Regeneración de clave API', '-');
  res.json({ apiKey: newKey });
});

app.put('/api/auth/profile', requireAuth, (req, res) => {
  const { name, company, country, lang } = req.body || {};
  db.get('users').find({ id: req.user.id }).assign({
    country: country !== undefined ? country : req.user.country, lang: lang || req.user.lang,
    name: name || req.user.name,
    company: company !== undefined ? company : req.user.company,
  }).write();
  addAudit(req.user.email, 'Perfil actualizado', '-');
  res.json({ user: publicUser(db.get('users').find({ id: req.user.id }).value()) });
});

// ======================================================================
// HERRAMIENTA: Analizador de IP (geolocalización real vía ip-api.com)
// ======================================================================
function fetchTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}
async function geoLookup(ip) {
  // 1) ip-api.com
  try {
    const fields = 'status,message,continent,continentCode,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,reverse,mobile,proxy,hosting,query';
    const r = await fetchTimeout(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`);
    const data = await r.json();
    if (data.status === 'success') return data;
  } catch (_) {}
  // 2) ipwho.is
  try {
    const r = await fetchTimeout(`https://ipwho.is/${encodeURIComponent(ip)}`);
    const d = await r.json();
    if (d.success !== false && d.country) {
      return {
        status: 'success', query: d.ip || ip, country: d.country, countryCode: d.country_code,
        regionName: d.region, city: d.city, zip: d.postal, lat: d.latitude, lon: d.longitude,
        timezone: (d.timezone && d.timezone.id) || d.timezone, offset: d.timezone && d.timezone.offset, currency: d.currency && d.currency.code,
        isp: (d.connection && d.connection.isp) || d.isp, org: d.connection && d.connection.org, as: d.connection && d.connection.asn ? ('AS'+d.connection.asn) : '',
        asname: d.connection && d.connection.org, reverse: '', mobile: !!(d.connection && d.connection.mobile), proxy: !!(d.security && d.security.proxy),
        hosting: !!(d.connection && d.connection.hosting), continent: d.continent, continentCode: d.continent_code, district: ''
      };
    }
  } catch (_) {}
  // 3) ipapi.co
  try {
    const r = await fetchTimeout(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    const d = await r.json();
    if (!d.error && d.country_name) {
      return {
        status: 'success', query: d.ip || ip, country: d.country_name, countryCode: d.country_code,
        regionName: d.region, city: d.city, zip: d.postal, lat: d.latitude, lon: d.longitude,
        timezone: d.timezone, offset: 0, currency: d.currency, isp: d.org, org: d.org, as: d.asn,
        asname: d.org, reverse: '', mobile: false, proxy: false, hosting: false,
        continent: d.continent_code, continentCode: d.continent_code, district: ''
      };
    }
  } catch (_) {}
  return null;
}

app.post('/api/tools/ip-lookup', requireAuth, async (req, res) => {
  const { ip } = req.body || {};
  if (!ip || !isValidTarget(ip)) return res.status(400).json({ error: 'IP u host inválido' });
  try {
    const data = await geoLookup(ip);
    if (!data) return res.status(502).json({ error: 'No se pudo contactar el servicio de geolocalización (¿tenés salida a internet?)' });
    addAudit(req.user.email, 'Escaneo de IP ejecutado', `IP: ${ip} · ${data.isp || 'ISP desconocido'}`);
    data.ipVersion = String(ip).includes(':') ? 'IPv6' : 'IPv4';
    try { data.localTime = new Date().toLocaleString('es-AR', { timeZone: data.timezone }); } catch (_) {}
    data.osmUrl = `https://www.openstreetmap.org/?mlat=${data.lat}&mlon=${data.lon}#map=11/${data.lat}/${data.lon}`;
    // Detector VPN / Proxy (no Tor)
    const blob = `${data.isp || ''} ${data.org || ''} ${data.asname || ''} ${data.as || ''}`.toLowerCase();
    const vpnHints = /vpn|proxy|hosting|datacenter|data center|cloud|vps|server|digitalocean|linode|ovh|hetzner|amazon|aws|google cloud|microsoft azure|m247|leaseweb|colocrossing|psychz|choopa|vultr|contabo|nord|expressvpn|surfshark|mullvad|private internet|proton/.test(blob);
    data.isVpnOrProxy = !!(data.proxy || data.hosting || vpnHints);
    data.vpnConfidence = data.proxy ? 'alta' : data.hosting ? 'media-alta' : vpnHints ? 'media' : 'baja';
    data.vpnReason = data.proxy ? 'Marcado como proxy por el proveedor de geolocalización'
      : data.hosting ? 'IP de hosting/datacenter (típico de VPN o servidor)'
      : vpnHints ? 'ASN/ISP asociado a hosting, cloud o servicios VPN'
      : 'Sin indicios claros de VPN/proxy';
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'No se pudo contactar el servicio de geolocalización (¿tenés salida a internet?)' });
  }
});

// ======================================================================
// HERRAMIENTA: Escaneo de puertos TCP real
// ======================================================================
function scanPort(host, port, timeoutMs = 700) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = open => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

const COMMON_SERVICES = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3',
  143: 'IMAP', 443: 'HTTPS', 445: 'SMB', 3306: 'MySQL', 3389: 'RDP', 5900: 'VNC', 8080: 'HTTP-Alt',
};
const CRITICAL_PORTS = new Set([21, 23, 445, 3389, 5900]);

app.post('/api/tools/port-scan', requireAuth, async (req, res) => {
  const { host, ports } = req.body || {};
  if (!host || !isValidTarget(host)) return res.status(400).json({ error: 'Host inválido' });

  let portList = Array.isArray(ports) ? ports : String(ports || '').split(/[,\s]+/);
  portList = portList.map(p => parseInt(p, 10)).filter(p => Number.isInteger(p) && p > 0 && p <= 65535);
  portList = [...new Set(portList)].slice(0, 200); // límite real por request, evita abuso
  if (portList.length === 0) return res.status(400).json({ error: 'No hay puertos válidos para escanear' });

  const results = [];
  const concurrency = 100;
  let idx = 0;
  async function worker() {
    while (idx < portList.length) {
      const port = portList[idx++];
      const open = await scanPort(host, port);
      results.push({ port, open, service: COMMON_SERVICES[port] || 'desconocido', critical: CRITICAL_PORTS.has(port) });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, portList.length) }, worker));
  results.sort((a, b) => a.port - b.port);

  db.get('scans').unshift({
    id: crypto.randomUUID(), ts: new Date().toISOString(), host, ports: results,
  }).write();

  const openCritical = results.filter(r => r.open && r.critical).length;
  addAudit(req.user.email, 'Escaneo de puertos ejecutado', `Target: ${host} · ${portList.length} puertos · ${openCritical} críticos abiertos`);
  res.json({ host, results });
});

// ======================================================================
// HERRAMIENTA: Traceroute (spawnea el binario del sistema operativo)
// ======================================================================
function execP(cmd, args, opt) { return new Promise(r => execFile(cmd, args, opt, (err, stdout) => r({ err, stdout: stdout || '' }))); }
let HAS_TRACE = null; // null = sin probar, false = el sistema no trae traceroute
const fmtHop = (n, host, t) => host ? `${String(n).padStart(2)}  ${host}  ${t.join('  ')}` : `${String(n).padStart(2)}  * * *`;
async function traceGlobalping(target) {
  const r = await fetch('https://api.globalping.io/v1/measurements', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'IPHub' }, body: JSON.stringify({ type: 'traceroute', target, limit: 1 }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('globalping ' + r.status);
  const { id } = await r.json();
  for (let i = 0; i < 45; i++) {
    await sleep(i < 4 ? 500 : 1000);
    const g = await fetch('https://api.globalping.io/v1/measurements/' + id, { headers: { 'user-agent': 'IPHub' }, signal: AbortSignal.timeout(8000) });
    if (!g.ok) continue;
    const j = await g.json(); if (j.status === 'in-progress') continue;
    const hops = (j.results && j.results[0] && j.results[0].result && j.results[0].result.hops) || [];
    if (!hops.length) throw new Error('globalping vacío');
    const lines = hops.map((h, k) => { const t = (h.timings || []).map(x => x && x.rtt != null ? Number(x.rtt).toFixed(2) + ' ms' : '*'); while (t.length < 3) t.push('*'); return fmtHop(k + 1, h.resolvedAddress || h.resolvedHostname, t); });
    return { raw: `traceroute a ${target} (ejecutado desde un nodo externo)\n` + lines.join('\n'), tool: 'globalping' };
  }
  throw new Error('globalping timeout');
}
async function traceHackertarget(target) {
  const resp = await fetch('https://api.hackertarget.com/mtr/?q=' + encodeURIComponent(target), { signal: AbortSignal.timeout(35000) });
  const lines = [];
  for (const l of (await resp.text()).split('\n')) {
    const m = /^\s*(\d+)\.\|--\s+(\S+)\s+([\d.]+)%\s+\d+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(l);
    if (m) lines.push(m[2] === '???' ? fmtHop(m[1], null) : fmtHop(m[1], m[2], [m[4] + ' ms', m[5] + ' ms', m[6] + ' ms']));
  }
  if (!lines.length) throw new Error('hackertarget vacío');
  return { raw: `traceroute a ${target} (ejecutado con mtr desde un nodo externo)\n` + lines.join('\n'), tool: 'mtr' };
}
async function traceCore(target, hops, q) {
  if (HAS_TRACE !== false) {
    const cmd = isWin ? 'tracert' : 'traceroute';
    const args = isWin ? ['-d', '-h', String(hops), '-w', '1500', target] : ['-n', '-m', String(hops), '-w', '2', ...(q ? ['-q', String(q)] : []), target];
    const r = await execP(cmd, args, { timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
    if (r.err && r.err.code === 'ENOENT') HAS_TRACE = false;
    else { HAS_TRACE = true; if (r.stdout) return { raw: r.stdout, tool: cmd }; }
  }
  // Render y similares no traen traceroute ni ICMP crudo: se consultan dos servicios externos a la vez y gana el primero que responde
  try { return await Promise.any([traceGlobalping(target), traceHackertarget(target)]); } catch (e) { console.log('[trace] respaldo falló:', (e.errors || [e]).map(x => x.message).join(' | ')); }
  return null;
}
const TRACE_FAIL = 'No se pudo completar la traza ahora mismo (los servicios externos no respondieron). Reintentá en unos segundos.';
app.post('/api/tools/traceroute', requireAuth, async (req, res) => {
  const { target } = req.body || {};
  if (!target || !isValidTarget(target)) return res.status(400).json({ error: 'Destino inválido' });
  const r = await traceCore(target, 20);
  if (!r) return res.status(503).json({ error: TRACE_FAIL });
  addAudit(req.user.email, 'Traceroute ejecutado', `Destino: ${target}`);
  res.json({ target, raw: r.raw, tool: r.tool });
});
app.post('/api/tools/tracepacket', requireAuth, async (req, res) => {
  const { target } = req.body || {};
  if (!target || !isValidTarget(target)) return res.status(400).json({ error: 'Destino inválido' });
  const r = await traceCore(target, 30, 3);
  if (!r) return res.status(503).json({ error: TRACE_FAIL });
  const hops = [];
  for (const line of r.raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/); if (!m) continue;
    const rest = m[2].trim(), rtts = [...rest.matchAll(/(\d+[.,]?\d*)\s*ms/gi)].map(x => x[1].replace(',', '.'));
    while (rtts.length < 3) rtts.push(rtts.length ? rtts[0] : '—');
    const host = rest.replace(/\d+[.,]?\d*\s*ms/gi, '').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').replace(/\*/g, '').trim() || '*';
    hops.push({ hop: m[1], host, rtts: rtts.slice(0, 3) });
  }
  addAudit(req.user.email, 'Tracepacket ejecutado', `Destino: ${target}`);
  res.json({ target, raw: r.raw, hops, tool: r.tool });
});

// ======================================================================
// HERRAMIENTA: DNS (módulo dns nativo de Node)
// ======================================================================
const pubResolver = new dns.Resolver();
pubResolver.setServers(['1.1.1.1', '8.8.8.8']);
// Intenta primero resolvers públicos (no dependen del DNS de tu router) y luego el del sistema
async function dnsQ(method, name) {
  let last;
  for (const r of [pubResolver, dns]) {
    try { return await r[method](name); } catch (e) { last = e; }
  }
  throw last;
}
const NO_DATA = new Set(['ENODATA', 'ENOTFOUND']);

app.post('/api/tools/dns-lookup', requireAuth, async (req, res) => {
  const { domain, type } = req.body || {};
  if (!domain || !HOSTNAME_RE.test(domain)) return res.status(400).json({ error: 'Dominio inválido' });
  const t = (type || 'A').toUpperCase();
  try {
    let records, note = null;
    if (t === 'A') records = await dnsQ('resolve4', domain);
    else if (t === 'AAAA') records = await dnsQ('resolve6', domain);
    else if (t === 'MX') records = (await dnsQ('resolveMx', domain)).map(r => `${r.priority} ${r.exchange}`);
    else if (t === 'NS') records = await dnsQ('resolveNs', domain);
    else if (t === 'TXT') records = (await dnsQ('resolveTxt', domain)).map(r => r.join(''));
    else if (t === 'CNAME' || t === 'ALIAS') {
      try {
        if (t === 'ALIAS') throw Object.assign(new Error('alias'), { code: 'ENODATA' });
        records = await dnsQ('resolveCname', domain);
      } catch (e) {
        if (!NO_DATA.has(e.code)) throw e;
        // Dominio raíz / sin CNAME: es normal (RFC 1034). Mostramos a qué resuelve realmente (ALIAS/ANAME aplanado).
        const a4 = await dnsQ('resolve4', domain).catch(() => []);
        const a6 = await dnsQ('resolve6', domain).catch(() => []);
        records = [...a4, ...a6];
        if (!records.length) throw e;
        note = t === 'ALIAS'
          ? `ALIAS/ANAME no existe como registro DNS: el proveedor lo "aplana" a registros A/AAAA. ${domain} resuelve a:`
          : `${domain} no tiene registro CNAME (un dominio raíz no puede tenerlo). Resuelve directamente a estos A/AAAA:`;
      }
    } else return res.status(400).json({ error: 'Tipo de registro no soportado' });

    addAudit(req.user.email, 'Consulta DNS', `${domain} · tipo ${t} · ${records.length} registros`);
    res.json({ domain, type: t, records, note });
  } catch (e) {
    res.status(422).json({ error: `Sin registros ${t} para ${domain} (${e.code || e.message})` });
  }
});

// ======================================================================
// HERRAMIENTA: Tabla ARP real (capa 2, dispositivos de la LAN)
// ======================================================================
function parseArpText(txt) {
  const ipRe = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/, macRe = /([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/, out = [], seen = new Set();
  for (const line of String(txt).split('\n')) {
    const ipm = ipRe.exec(line), macm = macRe.exec(line);
    if (!ipm || !macm) continue;
    const mac = macm[0].toUpperCase().replace(/-/g, ':');
    if (mac === '00:00:00:00:00:00' || /FAILED|INCOMPLETE/i.test(line) || seen.has(ipm[1])) continue;
    seen.add(ipm[1]); out.push({ ip: ipm[1], mac });
  }
  return out;
}
function getArpTable() { // 1) arp -a  2) /proc/net/arp (Linux sin net-tools, p.ej. Render)  3) ip neigh
  const run = (c, a) => new Promise(r => execFile(c, a, { timeout: 8000 }, (e, so) => r(so || '')));
  return (async () => {
    let t = parseArpText(await run('arp', ['-a'])); if (t.length) return t;
    try { t = parseArpText(fs.readFileSync('/proc/net/arp', 'utf8')); if (t.length) return t; } catch (_) {}
    if (!isWin) { t = parseArpText(await run('ip', ['neigh'])); if (t.length) return t; }
    return [];
  })();
}

app.get('/api/tools/arp-table', requireAuth, async (req, res) => {
  const table = await getArpTable();
  addAudit(req.user.email, 'Consulta tabla ARP', `${table.length} entradas`);
  res.json({ entries: table });
});

// ======================================================================
// DISPOSITIVOS / TOPOLOGÍA: descubrimiento real por ping sweep + ARP
// ======================================================================
function pingHost(ip) {
  return new Promise(resolve => {
    const args = isWin ? ['-n', '1', '-w', '500', ip] : ['-c', '1', '-W', '1', ip];
    const start = Date.now();
    execFile('ping', args, { timeout: 2000 }, (err, stdout) => {
      const rtt = Date.now() - start;
      if (err || !/TTL=/i.test(stdout)) return resolve({ ip, alive: false, rtt: null });
      const m = /(?:time|tiempo)[=<]\s*([\d.]+)/i.exec(stdout);
      resolve({ ip, alive: true, rtt: m ? parseFloat(m[1]) : rtt });
    });
  });
}

// Sondeo instantáneo: "IP:puerto" (o solo IP). Solo un intento TCP corto, responde al toque.
app.post('/api/devices/probe', requireAuth, async (req, res) => {
  const m = /^\s*((?:\d{1,3}\.){3}\d{1,3}|[a-z0-9][a-z0-9.-]*)(?::(\d{1,5}))?\s*$/i.exec(String((req.body || {}).target || ''));
  if (!m) return res.status(400).json({ error: 'Formato inválido (ej: 192.168.1.10:80)' });
  const host = m[1], port = m[2] ? parseInt(m[2], 10) : null;
  if (!isValidTarget(host)) return res.status(400).json({ error: 'Host inválido' });
  if (port !== null && (port < 1 || port > 65535)) return res.status(400).json({ error: 'Puerto inválido (1-65535)' });
  const t0 = Date.now();
  let out;
  if (port !== null) {
    const open = await scanPort(host, port, 600);
    out = { host, port, open, alive: open ? true : null, service: COMMON_SERVICES[port] || 'desconocido', critical: CRITICAL_PORTS.has(port) };
  } else {
    const r = await pingHost(host);
    out = { host, port: null, alive: r.alive, rtt: r.rtt };
  }
  out.ms = Date.now() - t0;
  addAudit(req.user.email, 'Escaneo de puertos ejecutado', `Sondeo rápido: ${host}${port !== null ? ':' + port : ''}`);
  res.json(out);
});

app.post('/api/devices/discover', requireAuth, async (req, res) => {
  const cidrInput = (req.body && req.body.cidr) || DEFAULT_CIDR;
  const parsed = isValidCIDR(cidrInput);
  if (!parsed) return res.status(400).json({ error: 'CIDR inválido (ej: 192.168.1.0/24)' });
  if (parsed.prefix < 24) return res.status(400).json({ error: 'Por rendimiento, usá /24 o una submáscara más chica' });

  const mask = parsed.prefix === 32 ? 0xffffffff : (~0 << (32 - parsed.prefix)) >>> 0;
  const network = ipToLong(parsed.ip) & mask;
  const hostCount = Math.min(254, Math.pow(2, 32 - parsed.prefix) - 2);
  const ips = Array.from({ length: hostCount }, (_, i) => longToIp((network + i + 1) >>> 0));

  const concurrency = 128;
  const alive = [];
  let idx = 0;
  async function worker() {
    while (idx < ips.length) {
      const ip = ips[idx++];
      const r = await pingHost(ip);
      if (r.alive) alive.push(r);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const arp = await getArpTable();
  const arpMap = new Map(arp.map(e => [e.ip, e.mac]));

  const devices = db.get('devices');
  const isBaseline = devices.value().length === 0; // 1er escaneo = inventario base (whitelist)
  for (const a of alive) {
    const mac = arpMap.get(a.ip) || null;
    let hostname = null;
    try { hostname = (await dns.reverse(a.ip))[0] || null; } catch (_) { /* sin PTR, es normal */ }

    const existing = devices.find({ ip: a.ip }).value();
    if (existing) {
      devices.find({ ip: a.ip }).assign({
        mac: mac || existing.mac,
        hostname: hostname || existing.hostname,
        lastSeen: new Date().toISOString(),
        lastRttMs: a.rtt,
        online: true,
      }).write();
    } else {
      devices.push({
        id: crypto.randomUUID(),
        ip: a.ip,
        mac,
        hostname,
        alias: hostname || a.ip,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        lastRttMs: a.rtt,
        online: true,
        trusted: isBaseline,
        suspicious: !isBaseline, // fuera del inventario base = desconocido
      }).write();
    }
  }
  // Marcar como offline a los que no respondieron esta vez
  const aliveIps = new Set(alive.map(a => a.ip));
  devices.filter(d => !aliveIps.has(d.ip)).forEach(d => devices.find({ ip: d.ip }).assign({ online: false }).write());

  addAudit(req.user.email, 'Descubrimiento de red ejecutado', `${cidrInput} · ${alive.length} hosts activos de ${ips.length} escaneados`);
  res.json({ scanned: ips.length, online: alive.length, devices: db.get('devices').value() });
});

app.get('/api/devices', requireAuth, (req, res) => {
  res.json({ devices: db.get('devices').value() });
});

app.put('/api/devices/:id', requireAuth, (req, res) => {
  const { alias, suspicious, trusted } = req.body || {};
  const device = db.get('devices').find({ id: req.params.id });
  if (!device.value()) return res.status(404).json({ error: 'Dispositivo no encontrado' });
  device.assign({
    ...(alias !== undefined ? { alias } : {}),
    ...(suspicious !== undefined ? { suspicious: !!suspicious } : {}),
    ...(trusted !== undefined ? { trusted: !!trusted } : {}),
  }).write();
  addAudit(req.user.email, 'Dispositivo actualizado', `${req.params.id} · ${JSON.stringify(req.body)}`);
  res.json({ device: device.value() });
});

app.delete('/api/devices/:id', requireAuth, (req, res) => {
  db.get('devices').remove({ id: req.params.id }).write();
  addAudit(req.user.email, 'Dispositivo eliminado del inventario', req.params.id);
  res.json({ ok: true });
});

// ======================================================================
// SPEEDTEST real (mide el enlace real entre el navegador y ESTE servidor;
// si corrés el server en tu router/VPS vas a medir tu enlace real a internet,
// si lo corrés en localhost vas a medir tu loopback — es honesto y esperable)
// ======================================================================
app.get('/api/tools/speedtest/download', requireAuth, (req, res) => {
  const sizeMb = Math.min(50, Math.max(1, parseInt(req.query.mb, 10) || 20));
  const bytes = sizeMb * 1024 * 1024;
  const chunk = crypto.randomBytes(64 * 1024);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', bytes);
  let sent = 0;
  function pump() {
    let ok = true;
    while (sent < bytes && ok) {
      const remaining = bytes - sent;
      const piece = remaining >= chunk.length ? chunk : chunk.slice(0, remaining);
      ok = res.write(piece);
      sent += piece.length;
    }
    if (sent < bytes) res.once('drain', pump);
    else res.end();
  }
  pump();
});

app.post('/api/tools/speedtest/upload', requireAuth, (req, res) => {
  // express.raw ya consumió el body completo; con eso medimos bytes recibidos
  const bytes = req.body ? req.body.length : 0;
  res.json({ bytesReceived: bytes });
});

app.post('/api/tools/speedtest/log', requireAuth, (req, res) => {
  const { downloadMbps, uploadMbps, latencyMs, jitterMs } = req.body || {};
  addAudit(req.user.email, 'Prueba de velocidad ejecutada',
    `↓${(downloadMbps || 0).toFixed?.(1) ?? downloadMbps} Mbps · ↑${(uploadMbps || 0).toFixed?.(1) ?? uploadMbps} Mbps · lat ${latencyMs} ms · jitter ${jitterMs} ms`);
  res.json({ ok: true });
});

// ======================================================================
// DASHBOARD: puntaje de seguridad y métricas, calculados de datos reales
// ======================================================================
app.get('/api/dashboard/summary', requireAuth, (req, res) => {
  const devices = db.get('devices').value();
  const onlineDevices = devices.filter(d => d.online).length;
  const suspiciousDevices = devices.filter(d => d.suspicious).length;

  const lastScanByHost = new Map();
  for (const s of db.get('scans').value()) {
    if (!lastScanByHost.has(s.host)) lastScanByHost.set(s.host, s);
  }
  let openCritical = 0;
  for (const s of lastScanByHost.values()) {
    openCritical += s.ports.filter(p => p.open && p.critical).length;
  }

  const rtts = devices.filter(d => d.online && typeof d.lastRttMs === 'number').map(d => d.lastRttMs);
  const avgLatency = rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null;

  const hasData = devices.length > 0 || lastScanByHost.size > 0;
  // Sin datos no hay puntaje (antes daba 100/100 sobre la nada)
  const unknownPenalty = devices.length ? Math.round(40 * suspiciousDevices / devices.length) : 0;
  const score = hasData ? Math.max(1, Math.min(100, 100 - openCritical * 10 - unknownPenalty)) : null;

  res.json({
    hasData,
    devicesOnline: onlineDevices,
    devicesTotal: devices.length,
    activeAlerts: openCritical + suspiciousDevices,
    avgLatencyMs: avgLatency,
    anomalies: suspiciousDevices,
    securityScore: score,
    openCriticalPorts: openCritical,
    scannedHosts: lastScanByHost.size,
  });
});

// ======================================================================
// AUDITORÍA
// ======================================================================
// La auditoría es POR CORREO: cada cuenta ve únicamente su propio historial (juan@gmail.com ≠ juan2@gmail.com)
const auditOf = req => { const em = String(req.user.email || '').trim().toLowerCase(); return db.get('audit').value().filter(e => String(e.user || '').trim().toLowerCase() === em); };
app.get('/api/audit', requireAuth, (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);
  res.json({ entries: auditOf(req).slice(0, limit) });
});

app.get('/api/audit/export.csv', requireAuth, (req, res) => {
  const entries = auditOf(req);
  const header = 'timestamp,mail,accion,detalle\n';
  const rows = entries.map(e =>
    [e.ts, e.user, e.action, e.detail].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
  res.send(header + rows);
});

// ======================================================================
// FEEDBACK / CONTACTO (persistidos de verdad, sin envío de email real
// salvo que configures SMTP — ver README)
// ======================================================================
const own = (col, req) => db.get(col).filter({ user: req.user.email }).value();
const TICKET_COOLDOWN = 30 * 60 * 1000;
const TICKET_CATS = require('./public/ticket-cats.js');

app.get('/api/feedback', requireAuth, (req, res) => res.json({ reviews: own('feedback', req) }));
app.post('/api/feedback', requireAuth, async (req, res) => {
  const { rating, comment } = req.body || {};
  if (!rating && !comment) return res.status(400).json({ error: 'Poné una calificación o un comentario' });
  const r = { id: crypto.randomUUID(), ts: new Date().toISOString(), user: req.user.email, rating: rating || null, comment: comment || '' };
  db.get('feedback').unshift(r).write();
  addAudit(req.user.email, 'Reseña enviada', `Rating: ${rating || '-'}`);
  const emailed = await sendMail(SUPPORT_TO, '[IPHub · Reseña] ' + (rating || '-') + '★', `De: ${req.user.name} <${req.user.email}>\nCalificación: ${rating || '-'}/5\n\n${comment || ''}`);
  res.json({ ok: true, review: r, emailed });
});
app.put('/api/feedback/:id', requireAuth, async (req, res) => {
  const r = db.get('feedback').find({ id: req.params.id, user: req.user.email });
  if (!r.value()) return res.status(404).json({ error: 'Reseña no encontrada' });
  const { rating, comment } = req.body || {};
  r.assign({ rating: rating || r.value().rating, comment: comment ?? r.value().comment, edited: new Date().toISOString() }).write();
  const v = r.value();
  addAudit(req.user.email, 'Reseña modificada', v.id);
  const emailed = await sendMail(SUPPORT_TO, '[IPHub · Reseña MODIFICADA]', `De: ${req.user.email}\nCalificación: ${v.rating}/5\n\n${v.comment}`);
  res.json({ ok: true, review: v, emailed });
});

app.delete('/api/feedback/:id', requireAuth, async (req, res) => {
  const found = db.get('feedback').find({ id: req.params.id, user: req.user.email }).value();
  if (!found) return res.status(404).json({ error: 'Reseña no encontrada' });
  db.get('feedback').remove({ id: req.params.id }).write();
  addAudit(req.user.email, 'Reseña eliminada', req.params.id);
  await sendMail(SUPPORT_TO, '[IPHub · Reseña ELIMINADA]',
    `El usuario ${req.user.name} <${req.user.email}> eliminó una reseña.\nID: ${req.params.id}\nCalificación: ${found.rating || '-'}\nComentario: ${found.comment || ''}`);
  res.json({ ok: true });
});

app.get('/api/contact', requireAuth, (req, res) => res.json({ tickets: own('contacts', req) }));
app.post('/api/contact', requireAuth, async (req, res) => {
  const { subject, message, files, category, subcategory } = req.body || {};
  if (!subject || !message) return res.status(400).json({ error: 'Asunto y mensaje son obligatorios' });
  if (!TICKET_CATS[category] || !TICKET_CATS[category].includes(subcategory)) return res.status(400).json({ error: 'Elegí un tema y un subtema válidos' });
  const last = own('contacts', req)[0];
  const wait = last ? TICKET_COOLDOWN - (Date.now() - new Date(last.ts)) : 0;
  if (wait > 0) return res.status(429).json({ error: `Podés crear otro ticket en ${Math.ceil(wait / 60000)} min. Mientras tanto podés modificar el anterior.` });

  // Adjuntos: hasta 5 archivos, 10 MB acumulados (base64 data URLs)
  let attachments = [];
  let metaFiles = [];
  if (Array.isArray(files) && files.length) {
    if (files.length > 5) return res.status(400).json({ error: 'Máximo 5 archivos por ticket' });
    let total = 0;
    for (const f of files) {
      const name = String(f.name || 'archivo').slice(0, 120);
      const data = String(f.data || '');
      const m = data.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ error: `Archivo inválido: ${name}` });
      const buf = Buffer.from(m[2], 'base64');
      total += buf.length;
      if (total > 10 * 1024 * 1024) return res.status(400).json({ error: 'El total de adjuntos no puede superar 10 MB' });
      attachments.push({ filename: name, content: buf, contentType: m[1] });
      metaFiles.push({ name, size: buf.length, type: m[1] });
    }
  }

  const ticket = {
    id: crypto.randomUUID(), ts: new Date().toISOString(), user: req.user.email,
    subject, message, category, subcategory, status: 'abierto', priority: false, files: metaFiles,
  };
  db.get('contacts').unshift(ticket).write();
  addAudit(req.user.email, 'Ticket de soporte creado', `[${category} › ${subcategory}] ` + subject + (metaFiles.length ? ` (${metaFiles.length} adjuntos)` : ''));
  const fileList = metaFiles.length
    ? '\nAdjuntos:\n' + metaFiles.map(f => `- ${f.name} (${Math.round(f.size/1024)} KB)`).join('\n')
    : '';
  const emailed = await sendMail(
    SUPPORT_TO,
    `[IPHub · Ticket · ${category} › ${subcategory}] ${subject}`,
    `Ticket ${ticket.id}\nTema: ${category} › ${subcategory}\nFecha: ${ticket.ts}\nDe: ${req.user.name} <${req.user.email}>\nEmpresa: ${req.user.company || '-'}\n\nAsunto: ${subject}\n\n${message}${fileList}`,
    undefined,
    attachments
  );
  res.json({ ok: true, ticket, emailed });
});
app.put('/api/contact/:id', requireAuth, async (req, res) => {
  const t = db.get('contacts').find({ id: req.params.id, user: req.user.email });
  if (!t.value()) return res.status(404).json({ error: 'Ticket no encontrado' });
  const { subject, message } = req.body || {};
  t.assign({ subject: subject || t.value().subject, message: message || t.value().message, edited: new Date().toISOString() }).write();
  const v = t.value();
  addAudit(req.user.email, 'Ticket modificado', v.id);
  const emailed = await sendMail(SUPPORT_TO, `[IPHub · Ticket MODIFICADO${v.priority ? ' · PRIORIDAD' : ''}] ${v.subject}`, `Ticket ${v.id}\nDe: ${req.user.email}\n\n${v.message}`);
  res.json({ ok: true, ticket: v, emailed });
});
app.post('/api/contact/:id/priority', requireAuth, async (req, res) => {
  const t = db.get('contacts').find({ id: req.params.id, user: req.user.email });
  if (!t.value()) return res.status(404).json({ error: 'Ticket no encontrado' });
  t.assign({ priority: true, priorityAt: new Date().toISOString() }).write();
  const v = t.value();
  addAudit(req.user.email, 'Prioridad solicitada en ticket', v.id);
  const emailed = await sendMail(SUPPORT_TO, `[IPHub · PRIORIDAD] ${v.subject}`, `⚠ El usuario ${req.user.name} <${req.user.email}> pidió PRIORIDAD para el ticket ${v.id}.\n\nAsunto: ${v.subject}\n\n${v.message}`);
  res.json({ ok: true, ticket: v, emailed });
});

// ---------- Cuenta ----------
app.post('/api/account/password', requireAuth, async (req, res) => {
  if (isOwnerUser(req.user)) return res.status(403).json({ error: 'La cuenta del dueño no puede cambiar correo ni contraseña ni eliminarse.' });
  const { current, next } = req.body || {};
  const u = db.get('users').find({ id: req.user.id });
  if (!next || next.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  if (!(await bcrypt.compare(current || '', u.value().passwordHash))) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
  u.assign({ passwordHash: await bcrypt.hash(next, 10) }).write();
  addAudit(req.user.email, 'Contraseña cambiada', '-');
  res.json({ ok: true });
});
app.put('/api/account/avatar', requireAuth, (req, res) => {
  const { avatar } = req.body || {};
  if (avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) return res.status(400).json({ error: 'Imagen inválida (PNG, JPG o WEBP)' });
  if (avatar && avatar.length > 400000) return res.status(413).json({ error: 'La imagen es demasiado grande' });
  db.get('users').find({ id: req.user.id }).assign({ avatar: avatar || null }).write();
  addAudit(req.user.email, 'Foto de perfil actualizada', '-');
  res.json({ ok: true });
});
app.post('/api/account/delete/start', requireAuth, async (req, res) => {
  if (isOwnerUser(req.user)) return res.status(403).json({ error: 'La cuenta del dueño no puede cambiar correo ni contraseña ni eliminarse.' });
  const u = db.get('users').find({ id: req.user.id });
  if (!(await bcrypt.compare((req.body || {}).password || '', u.value().passwordHash))) return res.status(401).json({ error: 'Contraseña incorrecta' });
  const emailSent = await issueCode(u.value());
  res.json({ ok: true, emailSent });
});
app.delete('/api/account', requireAuth, async (req, res) => {
  if (isOwnerUser(req.user)) return res.status(403).json({ error: 'La cuenta del dueño no puede cambiar correo ni contraseña ni eliminarse.' });
  const u = db.get('users').find({ id: req.user.id });
  const user = u.value();
  if (!(await bcrypt.compare((req.body || {}).password || '', user.passwordHash))) return res.status(401).json({ error: 'Contraseña incorrecta' });
  const code = String((req.body || {}).code || '').trim();
  if (!user.verifyHash || user.verifyHash !== sha(code)) return res.status(401).json({ error: 'Código incorrecto' });
  if (user.verifyExp && Date.now() > user.verifyExp) return res.status(401).json({ error: 'Código expirado' });
  db.get('users').remove({ id: req.user.id }).write();
  ['contacts', 'feedback'].forEach(c => db.get(c).remove({ user: req.user.email }).write());
  res.json({ ok: true });
});

// ---------- Actividad (dashboard web: NO usa dispositivos, eso es del agente .exe) ----------
app.get('/api/dashboard/activity', requireAuth, (req, res) => {
  const audit = db.get('audit').filter({ user: req.user.email }).value();
  const day = Date.now() - 864e5, cnt = t => audit.filter(e => e.action.includes(t)).length;
  const rv = own('feedback', req).filter(r => r.rating);
  res.json({
    events24h: audit.filter(e => new Date(e.ts) > day).length, eventsTotal: audit.length,
    ipLookups: cnt('IP'), portScans: cnt('puertos') + cnt('Escaneo'), dnsQueries: cnt('DNS'), traces: cnt('Traceroute'),
    openTickets: own('contacts', req).filter(t => t.status === 'abierto').length,
    avgRating: rv.length ? +(rv.reduce((a, r) => a + r.rating, 0) / rv.length).toFixed(1) : null,
    memberSince: req.user.createdAt, recent: audit.slice(0, 5),
  });
});

// ======================================================================
// CIDR / Subredes — cálculo real (aritmética de bits, no requiere red)
// ======================================================================
app.post('/api/tools/subnet-calc', requireAuth, (req, res) => {
  const parsed = isValidCIDR(req.body && req.body.cidr);
  if (!parsed) return res.status(400).json({ error: 'CIDR inválido' });
  const { ip, prefix } = parsed;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const ipLong = ipToLong(ip);
  const network = (ipLong & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const firstHost = prefix >= 31 ? network : network + 1;
  const lastHost = prefix >= 31 ? broadcast : broadcast - 1;
  const hosts = prefix >= 31 ? (prefix === 32 ? 1 : 2) : Math.pow(2, 32 - prefix) - 2;

  addAudit(req.user.email, 'Calculadora de subredes', `CIDR: ${ip}/${prefix}`);
  res.json({
    network: longToIp(network), mask: longToIp(mask), broadcast: longToIp(broadcast),
    firstHost: longToIp(firstHost), lastHost: longToIp(lastHost), usableHosts: hosts,
    cidr: `${longToIp(network)}/${prefix}`, wildcard: longToIp(~mask >>> 0),
  });
});

// ---------- Cambio de correo con doble verificación (correo viejo y nuevo) ----------
const rc = () => String(crypto.randomInt(100000, 1000000));
const mailFast = async (...a) => { const r = await Promise.race([sendMail(...a), new Promise(ok => setTimeout(() => ok(null), 2500))]); return r === null ? true : r; };
app.post('/api/account/email/start', requireAuth, async (req, res) => {
  if (isOwnerUser(req.user)) return res.status(403).json({ error: 'La cuenta del dueño no puede cambiar correo ni contraseña ni eliminarse.' });
  const ne = String((req.body || {}).newEmail || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ne)) return res.status(400).json({ error: 'Correo nuevo inválido' });
  if (db.get('users').find({ email: ne }).value()) return res.status(409).json({ error: 'Ese correo ya está en uso' });
  if (ne === String(req.user.email).toLowerCase()) return res.status(400).json({ error: 'Ese ya es tu correo actual' });
  if (!req.user.passwordHash) return res.status(400).json({ error: 'Tu cuenta entra con un proveedor externo: el correo no se puede cambiar desde acá' });
  if (!(await bcrypt.compare(String((req.body || {}).password || ''), req.user.passwordHash))) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
  const prev = req.user.ec; if (prev && prev.at && Date.now() - prev.at < 30000) return res.status(429).json({ error: 'Esperá unos segundos antes de pedir otro código' });
  const c = rc();
  db.get('users').find({ id: req.user.id }).assign({ ec: { ne, oldHash: sha(c), stage: 'old', at: Date.now(), exp: Date.now() + 15 * 60 * 1000, tries: 0 } }).write();
  const sent = await mailFast(req.user.email, `${c} confirma el cambio de correo en IPHub`, `Código para autorizar el cambio de correo: ${c}\nVence en 15 minutos. Si no fuiste vos, cambiá tu contraseña.`);
  res.json({ ok: true, emailSent: sent });
});
app.post('/api/account/email/confirm', requireAuth, async (req, res) => {
  if (isOwnerUser(req.user)) return res.status(403).json({ error: 'La cuenta del dueño no puede cambiar correo ni contraseña ni eliminarse.' });
  const { code } = req.body || {}; const u = db.get('users').find({ id: req.user.id }); const ec = u.value().ec;
  if (!ec || Date.now() > ec.exp) return res.status(400).json({ error: 'No hay un cambio de correo pendiente o venció' });
  if (ec.tries >= 5) return res.status(429).json({ error: 'Demasiados intentos. Empezá de nuevo.' });
  const h = sha(String(code || '').trim());
  if (ec.stage === 'old') {
    if (h !== ec.oldHash) { u.assign({ ec: { ...ec, tries: ec.tries + 1 } }).write(); return res.status(400).json({ error: 'Código incorrecto' }); }
    const c = rc(); u.assign({ ec: { ...ec, stage: 'new', newHash: sha(c), tries: 0 } }).write();
    const sent = await mailFast(ec.ne, `${c} verifica tu nuevo correo en IPHub`, `Código para verificar este correo como tu nuevo correo de IPHub: ${c}`);
    return res.json({ next: 'new', emailSent: sent });
  }
  if (h !== ec.newHash) { u.assign({ ec: { ...ec, tries: ec.tries + 1 } }).write(); return res.status(400).json({ error: 'Código incorrecto' }); }
  if (db.get('users').find({ email: ec.ne }).value()) { u.assign({ ec: null }).write(); return res.status(409).json({ error: 'Ese correo ya está en uso' }); }
  try {
    const old = req.user.email;
    // Se actualiza la MISMA cuenta (mismo id): no se crea ningún usuario nuevo
    for (const col of ['audit', 'feedback', 'contacts']) { for (const x of (db.get(col).filter({ user: old }).value() || [])) x.user = ec.ne; }
    u.assign({ email: ec.ne, ec: null }).write();
    try { writeDbNow(); } catch (_) {}
    try { addAudit(ec.ne, 'Correo cambiado', `${old} → ${ec.ne}`); } catch (_) {}
    try { Promise.resolve(sendMail(old, 'Cambiaste el correo de tu cuenta de IPHub', `El correo de tu cuenta pasó de ${old} a ${ec.ne}. Si no fuiste vos, escribinos a ${SUPPORT_TO} de inmediato.`)).catch(() => {}); } catch (_) {}
    const fresh = u.value();
    const token = jwt.sign({ sub: fresh.id, email: fresh.email }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ done: true, token, oldEmail: old, user: publicUser(fresh) });
  } catch (e) {
    console.error('[EMAIL CHANGE]', e);
    return res.status(500).json({ error: 'No se pudo completar el cambio de correo: ' + e.message });
  }
});


// ---------- Niveles / XP / Quizzes ----------
function ensureProgress(user) {
  const u = db.get('users').find({ id: user.id });
  const v = u.value() || {};
  if (v.level == null) u.assign({ level: 1, xp: 0, quizAt: 0 }).write();
  return db.get('users').find({ id: user.id }).value();
}
function xpForLevel(lv) { return Math.min(5000, 50 + lv * 12); }
app.get('/api/progress', requireAuth, (req, res) => {
  const u = ensureProgress(req.user);
  const need = xpForLevel(u.level || 1);
  res.json({ level: u.level || 1, xp: u.xp || 0, need, maxLevel: 150, quizCooldown: Math.max(0, (u.quizAt || 0) + 600000 - Date.now()), toolXpWait: Math.max(0, (u.toolXpAt || 0) + TOOL_XP_COOLDOWN - Date.now()) });
});
app.post('/api/quiz/submit', requireAuth, (req, res) => {
  const u = ensureProgress(req.user);
  const now = Date.now();
  if ((u.quizAt || 0) + 600000 > now) {
    return res.status(429).json({ error: `Cooldown de quiz: esperá ${Math.ceil(((u.quizAt || 0) + 600000 - now) / 60000)} min` });
  }
  const { correct = 0, total = 1, difficulty = 'medium' } = req.body || {};
  const mult = difficulty === 'hard' ? 1.5 : difficulty === 'easy' ? 0.7 : 1;
  let gain = Math.round(Math.max(5, Math.min(80, (Number(correct) / Math.max(1, Number(total))) * 40 * mult)));
  let level = u.level || 1, xp = (u.xp || 0) + gain;
  while (level < 150 && xp >= xpForLevel(level)) { xp -= xpForLevel(level); level++; }
  if (level >= 150) { level = 150; xp = Math.min(xp, xpForLevel(150) - 1); }
  db.get('users').find({ id: req.user.id }).assign({ level, xp, quizAt: now }).write();
  addAudit(req.user.email, 'Quiz completado', `+${gain} XP · nivel ${level}`);
  res.json({ level, xp, need: xpForLevel(level), gain, maxLevel: 150 });
});

// ---------- IA: varios proveedores con respaldo automático (si uno falla, pasa al siguiente) ----------
// Orden: Groq (modelo detectado solo) → Gemini → OpenRouter → OpenAI → Pollinations (gratis)
function aiKey() { return (process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '').trim(); }
const GROQ_PREF = ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'moonshotai/kimi-k2-instruct', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant', 'qwen/qwen3-32b'];
const DEAD = new Map(); // proveedor -> hasta cuándo no se intenta (clave inválida / sin créditos / sin pago)
const WAIT = new Map(); // "Proveedor/modelo" -> hasta cuándo no se intenta (límite de velocidad, modelo caído)
const waitLeft = k => Math.max(0, (WAIT.get(k) || 0) - Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let LAST_CHAT = 0; // las tareas de fondo (traducción) no compiten con el chat por los tokens por minuto
let groqModelsCache = { at: 0, list: null };
async function groqModels(key) {
  if (groqModelsCache.list && Date.now() - groqModelsCache.at < 3600e3) return groqModelsCache.list;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ids = (await r.json()).data.map(m => m.id).filter(id => !/whisper|guard|tts|orpheus|playai|embed|safeguard/i.test(id));
    const list = [...GROQ_PREF.filter(m => ids.includes(m)), ...ids.filter(m => !GROQ_PREF.includes(m))];
    groqModelsCache = { at: Date.now(), list }; return list;
  } catch (e) { console.warn('[AI] No pude listar modelos de Groq:', e.message); return GROQ_PREF; }
}
async function aiProviders() {
  const env = k => (process.env[k] || '').trim(); const L = [];
  const g = env('GROQ_API_KEY') || (env('AI_API_KEY').startsWith('gsk_') ? env('AI_API_KEY') : '');
  if (g) { let m = await groqModels(g); if (env('AI_MODEL') && m.includes(env('AI_MODEL'))) m = [env('AI_MODEL'), ...m.filter(x => x !== env('AI_MODEL'))]; L.push({ name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', key: g, models: m.slice(0, 6) }); }
  if (env('GEMINI_API_KEY')) L.push({ name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: env('GEMINI_API_KEY'), models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'] });
  if (env('OPENROUTER_API_KEY')) L.push({ name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', key: env('OPENROUTER_API_KEY'), models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free', 'deepseek/deepseek-chat-v3-0324:free'] });
  const o = env('OPENAI_API_KEY') || (env('AI_API_KEY') && !env('AI_API_KEY').startsWith('gsk_') ? env('AI_API_KEY') : '');
  if (o) L.push({ name: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', key: o, models: [env('OPENAI_MODEL') || 'gpt-4o-mini'] });
  // Pollinations: la API vieja (text.pollinations.ai) está deprecada y falla (402/500/404). La nueva es gen.pollinations.ai (clave gratis opcional en enter.pollinations.ai)
  if (env('AI_NO_FREE_FALLBACK') !== '1') L.push({ name: 'Pollinations', url: 'https://gen.pollinations.ai/v1/chat/completions', key: env('POLLINATIONS_API_KEY'), models: ['openai', 'mistral'], slow: true });
  return L.filter(p => (DEAD.get(p.name) || 0) < Date.now());
}
let aiLastError = '';
const cleanAi = t => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
// "Please try again in 1.5s" / "in 2m3.4s" / "in 850ms" -> milisegundos
function retryAfterMs(r, text) {
  const h = parseFloat(r.headers.get('retry-after')); if (h > 0) return Math.ceil(h * 1000);
  const m = /try again in\s+([0-9hms.]+)/i.exec(text || ''); if (!m) return 0;
  let ms = 0; for (const [, n, u] of m[1].matchAll(/([0-9.]+)(ms|h|m|s)/g)) ms += parseFloat(n) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[u]);
  return Math.ceil(ms);
}
// messages: [{role,content}] -> texto o null (el motivo queda en aiLastError). background:true = tarea de fondo (no espera ni compite con el chat)
async function aiChat(messages, { temperature = 0.6, max_tokens = 700, background = false, provider = 'auto' } = {}) {
  const errs = []; let rateLimited = false;
  if (!background) LAST_CHAT = Date.now();
  else if (Date.now() - LAST_CHAT < 20000) { aiLastError = 'IA ocupada con el chat'; return null; }
  for (let round = 0; round < 2; round++) {
    let provs = await aiProviders();
    if (provider && provider !== 'auto') provs = provs.filter(p => p.name.toLowerCase() === provider);
    let minWait = Infinity;
    for (const p of provs) {
      for (const model of p.models) {
        const key = p.name + '/' + model, w = waitLeft(key);
        if (w > 0) { minWait = Math.min(minWait, w); if (/rate|429/.test(String(WAIT.get(key + ':why')))) rateLimited = true; continue; }
        try {
          const headers = { 'Content-Type': 'application/json' }; if (p.key) headers.Authorization = 'Bearer ' + p.key;
          const body = { model, temperature, max_tokens, messages };
          if (p.name === 'Groq' && /gpt-oss/.test(model)) body.reasoning_effort = 'low'; // menos tokens de razonamiento = menos consumo del límite por minuto
          const r = await fetch(p.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(p.slow ? 40000 : 30000) });
          const text = await r.text();
          if (!r.ok) {
            errs.push(`${p.name}/${model} ${r.status}`); console.error('[AI]', p.name, model, r.status, text.replace(/\s+/g, ' ').slice(0, 160));
            const hold = (ms, why) => { WAIT.set(key, Date.now() + ms); WAIT.set(key + ':why', why); };
            if (r.status === 429) { // límite de velocidad: NO es clave inválida. Se espera lo que pide el proveedor y se prueba otro modelo
              const ms = Math.min(retryAfterMs(r, text) || 20000, 10 * 60000); hold(ms, 'rate'); rateLimited = true; minWait = Math.min(minWait, ms);
              if (/per day|TPD|RPD/i.test(text) && ms > 60000) console.warn(`[AI] ${p.name}/${model}: límite diario, se reintenta en ${Math.round(ms / 60000)} min`);
              continue;
            }
            if (r.status === 401 || r.status === 403 || /insufficient_quota|no credits|exceeded your current quota|invalid_api_key/i.test(text)) { DEAD.set(p.name, Date.now() + (/quota|credit/i.test(text) ? 6 : 1) * 3600e3); console.warn(`[AI] ${p.name} desactivado un rato (clave inválida o sin créditos). Se usan los demás proveedores.`); break; }
            if (r.status === 402) { DEAD.set(p.name, Date.now() + 30 * 60e3); console.warn(`[AI] ${p.name} pide pago/clave (402). Se desactiva 30 min.`); break; }
            if (r.status === 404 || r.status === 400) { hold(r.status === 404 ? 3600e3 : 10 * 60e3, 'bad'); continue; }
            hold(2 * 60e3, '5xx'); if (p.slow) { DEAD.set(p.name, Date.now() + 5 * 60e3); break; } // caído del lado del proveedor
            continue;
          }
          const out = cleanAi(JSON.parse(text).choices?.[0]?.message?.content);
          if (out) { aiLastError = ''; return out; }
        } catch (e) { errs.push(`${p.name}: ${e.message}`); console.error('[AI]', p.name, e.message); if (p.slow) { DEAD.set(p.name, Date.now() + 2 * 60e3); break; } }
      }
    }
    // todo estaba limitado por velocidad pero la espera es corta: esperar y reintentar una vez (solo en el chat)
    if (round === 0 && !background && minWait <= 8000 && minWait > 0) { await sleep(minWait + 250); continue; }
    break;
  }
  aiLastError = rateLimited ? 'límite de uso de la IA alcanzado, reintentá en unos segundos' : (errs.slice(-3).join(' · ') || 'sin proveedores de IA activos'); return null;
}
const parseJsonLoose = raw => { const t = String(raw || ''); const i = t.search(/[\[{]/), j = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']')); if (i < 0 || j < i) return null; try { return JSON.parse(t.slice(i, j + 1)); } catch (_) { return null; } };
function langName(code) { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(String(code || 'es')) || 'Spanish'; } catch (_) { return 'Spanish'; } }

// Reinicio único del ranking (v1)
(function resetRankingOnce() {
  try {
    const st = db.get('users').value() || [];
    const flag = st.find(u => u.__rankReset);
    if (flag) return;
    st.forEach(u => { u.level = 1; u.xp = 0; u.quizAt = 0; u.toolXpAt = 0; });
    if (st[0]) st[0].__rankReset = true;
    db.write();
    console.log('[ranking] reiniciado para la v1');
  } catch (e) { console.error('[ranking] reset', e.message); }
})();
// ---------- Puntaje / ranking ----------
function totalXp(u) { let t = u.xp || 0; for (let l = 1; l < (u.level || 1); l++) t += xpForLevel(l); return t; }
function rankedUsers() {
  return db.get('users').value().filter(u => u.verified !== false && !isOwnerUser(u))
    .map(u => ({ id: u.id, name: u.name || 'Usuario', avatar: u.avatar || null, level: u.level || 1, xp: u.xp || 0, country: u.country || '', score: totalXp(u) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((u, i) => ({ ...u, rank: i + 1, need: xpForLevel(u.level) }));
}
app.get('/api/leaderboard', requireAuth, (req, res) => {
  const all = rankedUsers();
  const strip = u => ({ rank: u.rank, name: u.name, avatar: u.avatar, level: u.level, xp: u.xp, need: u.need, score: u.score, country: u.country, me: u.id === req.user.id });
  const i = all.findIndex(u => u.id === req.user.id);
  const me = i >= 0 ? strip(all[i]) : null;
  if (me && i > 0) { me.above = all[i - 1].name; me.gap = all[i - 1].score - all[i].score + 1; }
  res.json({ top: all.slice(0, 20).map(strip), me, total: all.length });
});

// ---------- Chatbot asistente (IA + datos reales de la página) ----------
// Base de conocimiento: cada entrada tiene palabras clave (para responder aunque la IA externa no esté disponible) y el texto que se le da a la IA.
const KB = [
  { k: /que es|iphub|plataforma|para que sirve|sobre la pagina|de que trata/, t: 'IPHub es una plataforma web de diagnóstico y monitoreo de red (backend Node/Express; los resultados son reales, no simulados). Tiene: Dashboard, Topología, Herramientas de red, Auditoría, Aprender (quizzes), Ranking, Soporte y Mi Cuenta. Se traduce a más de 60 idiomas.' },
  { k: /dashboard|inicio|home|bienvenid|estadistic|actividad/, t: 'DASHBOARD (/home): bienvenida con tu nombre, tarjeta de nivel/XP, "IP de red" (IP local del equipo donde corre IPHub), estadísticas (eventos 24h, consultas IP, escaneos, DNS, tickets) y actividad reciente.' },
  { k: /topolog|descubr|red local|dispositivo|inventario|cidr|arp sweep|ping sweep|mapa|confiar|desconocid/, t: 'TOPOLOGÍA (/topologia): "Descubrir red" hace un ping sweep + lectura de la tabla ARP sobre un CIDR (ej. 192.168.1.0/24; mínimo /24 por rendimiento, hasta 254 hosts). Muestra un mapa de nodos arrastrables y un inventario de dispositivos (IP, MAC, estado). Los dispositivos desconocidos/sospechosos llevan un botón "Confiar" para marcarlos como confiables. Al pasar el cursor por un nodo se ve el detalle y se puede arrastrar.' },
  { k: /herramienta|toolbox|caja/, t: 'HERRAMIENTAS (/herramientas, una URL por herramienta): IP/Geolocalización (/herramientas/ip), Puertos (/herramientas/puertos), Traceroute (/herramientas/traceroute), DNS (/herramientas/dns), Subredes (/herramientas/subredes), ARP/MAC (/herramientas/arp), Velocidad (/herramientas/velocidad).' },
  { k: /\bip\b|geolocaliz|isp|asn|vpn|proxy|hosting|ubicacion de una ip|consulta ip/, t: 'IP / Geolocalización: ingresás una IP o dominio y devuelve país, ciudad, ISP, ASN y si parece VPN/proxy/hosting (datacenter).' },
  { k: /puerto|port|escane|nmap|abierto|servicio/, t: 'PUERTOS: escaneo TCP real (hasta 200 puertos por consulta, 25 en paralelo). Indica si cada puerto está abierto, qué servicio suele usarlo y marca como críticos 21, 23, 445, 3389 y 5900. Usalo solo en equipos propios o con permiso: escanear redes ajenas puede ser ilegal.' },
  { k: /traceroute|tracepacket|tracert|salto|hop|rtt|ruta/, t: 'TRACEROUTE: muestra la ruta (hops) y el RTT de cada salto hasta un destino. TRACEPACKET es la variante con paquetes.' },
  { k: /dns|registro|\bmx\b|\bns\b|txt|cname|nslookup|dominio/, t: 'DNS: consulta registros A, AAAA, MX, NS, TXT, CNAME y ALIAS de un dominio.' },
  { k: /subred|calculadora|mascara|prefijo|broadcast|hosts utiles/, t: 'SUBREDES: calculadora CIDR (red, máscara, broadcast, rango de hosts y cantidad de hosts útiles).' },
  { k: /\barp\b|\bmac\b|tabla arp/, t: 'ARP/MAC: muestra la tabla ARP del equipo (IP ↔ dirección MAC de los vecinos de la red local).' },
  { k: /velocidad|speed|mbps|descarga|subida|latencia|ping|test de velocidad/, t: 'VELOCIDAD: mide descarga, subida y latencia reales; se puede elegir la unidad (Mbps, MB/s, etc.). El historial queda en Auditoría.' },
  { k: /auditoria|historial|csv|pdf|exportar|registro de acciones/, t: 'AUDITORÍA (/auditoria): historial de todas tus acciones con filtros por tipo y fecha. Se puede exportar a CSV y PDF.' },
  { k: /aprender|quiz|pregunta|examen|dificultad|cooldown/, t: 'APRENDER (/aprender): quizzes de redes generados por IA con 3 dificultades (fácil, medio, difícil). Son 3 preguntas, 25 segundos por pregunta (si se acaba el tiempo cuenta como incorrecta) y hay un cooldown de 10 minutos entre quizzes. Dan hasta 80 XP según aciertos y dificultad (difícil ×1.5, fácil ×0.7). Si la IA no está disponible se usa un banco local de preguntas.' },
  { k: /nivel|xp|experiencia|rango|subir|puntos|farmeo/, t: 'NIVELES Y XP: 150 niveles. Cada uso exitoso de una herramienta (IP, puertos, traceroute, tracepacket, DNS, subredes, ARP, velocidad, descubrir red) da +1 XP, como máximo una vez cada 2 minutos (anti-farmeo). Los quizzes dan hasta 80 XP. XP para subir desde el nivel N = min(5000, 50 + 12×N).' },
  { k: /ranking|leaderboard|top|posicion|puesto|superar|podio/, t: 'RANKING (/ranking): top de usuarios por nivel y XP total, tu posición y cuánto XP te falta para superar al de arriba.' },
  { k: /soporte|ticket|resena|review|estrella|adjunt|contacto|ayuda|problema|reportar|feedback|prioridad|urgente/, t: 'SOPORTE (/soporte). Crear ticket (tarjeta izquierda, "Crear Ticket de Soporte"): SOLO tiene estos campos: Asunto (obligatorio), Mensaje (obligatorio) y Adjuntos (opcional: hasta 5 archivos, 10 MB en total), más el botón "Enviar". NO existe un selector de prioridad ni niveles baja/media/alta. Límite: 1 ticket cada 30 minutos. Debajo del formulario aparece la lista de tus tickets; cada ticket tiene el botón "Editar" (modificar el ticket enviado, con Guardar/Cancelar) y el botón "Prioridad": con un clic pedís prioridad para ese ticket, queda marcado con la etiqueta PRIORIDAD y se avisa al equipo por correo (solo se puede pedir una vez por ticket; desaparece el botón después). Tarjeta derecha "Feedback": calificación de 1 a 5 estrellas, Comentario y botón "Enviar reseña"; tus reseñas se pueden Editar y Eliminar. Los tickets llegan por correo a iphuboficial@gmail.com.' },
  { k: /cuenta|perfil|foto|avatar|nombre|empresa|contrasena|password|clave|api|eliminar|borrar|idioma|pais|correo|email/, t: 'MI CUENTA (/cuenta): datos personales (nombre, empresa, foto — hay que apretar "Guardar cambios" para aplicar la foto; PNG/JPG/WEBP), cambiar contraseña (mínimo 8 caracteres, pide la actual), clave de API personal (regenerable), idioma y país, y eliminar cuenta (pide contraseña + código enviado por correo; borra tickets y reseñas).' },
  { k: /login|iniciar|sesion|registr|crear cuenta|codigo|verific|captcha|google|discord|recuperar|olvid|restablecer/, t: 'ACCESO: registro con nombre, correo, contraseña (mín. 8) y país; se verifica con un código enviado por correo (vence en 15 min). Login con correo + contraseña + captcha y código por correo; también con Google o Discord (el correo ya queda verificado). "Olvidé mi contraseña" envía un código para restablecerla. Si un correo se creó con Google/Discord hay que entrar con ese mismo método.' },
  { k: /varias cuentas|cambiar de cuenta|agregar cuenta|otra cuenta|\+|multiple/, t: 'VARIAS CUENTAS: abajo a la izquierda, junto al recuadro de usuario, el botón (+) permite cambiar entre cuentas guardadas en este navegador o "Agregar otra cuenta" (la actual queda guardada). Tocar el recuadro de usuario abre Mi Cuenta.' },
  { k: /traduc|idioma|language|bandera|ingles|frances|portugues/, t: 'IDIOMA: toda la página se traduce a más de 60 idiomas con un selector con banderas (arriba junto al buscador, en el login y en Mi Cuenta) y se adapta al país. Si la traducción tarda, aparece una barra de progreso.' },
  { k: /escritorio|windows|exe|app|descargar|agente|monitor/, t: 'APP DE ESCRITORIO: botón "App para Windows" en la barra lateral (descarga IPHub.exe, que corre el monitor en tu PC).' },
  { k: /buscador|buscar|atajo|search/, t: 'BUSCADOR: arriba hay un buscador global para saltar rápido a secciones y herramientas.' },
  { k: /legal|privacidad|terminos|cookies|condiciones|datos personales/, t: 'LEGAL: /privacidad (Política de Privacidad), /terminos (Términos y Condiciones) y /cookies (Cookies y almacenamiento).' },
  { k: /asistente|chat|bot|ia\b|inteligencia/, t: 'ASISTENTE IA: el botón flotante abajo a la derecha abre este chat. "–" lo minimiza (se conserva la conversación) y "×" lo cierra (pide confirmación y borra la conversación).' },
  { k: /tracking|logistica|envio|telemetria|trazabilidad|studio|proyecto|worker/, t: 'TRACKING STUDIO (/tracking): IDE de logística, trazabilidad y telemetría: proyectos, envíos, eventos, mapa, alertas, KPIs, Smart, Predictivo y Ops; el exe puede correr workers de telemetría. NO es un analizador de paquetes: para ver peticiones/paquetes existe la sección INTERCEPTAR (solo dueño). Los permisos del rol "Tracking Studio" controlan el acceso.' },
  { k: /interceptar|intercept|paquete|peticion|peticiones|http|sniff|wireshark|analizador de protocolo|capturar|proxy|tshark|tcpdump|pcap/, t: 'INTERCEPTAR (SOLO DUEÑO). Hay 3 herramientas: (1) Sección /interceptar y también el modo Interceptar dentro de Topología (barra de modos de cada red): lista en vivo TODAS las peticiones HTTP que llegan a la plataforma, con método, URL, IP, estado, tiempos, cabeceras de petición y respuesta, cuerpo y el paquete HTTP crudo; filtros por URL/IP/método/estado, pausar y limpiar. Contraseñas y tokens se muestran como ***; Authorization y Cookie van recortadas. (2) Proxy HTTP del exe (puerto 8899, cuenta dueño): configurando otro equipo de la MISMA red para usarlo se ven sus peticiones HTTP; en HTTPS solo host y puerto porque va cifrado. (3) ANALIZADOR DE PROTOCOLOS del exe (estilo Wireshark, cuenta dueño): captura paquetes reales de la placa de red de esa PC. Elegís la interfaz, filtro de captura BPF (ej. tcp port 80, host 192.168.1.5) y filtro de visualización (tcp && ip.addr==192.168.1.5, dns, http). Tiene lista de paquetes con colores por protocolo, árbol de capas (Ethernet, IP, TCP/UDP, DNS, HTTP, TLS) y volcado hexadecimal. Requiere Wireshark (con Npcap) o tcpdump instalado y permisos de administrador. El contenido HTTPS no se puede leer porque va cifrado. La web no puede capturar paquetes crudos del equipo del usuario; eso lo hace el exe. Usalo solo en redes y equipos propios o con permiso.' },
  { k: /modo|modos|globo|carrier|ipv6|radial|sunburst|concentric|anillos|topologia|topología/, t: 'MODOS DE TOPOLOGÍA (/topologia, barra superior): Mapa de red (la subred), Global Carrier Explorer (globo 3D interactivo: traza Host local > POP > IXP > Carrier > dispositivo destino; lejos se ven backbones y nodos agrupados, al acercar aparecen nodos pequeños; colores y partículas distinguen tipos de red), IPv6 Radial Hierarchy (anillos concéntricos tipo sunburst: núcleo RIR, ISPs, sitios con prefijo de enrutamiento, subredes y hosts; clic en un gajo lo expande, clic en el centro vuelve) e Interceptar (solo dueño). Los datos del globo y del radial salen de una traza real (traceroute) convertida automáticamente al formato de cada vista.' },
  { k: /celular|movil|móvil|telefono|teléfono|mobile|android|iphone|pantalla chica/, t: 'VERSIÓN MÓVIL: en pantallas chicas la página cambia a un diseño propio: barra inferior con Inicio, Topología, Herramientas, Interceptar (solo dueño) y Más; el botón Más abre una hoja con todas las secciones; botones grandes, tablas en tarjetas y formularios cómodos para el pulgar.' },
  { k: /globo|global carrier|carrier|pop\b|ixp|3d|ipv6|radial|sunburst|concentric/, t: 'MODOS DE TOPOLOGÍA (en Topología, además del mapa de siempre): (1) GLOBAL CARRIER EXPLORER: globo 3D arrastrable con zoom; traza real hasta un destino y la dibuja Host local → POP → IXP → Carrier → Dispositivo, con partículas de paquetes, colores por tipo y clustering por nivel de zoom (lejos: backbones y grupos; cerca: nodos individuales). (2) IPv6 RADIAL HIERARCHY: anillos concéntricos Internet → ISPs → Sitios → Subredes → Hosts; clic en un gajo para expandirlo, clic en el centro para volver; se puede cargar desde tu traza o con datos de ejemplo.' },
  { k: /workspace|tablero|widget|embed|notas/, t: 'WORKSPACE (/workspace): tablero personal con widgets reales: resumen de red, últimas acciones, analizador de IP, traceroute rápido, DNS rápido, ping de latencia, reloj, notas y embeds externos (https). Se pueden subir, cambiar de tamaño y quitar; se guarda solo en tu cuenta.' },
  { k: /manual|guia|como se usa|documentacion/, t: 'MANUAL (/manual): guía de uso por función de la plataforma, con detalles de cada herramienta.' },
  { k: /codigo|code query|repositor|commit|foro|grafo|funciones/, t: 'CÓDIGO (/codigo): módulo SOLO para el dueño (iphuboficial@gmail.com). Pestañas: Repositorios, Commits, Funciones, Code Query, Grafo, Foro y Compartir (enlaces de solo lectura con vencimiento). Otros usuarios no lo ven.' },
  { k: /empresa|rol|roles|permiso|miembro|equipo/, t: 'EMPRESA (solo dueño): crear roles y asignarlos a miembros. Cada rol elige secciones (Dashboard, Topología, Workspace, Tracking Studio, Herramientas, Auditoría, Aprender, Ranking, Soporte, Manual) y permisos finos dentro de ellas (por herramienta, exportar auditoría, descubrir red, tickets, reseñas, embeds). El servidor aplica esos permisos.' },
  { k: /innovador|multiping|jitter|perdida de paquetes|http check|cabeceras|vlsm|comparar rutas|analizador de ruta/, t: 'HERRAMIENTAS INNOVADORAS (/herramientas/innovadoras): Analizador de ruta (traceroute con gráfico de RTT por salto y diagnóstico), Comparador de rutas (dónde divergen dos destinos), Multiping TCP (latencia, jitter y pérdida a varios destinos), HTTP Check (DNS/TTFB/total, TLS y cabeceras de seguridad con puntaje), Planificador VLSM y Conversor de IP (binario, hex, clase, PTR).' },
  { k: /exe|traceroute en el exe|restaurar|eliminados/, t: 'EXE: además de dispositivos de la red, incluye Traceroute y Tracepacket reales (tracert), filtro "Eliminados" con Restaurar y Restaurar todos, e inicio de sesión con la cuenta de la página.' },
  { k: /globo de hosts|radial de hosts|todos los hosts|vista radial|vista globo/, t: "VISTAS DE HOSTS (Topología): 'Globo de hosts' ubica tu red en un globo 3D y reparte cada dispositivo en espiral; al acercar con la rueda se separan y aparecen los nombres. 'Radial de hosts' pone el gateway al centro y todos los dispositivos en anillos ordenados por tipo, con zoom, arrastre y panel de detalle. En la app de escritorio están completas; en la web son una vista resumida de lo que publica la app." },
  { k: /analizador de paquetes|todos los protocolos|protocolo|wireshark|npcap|captura de paquetes|capturar paquetes/, t: "ANALIZADOR DE PAQUETES (app de escritorio, solo dueño): captura la placa de red y decodifica Ethernet, VLAN, ARP, IPv4/IPv6, TCP, UDP, ICMP/ICMPv6, IGMP, GRE, ESP/AH, SCTP, OSPF, EIGRP, VRRP, STP, LLDP, EAPOL, MPLS, DNS/mDNS/LLMNR, DHCP, HTTP, TLS con SNI, QUIC, SSH, FTP, SMTP, IMAP, SMB, RDP, SNMP, NTP, SIP, MQTT y muchos más; con Wireshark/tshark instalado disecciona todo lo que Wireshark conoce. Requiere Wireshark (Npcap) y ejecutar como administrador en Windows." },
  { k: /entorno virtual|sandbox|mapa ip editable|estres controlado|traza simulada/, t: "ENTORNO VIRTUAL DE RED (Plan y Estudio, cuenta oficial): mapa IP editable donde agregás nodos, IP, latencia y enlaces; incluye traza simulada salto a salto y prueba de estrés controlada (simulada, hasta 100000 paquetes/s, sin tráfico real)." },
  { k: /seguimiento de claves|claves api|api key de empleados|que servicios usa|uso de api/, t: "SEGUIMIENTO DE CLAVES API (cuenta oficial): muestra por persona cuántas llamadas hizo con su clave API, a qué servicios del sistema, desde qué IPs y cuándo fue la última; lista las claves emitidas mostrando solo los últimos 4 caracteres." },
  { k: /phishing|simulacro|concientizacion|campana interna/, t: "SIMULACRO DE PHISHING (cuenta oficial): campañas internas con consentimiento. Cargás participantes, el asunto y el mensaje; cada uno recibe un enlace único que lleva a una página educativa (nunca pide ni guarda contraseñas). Medís enviados, aperturas y clics." },
  { k: /commit|github|repositorio privado|foro empresarial|vista compartible|enlace compartible/, t: "COMMITS Y FORO EMPRESARIAL (cuenta oficial): hacés commit de una vista a GitHub (repos propios o privados) con un token de un solo uso que no se guarda, o generás un enlace de solo lectura /vista/código. El foro permite hilos y respuestas del equipo." },
  { k: /plan y estudio|estudio modular|suscripcion|plan/, t: "PLAN Y ESTUDIO (/plan): catálogo de funciones. Para todos: Modo embebido (?embed=1) y Accesibilidad. Para la cuenta oficial: Estudio modular con IA (3 espacios de diseño), Entorno virtual de red, Seguimiento de claves API, Simulacro de phishing y Commits/foro empresarial." },
  { k: /cambiar correo|cambio de correo|nuevo correo|cambiar email|cambiar mi mail/, t: "CAMBIAR CORREO (Mi cuenta): 1) ponés el correo nuevo y tu contraseña, 2) código al correo ACTUAL, 3) código al correo NUEVO, 4) listo. Cada código dura 15 minutos y tiene 5 intentos. La cuenta del dueño y las cuentas de Google/Discord sin contraseña no pueden cambiarlo desde ahí." },
  { k: /login en el exe|iniciar sesion en la app|entrar en el exe|conectar el exe|exe no inicia|sesion del exe/, t: "LOGIN EN LA APP: tocá Entrar, Google o Discord en la tarjeta 'Cuenta de la página'. Se abre una ventana con la página real de IPHub; iniciás sesión como siempre y se cierra sola. Con eso la app publica tu red para Topología." },
  { k: /ranking reiniciado|reinicio del ranking|dueno en el ranking|por que no aparece el dueno/, t: "RANKING v1: se reinició para la versión 1. La cuenta del dueño no participa porque solo administra la plataforma." },
  { k: /v1|version 1|novedades|que hay de nuevo|que cambio/, t: "NOVEDADES v1: globo y radial con todos los hosts, analizador de paquetes con todos los protocolos, login del exe con la página real, nuevos módulos (Entorno virtual, Claves API, Phishing, Commits y foro), cambio de correo corregido, manual ampliado, nueva estética con animaciones y traducción completa, ranking reiniciado." },
  { k: /estetica|animacion|tema|diseno|colores/, t: "DISEÑO v1: mismos colores (celeste y violeta sobre azul noche) con degradados, tarjetas de vidrio, animaciones de entrada y brillos suaves; respeta 'reducir movimiento' del sistema. Con Estudio modular (cuenta oficial) se puede personalizar." },
];
const IPHUB_KB = KB.map(e => '- ' + e.t).join('\n') + '\n- Aviso: escanear redes ajenas sin permiso puede ser ilegal.';
const deacc = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Respuesta local (sin IA externa): las entradas de la base que mejor coinciden con la pregunta
function kbAnswer(q) {
  const t = deacc(q);
  const hits = KB.map(e => ({ e, n: (t.match(new RegExp(e.k.source, 'g')) || []).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 2);
  return hits.length ? hits.map(h => h.e.t).join('\n\n') : null;
}

function userContext(user, section) {
  const all = rankedUsers(); const me = all.find(u => u.id === user.id);
  const devs = db.get('devices').value().length;
  const recent = db.get('audit').filter(e => e.user === user.email).take(5).value().map(e => e.action).join(', ') || 'nada todavía';
  return `DATOS DEL USUARIO ACTUAL: nombre ${user.name}; nivel ${me ? me.level : 1}/150; ${me ? me.xp : 0}/${me ? me.need : 62} XP; puesto ${me ? me.rank : '-'} de ${all.length} en el ranking; dispositivos descubiertos: ${devs}; últimas acciones: ${recent}; sección que está viendo ahora: ${section || 'desconocida'}.`;
}
function chatSystem(user, lang, section) {
  return `Sos el asistente oficial de IPHub, integrado dentro de la página. Sos una IA completa y útil: respondés cualquier pregunta (redes, programación, matemática, cultura general, etc.) con precisión, y cuando tenga relación con IPHub usás la información real de la plataforma y los datos del usuario que figuran abajo. Conocés TODA la página solo a través de la BASE DE CONOCIMIENTO de abajo. REGLAS ESTRICTAS cuando la pregunta es sobre cómo usar IPHub (pasos, botones, campos, opciones, límites): 1) describí ÚNICAMENTE botones, campos, menús y opciones que figuren en la base, con sus nombres exactos; 2) NUNCA inventes selectores, opciones, pestañas, menús, pasos ni botones; 3) si lo que preguntan no existe o no figura en la base, decilo claramente (por ejemplo "eso no existe en IPHub") y explicá lo más parecido que sí existe; 4) si falta información, decí que no lo sabés en vez de suponer. Si te piden ir a algún lugar, indicá la sección y su URL. Para preguntas generales (redes, programación, etc.) respondé con tu conocimiento normal. Respondé SIEMPRE en el idioma ${langName(lang)} (código ${lang}), de forma clara y directa; usá listas o **negritas** solo si ayudan; sé breve salvo que pidan detalle.\n\nBASE DE CONOCIMIENTO DE IPHUB:\n${IPHUB_KB}\n\n${userContext(user, section)}`;
}
app.post('/api/chat', requireAuth, async (req, res) => {
  const q = String((req.body || {}).message || '').trim().slice(0, 1500);
  if (!q) return res.status(400).json({ error: 'Mensaje vacío' });
  const lang = String(req.body.lang || req.user.lang || 'es').slice(0, 12);
  const hist = (Array.isArray(req.body.history) ? req.body.history : []).slice(-6)
    .filter(m => m && ['user', 'assistant'].includes(m.role) && m.content).map(m => ({ role: m.role, content: String(m.content).slice(0, 900) }));
  const pref = (typeof global.iphubLearnExtra === 'function' ? global.iphubLearnExtra(req.user) : {});
  const answer = await aiChat([{ role: 'system', content: chatSystem(req.user, lang, String(req.body.section || '').slice(0, 30)) }, ...hist, { role: 'user', content: q }], { temperature: 0.25, max_tokens: 700, provider: pref.provider || 'auto' });
  addAudit(req.user.email, 'Chatbot', q.slice(0, 80));
  if (answer) return res.json({ reply: answer, ai: true });
  const fb = kbAnswer(q);
  res.json({ reply: fb ? fb + `\n\n(La IA externa no respondió ahora: ${aiLastError || 'error'}. Te respondo con la información de IPHub; volvé a preguntar en unos segundos para una respuesta completa.)` : `⚠ La IA no pudo responder ahora (${aiLastError || 'error'}). Probá de nuevo en unos segundos.`, ai: false });
});

// ---------- Quiz generado por IA ----------
const QUIZ_TOPICS = ['direccionamiento IPv4 y clases/privadas', 'subredes, CIDR y máscaras', 'puertos y servicios comunes', 'DNS y tipos de registros', 'TCP vs UDP y three-way handshake', 'ICMP, ping y traceroute', 'ARP y direcciones MAC', 'NAT y PAT', 'modelo OSI y TCP/IP', 'DHCP', 'firewalls y ACL', 'VPN, proxy y Tor', 'HTTP, HTTPS y TLS', 'IPv6', 'routing, BGP y sistemas autónomos', 'seguridad Wi-Fi (WPA2/WPA3)', 'seguridad de redes: escaneo, hardening, ataques comunes', 'VLAN y switching', 'latencia, jitter y ancho de banda', 'comandos de red (nslookup, netstat, ipconfig, ss, dig)'];
const QUIZ_BANK = {
  easy: [['¿Qué significa IP en redes?', ['Internet Protocol', 'Internal Port', 'Input Process', 'Instant Packet']], ['¿Cuál es el puerto por defecto de HTTPS?', ['443', '80', '22', '25']], ['¿Para qué sirve el DNS?', ['Traducir nombres de dominio a direcciones IP', 'Cifrar el disco', 'Medir la temperatura del router', 'Abrir puertos al azar']], ['¿Qué es una dirección MAC?', ['Un identificador de hardware de la tarjeta de red', 'Una contraseña de Wi‑Fi', 'Un tipo de virus', 'Un protocolo de correo']], ['IPv4 usa direcciones de…', ['32 bits', '64 bits', '128 bits', '8 bits']], ['¿Qué comando muestra la ruta que siguen los paquetes en Windows?', ['tracert', 'ipconfig', 'format', 'chkdsk']]],
  medium: [['¿Qué máscara corresponde a un /24?', ['255.255.255.0', '255.255.0.0', '255.0.0.0', '255.255.255.255']], ['¿Qué puerto usa SSH por defecto?', ['22', '21', '23', '3389']], ['¿Cuántos hosts útiles tiene una red /30?', ['2', '14', '30', '254']], ['¿Qué protocolo resuelve una IP a su dirección MAC en una LAN?', ['ARP', 'DNS', 'DHCP', 'ICMP']], ['Una IP que pertenece a un datacenter suele indicar…', ['Un servidor en la nube, VPN o proxy', 'Una impresora casera', 'Una red 4G', 'Un cable HDMI']], ['¿Qué hace DHCP?', ['Asigna direcciones IP automáticamente', 'Cifra el tráfico', 'Bloquea puertos', 'Traduce dominios']]],
  hard: [['¿Para qué sirve el campo TTL de un paquete IP?', ['Limitar los saltos que puede dar el paquete', 'Cifrar el contenido', 'Asignar la MAC', 'Medir Mbps']], ['Un ASN identifica a…', ['Un sistema autónomo en Internet', 'Un antivirus', 'Una red Wi‑Fi doméstica', 'Un certificado SSL']], ['IPv6 usa direcciones de…', ['128 bits', '32 bits', '64 bits', '16 bits']], ['¿Qué permite NAT?', ['Compartir una IP pública entre equipos con IP privada', 'Acelerar siempre el Wi‑Fi', 'Reemplazar al DNS', 'Eliminar la necesidad de firewall']], ['Un puerto en estado LISTEN significa que…', ['Hay un servicio aceptando conexiones', 'El cable está desconectado', 'La IP es inválida', 'Solo hay tráfico broadcast']], ['¿Qué flags forman el saludo de tres vías de TCP?', ['SYN, SYN-ACK, ACK', 'GET, POST, PUT', 'REQ, RES, FIN', 'PING, PONG, ACK']]],
};
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function validQ(p, seen) {
  if (!p || typeof p.q !== 'string' || !Array.isArray(p.opts) || p.opts.length !== 4) return null;
  const opts = p.opts.map(o => String(o).trim()); const c = Number(p.c);
  if (!Number.isInteger(c) || c < 0 || c > 3 || opts.some(o => !o || o.length > 140) || new Set(opts.map(norm)).size !== 4) return null;
  if (p.q.length < 12 || p.q.length > 260 || seen.has(norm(p.q))) return null;
  // mezclar opciones para que la correcta no sea siempre la misma posición
  const order = shuffle([0, 1, 2, 3]);
  return { q: p.q.trim(), opts: order.map(i => opts[i]), c: order.indexOf(c) };
}
app.post('/api/quiz/generate', requireAuth, async (req, res) => {
  const u = ensureProgress(req.user);
  const left = Math.max(0, (u.quizAt || 0) + 600000 - Date.now());
  if (left > 0) return res.status(429).json({ error: 'Cooldown activo', quizCooldown: left });
  const difficulty = ['easy', 'medium', 'hard'].includes(req.body?.difficulty) ? req.body.difficulty : 'medium';
  const lang = String(req.body?.lang || u.lang || 'es').slice(0, 12);
  const seenArr = Array.isArray(u.quizSeen) ? u.quizSeen : [];
  const seen = new Set(seenArr);
  const topics = shuffle(QUIZ_TOPICS).slice(0, 3);
  const level = { easy: 'principiante: conceptos básicos y definiciones claras', medium: 'intermedio: aplicación práctica y casos cotidianos de un técnico de red', hard: 'avanzado: escenarios reales de diagnóstico, cálculos o detalles técnicos finos' }[difficulty];
  let out = [];
  for (let attempt = 0; attempt < 2 && out.length < 3; attempt++) {
    const raw = await aiChat([
      { role: 'system', content: ((typeof global.iphubLearnExtra === 'function' && global.iphubLearnExtra(req.user).learnPrompt) || 'Sos un profesor de redes que escribe preguntas de examen claras, correctas y sin ambigüedad.') + ' Devolvés SOLO un objeto JSON válido.' },
      { role: 'user', content: `Escribí 3 preguntas de opción múltiple en el idioma ${langName(lang)} (código ${lang}). Nivel: ${level}. Una pregunta por cada tema: 1) ${topics[0]}; 2) ${topics[1]}; 3) ${topics[2]}.\nReglas: enunciado natural y concreto (nada raro ni rebuscado); exactamente 4 opciones plausibles y distintas; una sola correcta, verificable y 100% cierta; sin "todas las anteriores"; no repitas estas preguntas ya usadas: ${JSON.stringify(seenArr.slice(-12))}. Semilla de variación: ${crypto.randomBytes(4).toString('hex')}.\nFormato exacto: {"questions":[{"q":"...","opts":["...","...","...","..."],"c":0}]} donde c es el índice (0-3) de la correcta.` }
    ], { temperature: 0.9, max_tokens: 1400, provider: (typeof global.iphubLearnExtra === 'function' ? global.iphubLearnExtra(req.user).provider : 'auto') });
    if (!raw) break;
    try {
      const arr = parseJsonLoose(raw) || [];
      const list = Array.isArray(arr) ? arr : (arr.questions || []);
      for (const p of list) { const v = validQ(p, seen); if (v) { out.push(v); seen.add(norm(v.q)); } }
    } catch (_) {}
  }
  let source = 'ai';
  if (out.length < 3) { // respaldo local (sin IA): banco mezclado y sin repetir
    source = 'bank';
    const bank = shuffle(QUIZ_BANK[difficulty]).filter(([q]) => !out.some(o => o.q === q));
    const fresh = bank.filter(([q]) => !seen.has(norm(q))); const pool = fresh.length >= 3 - out.length ? fresh : bank;
    for (const [q, opts] of pool) { if (out.length >= 3) break; const v = validQ({ q, opts, c: 0 }, new Set()); if (v) out.push(v); }
  }
  out = out.slice(0, 3);
  db.get('users').find({ id: req.user.id }).assign({ quizSeen: [...seenArr, ...out.map(o => norm(o.q))].slice(-40) }).write();
  res.json({ difficulty, source, questions: out.map((p, i) => ({ id: i, q: p.q, opts: p.opts, c: p.c })), quizCooldown: 0 });
});

// ---------- Traducción de la interfaz (cache en base de datos) ----------
// Varios motores gratuitos en cadena: si uno falla o te bloquea (429), se pasa al siguiente y el que falló descansa un rato.
const I18N_RL = new Map();
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' };
const GTX = { he: 'iw', nb: 'no', fil: 'tl' };
const MSL = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', sr: 'sr-Cyrl', mn: 'mn-Cyrl', nb: 'nb', fil: 'fil' };
const groupStrings = (strs, maxLen, maxN) => { const groups = []; let cur = [], len = 0; for (const s of strs) { if (len + s.length > maxLen || cur.length >= maxN) { groups.push(cur); cur = []; len = 0; } cur.push(s); len += s.length + 1; } if (cur.length) groups.push(cur); return groups; };

// Motor 1: Google (endpoint gtx). Frases unidas por saltos de línea; si no coincide la cantidad, una por una.
async function gtxRaw(text, tl) {
  const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=es&dt=t&tl=' + encodeURIComponent(GTX[tl] || tl) + '&q=' + encodeURIComponent(text), { signal: AbortSignal.timeout(6000), headers: UA });
  if (!r.ok) { const e = new Error('Google HTTP ' + r.status); e.status = r.status; throw e; }
  const d = await r.json(); return d[0].map(x => x[0]).join('');
}
async function engGoogle(strs, tl) {
  const out = {}; let lastErr = null, fatal = null;
  const groups = groupStrings(strs, 1500, 25); let gi = 0;
  await Promise.all(Array.from({ length: Math.min(8, groups.length) }, async () => {
    while (gi < groups.length && !fatal) {
      const g = groups[gi++];
      try {
        const lines = (await gtxRaw(g.join('\n'), tl)).split('\n').map(x => x.trim());
        if (lines.length === g.length) g.forEach((x, i) => { if (lines[i]) out[x] = lines[i]; });
        else for (const x of g) { try { const t = await gtxRaw(x, tl); if (t) out[x] = t; } catch (e) { lastErr = e; if (e.status === 429) { fatal = e; return; } } }
      } catch (e) { lastErr = e; if (e.status === 429 || e.status >= 500) { fatal = e; return; } }
    }
  }));
  if (!Object.keys(out).length && (fatal || lastErr)) throw fatal || lastErr;
  return out;
}
// Motor 2: Microsoft Edge Translator (token gratuito público)
let msTok = { t: '', exp: 0 };
async function msToken() {
  if (msTok.t && Date.now() < msTok.exp) return msTok.t;
  const r = await fetch('https://edge.microsoft.com/translate/auth', { signal: AbortSignal.timeout(5000), headers: UA });
  if (!r.ok) throw new Error('Microsoft auth HTTP ' + r.status);
  msTok = { t: (await r.text()).trim(), exp: Date.now() + 8 * 60e3 }; return msTok.t;
}
async function engMicrosoft(strs, tl) {
  const out = {}; const to = MSL[tl] || tl; let lastErr = null;
  const groups = groupStrings(strs, 4000, 50); let gi = 0;
  await Promise.all(Array.from({ length: Math.min(10, groups.length) }, async () => {
    while (gi < groups.length) {
      const g = groups[gi++];
      for (let k = 0; k < 2; k++) {
        try {
          const token = await msToken();
          const r = await fetch('https://api-edge.cognitive.microsofttranslator.com/translate?from=es&to=' + encodeURIComponent(to) + '&api-version=3.0&includeSentenceLength=true', { method: 'POST', signal: AbortSignal.timeout(8000), headers: { ...UA, 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(g.map(Text => ({ Text }))) });
          if (r.status === 401) { msTok = { t: '', exp: 0 }; continue; }
          if (!r.ok) throw new Error('Microsoft HTTP ' + r.status);
          const d = await r.json(); g.forEach((x, i) => { const t = d[i]?.translations?.[0]?.text; if (t) out[x] = t; }); lastErr = null; break;
        } catch (e) { lastErr = e; }
      }
    }
  }));
  if (!Object.keys(out).length && lastErr) throw lastErr;
  return out;
}
// Motor 3: Google (endpoint alternativo de la extensión de Chrome)
async function engGoogle2(strs, tl) {
  const out = {}; let lastErr = null;
  for (const s of strs) {
    try {
      const r = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=es&tl=' + encodeURIComponent(GTX[tl] || tl) + '&q=' + encodeURIComponent(s), { signal: AbortSignal.timeout(10000), headers: UA });
      if (!r.ok) throw new Error('Google2 HTTP ' + r.status);
      const d = await r.json(); const t = Array.isArray(d) ? (Array.isArray(d[0]) ? d[0][0] : d[0]) : (d.sentences || []).map(x => x.trans).join('');
      if (t) out[s] = String(t);
    } catch (e) { lastErr = e; if (/429/.test(e.message)) break; }
    await sleep(120);
  }
  if (!Object.keys(out).length && lastErr) throw lastErr;
  return out;
}
const ENGINES = [{ name: 'Microsoft', fn: engMicrosoft, off: 0, fails: 0 }, { name: 'Google', fn: engGoogle, off: 0, fails: 0 }, { name: 'Google2', fn: engGoogle2, off: 0, fails: 0 }];
let aiI18nBusy = false;
async function translateMissing(lang, strs) {
  const out = {}; let todo = strs.slice(); const errs = [];
  const runEng = async (eng, part) => {
    try { const got = await eng.fn(part, lang); Object.assign(out, got); eng.fails = 0; }
    catch (e) {
      eng.fails++; eng.off = Date.now() + Math.min(5 * 60e3, 45e3 * eng.fails); errs.push(`${eng.name}: ${e.message}`);
      console.warn(`[i18n] ${eng.name} falló (${e.message}); descansa ${Math.round((eng.off - Date.now()) / 1000)}s`);
    }
  };
  // Etapa rápida: los dos motores principales se reparten el trabajo en paralelo (tarda lo que tarda el más lento, no la suma)
  const fast = ENGINES.filter(e => e.off <= Date.now()).slice(0, 2);
  if (fast.length === 2 && todo.length > 20) {
    const cut = Math.ceil(todo.length * 0.6);
    await Promise.all([runEng(fast[0], todo.slice(0, cut)), runEng(fast[1], todo.slice(cut))]);
    todo = strs.filter(x => !out[x]);
  }
  // Lo que falte (o si hay pocos textos) va por la cadena de respaldo
  for (const eng of ENGINES) {
    if (!todo.length) break;
    if (eng.off > Date.now()) continue; // descansando tras fallar
    await runEng(eng, todo);
    todo = strs.filter(x => !out[x]);
  }
  // último recurso: IA, en tandas chicas y solo si no está ocupada con el chat (no gasta el límite por minuto del chat)
  if (todo.length && !aiI18nBusy) {
    aiI18nBusy = true;
    try {
      for (const part of groupStrings(todo.slice(0, 30), 1800, 15)) {
        const raw = await aiChat([{ role: 'system', content: 'You translate software UI strings. Reply with JSON only, no markdown.' }, { role: 'user', content: `Translate these UI strings from Spanish to ${langName(lang)}. Keep brand names (IPHub), acronyms (IP, DNS, ARP, MAC, CIDR, TCP, VPN), numbers, emojis and symbols unchanged. Return {"t":[...]} with the same length and order.\n${JSON.stringify(part)}` }], { temperature: 0.2, max_tokens: 1500, background: true });
        if (!raw) break;
        const t = (parseJsonLoose(raw) || {}).t;
        if (Array.isArray(t) && t.length === part.length) part.forEach((x, k) => { if (t[k]) out[x] = String(t[k]); });
      }
    } finally { aiI18nBusy = false; }
  }
  return out;
}
// Todos los textos traducibles de la interfaz (HTML + mensajes de los JS + errores del servidor), para traducirlos juntos y de una vez
const UI_JS = ['app.js', 'extra.js', 'features.js', 'v3.js'];
let UI_STRINGS = null;
const normS = x => String(x).replace(/\s+/g, ' ').trim();
const okUi = t => {
  if (t.length < 2 || t.length > 600 || !/\p{L}/u.test(t)) return false;
  if (/^[\d\s.,:;\/%+\-–—·×()#\[\]{}]*$/.test(t) || /^\S+@\S+$/.test(t) || /^(https?:|\/|#|\.)/.test(t) || /^[\w-]+(\.[\w-]+)+$/.test(t)) return false;
  if (/^[\w-]+$/.test(t)) return /^[A-ZÁÉÍÓÚÑ¿¡]/.test(t) && !/^[A-Z0-9_]+$/.test(t) && t.length > 2; // una sola palabra: solo si parece una etiqueta ("Guardar"), no un identificador
  return true;
};
function uiStrings() {
  if (UI_STRINGS) return UI_STRINGS;
  const set = new Set(); const add = t => { t = normS(t); if (okUi(t) && t !== 'IPHub') set.add(t); };
  try {
    let h = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
    for (const m of h.matchAll(/>([^<>]+)</g)) add(m[1].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#xFE0E;/g, ''));
    for (const m of h.matchAll(/\b(?:placeholder|title|aria-label|alt)="([^"]+)"/g)) add(m[1]);
    const t = /<title>([^<]+)</.exec(h); if (t) add(t[1]);
  } catch (e) { console.warn('[i18n] index.html:', e.message); }
  const lit = /(['"`])((?:\\.|(?!\1)[^\\\n])*?)\1/g;
  for (const f of UI_JS) {
    try {
      const src = fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');
      for (const x of src.matchAll(/>([A-Za-z\u00c0-\u00ff¿¡][^<>{}`'"=;()\n]{1,80})</g)) add(x[1]); // texto entre etiquetas dentro de plantillas
      for (const m of src.matchAll(lit)) {
        let t = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ');
        if (m[1] === '`') { let n = 0; t = t.replace(/\$\{[^}]*\}/g, () => '{' + (++n) + '}'); }
        if (/<[a-z\/]|=>|function|\.\w+\(|^\s*[{[]/.test(t)) { for (const x of t.matchAll(/>([^<>{}]{3,})</g)) add(x[1]); continue; }
        if (/[ \u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00bf\u00a1]/.test(t) && /[A-Za-z\u00c0-\u00ff]{3}/.test(t)) add(t);
      }
    } catch (_) {}
  }
  try { // mensajes que manda el servidor y se muestran en pantalla (errores, avisos)
    const src = fs.readFileSync(__filename, 'utf8');
    for (const line of src.split('\n')) {
      if (!/error|res\.status|res\.json|message/.test(line)) continue;
      for (const m of line.matchAll(/(['`])((?:\\.|(?!\1)[^\\\n])*?)\1/g)) {
        let n = 0, t = m[2].replace(/\\'/g, "'").replace(/\$\{[^}]*\}/g, () => '{' + (++n) + '}');
        if (/^[A-ZÁÉÍÓÚÑ¿¡]/.test(t) && /\s/.test(t) && !/[=;<>]|=>|\.\w+\(/.test(t)) add(t);
      }
    }
  } catch (_) {}
  UI_STRINGS = [...set]; console.log('  Textos de la interfaz para traducir: ' + UI_STRINGS.length);
  return UI_STRINGS;
}
const BUNDLE_JOBS = new Map();
function runBundle(lang) {
  if (!BUNDLE_JOBS.has(lang)) {
    BUNDLE_JOBS.set(lang, (async () => {
      const cache = () => (db.get('i18n').value() || {})[lang] || {};
      if (!Object.keys(cache()).length) { try { const rr = await require('./remote-store').loadLang(lang); if (rr) db.set(['i18n', lang], rr); } catch (_) {} }
      const all = uiStrings(), c = cache(), need = all.filter(x => !Object.prototype.hasOwnProperty.call(c, x));
      if (need.length) {
        const parts = []; for (let i = 0; i < need.length; i += 120) parts.push(need.slice(i, i + 120));
        let k = 0, total = 0;
        await Promise.all(Array.from({ length: Math.min(5, parts.length) }, async () => {
          while (k < parts.length) {
            const got = await translateMissing(lang, parts[k++]); total += Object.keys(got).length;
            if (Object.keys(got).length) db.set(['i18n', lang], Object.assign({}, cache(), got)).write();
          }
        }));
        console.log(`[i18n] ${lang}: ${total}/${need.length} textos nuevos traducidos`);
        try { require('./remote-store').saveLang(lang, cache()); } catch (_) {}
      }
      const c2 = cache(), map = {}; for (const x of all) if (c2[x]) map[x] = c2[x];
      return { map, total: all.length, done: Object.keys(map).length };
    })().finally(() => setTimeout(() => BUNDLE_JOBS.delete(lang), 1000)));
  }
  return BUNDLE_JOBS.get(lang);
}
// Traduce TODA la interfaz de un idioma de una vez (una sola ida y vuelta; lo ya traducido sale de la caché)
app.post('/api/i18n/bundle', async (req, res) => {
  const lang = String(req.body?.lang || '');
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/.test(lang) || lang === 'es') return res.status(400).json({ error: 'Idioma inválido' });
  const now = Date.now(); const rl = (I18N_RL.get('b' + req.ip) || []).filter(t => now - t < 60000);
  if (rl.length >= 20) return res.status(429).json({ error: 'Demasiadas solicitudes' });
  rl.push(now); I18N_RL.set('b' + req.ip, rl);
  try {
    const job = runBundle(lang), r = await Promise.race([job, new Promise(ok => setTimeout(() => ok(null), 2000))]);
    if (r) return res.json(r);
    const c = (db.get('i18n').value() || {})[lang] || {}, map = {}; for (const x of uiStrings()) if (c[x]) map[x] = c[x];
    return res.json({ map, partial: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Al arrancar, deja listo el inglés (el idioma más pedido) para que el primer cambio sea instantáneo
setTimeout(() => { try { uiStrings(); } catch (_) {} }, 500);
// Precalentado: traduce en segundo plano los idiomas más pedidos y los guarda en la base, así el primer cambio de idioma sale de caché (instantáneo).
// Desactivar con IPHUB_PREWARM=0; cambiar la lista con IPHUB_PREWARM_LANGS=en,pt,fr
if (process.env.IPHUB_PREWARM !== '0') setTimeout(async () => {
  for (const l of (process.env.IPHUB_PREWARM_LANGS || 'en,pt,fr,de,it').split(',').map(x => x.trim()).filter(Boolean)) { try { await runBundle(l); } catch (_) { /* sin internet: se reintenta cuando el usuario cambie de idioma */ } }
}, 4000);

app.post('/api/i18n', async (req, res) => {
  const now = Date.now(); const rl = (I18N_RL.get(req.ip) || []).filter(t => now - t < 60000);
  if (rl.length >= 120) return res.status(429).json({ error: 'Demasiadas solicitudes' });
  rl.push(now); I18N_RL.set(req.ip, rl);
  const lang = String(req.body?.lang || '');
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/.test(lang)) return res.status(400).json({ error: 'Idioma inválido' });
  const strings = [...new Set((Array.isArray(req.body?.strings) ? req.body.strings : []).map(x => String(x).replace(/\s+/g, ' ').trim()))].filter(x => x && x.length <= 1500).slice(0, 150);
  const cache = (db.get('i18n').value() || {})[lang] || {};
  const map = {}; const need = [];
  for (const x of strings) { if (Object.prototype.hasOwnProperty.call(cache, x)) map[x] = cache[x]; else need.push(x); }
  if (need.length) {
    const got = await translateMissing(lang, need);
    Object.assign(map, got);
    if (Object.keys(got).length) db.set(['i18n', lang], Object.assign({}, cache, got)).write();
    if (Object.keys(got).length < need.length) console.warn(`[i18n] ${lang}: tradujo ${Object.keys(got).length}/${need.length} (motores en pausa: ${ENGINES.filter(e => e.off > Date.now()).map(e => e.name).join(', ') || 'ninguno'})`);
  }
  res.json({ map });
});

// Cuentas guardadas en el cliente; endpoint solo lista la actual
app.get('/api/accounts/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(ensureProgress(req.user)) });
});

// ======================================================================
// LOGIN SOCIAL (Google / Discord) + IP DE RED
// ======================================================================
const os = require('os');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1555536920858337371';

app.get('/api/auth/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID, discordClientId: DISCORD_CLIENT_ID, discordRedirect: process.env.DISCORD_REDIRECT_URI || ((process.env.APP_URL || '').replace(/\/$/, '') + '/auth/discord') });
});

// Busca la cuenta por email; si no existe la crea ya verificada (el proveedor verificó el correo).
async function socialLogin(req, res, provider, profile) {
  const em = String(profile.email || '').toLowerCase().trim();
  const pk = provider.toLowerCase();
  if (!em) return res.status(401).json({ error: 'El proveedor no devolvió un correo' });
  let user = db.get('users').find({ email: em }).value();
  if (user && provKey(user) !== pk) {
    const had = provKey(user);
    return res.status(409).json({ error: `Ese correo ya tiene una cuenta creada con ${PROV_NAME[had]}. Para entrar usá ${had === 'credentials' ? 'tu correo y contraseña' : PROV_NAME[had]}; no se inició ni se creó ninguna sesión con ${provider}.`, existingProvider: had });
  }
  if (!user) {
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10); // sin contraseña usable
    user = { id: crypto.randomUUID(), name: profile.name || em.split('@')[0], email: em, company: '', country: '', lang: 'es', passwordHash, verified: true,
      apiKey: 'iphub_live_' + crypto.randomBytes(20).toString('hex'), createdAt: new Date().toISOString(), provider: pk };
    db.get('users').push(user).write();
    addAudit(em, 'Cuenta creada', `Con ${provider}`);
  }
  addAudit(user.email, 'Inicio de sesión', `Con ${provider} · IP origen: ${req.ip}`);
  try { writeDbNow(); } catch (_) {}
  const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
}

app.post('/api/auth/google', async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) return res.status(400).json({ error: 'Google no está configurado (GOOGLE_CLIENT_ID en .env)' });
    const b = req.body || {};
    if (b.accessToken) { // flujo por ventana emergente (token de acceso)
      const ti = await (await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(String(b.accessToken)))).json();
      if (ti.error || (ti.aud !== GOOGLE_CLIENT_ID && ti.azp !== GOOGLE_CLIENT_ID)) return res.status(401).json({ error: 'El token de Google no pertenece a esta app' });
      const ui = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + b.accessToken } })).json();
      if (!ui.email || String(ui.email_verified) !== 'true') return res.status(401).json({ error: 'Tu correo de Google no está verificado' });
      return await socialLogin(req, res, 'Google', { email: ui.email, name: ui.name });
    }
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(b.idToken || '')));
    if (!r.ok) return res.status(401).json({ error: 'Token de Google inválido' });
    const p = await r.json();
    if (p.aud !== GOOGLE_CLIENT_ID) return res.status(401).json({ error: 'El token de Google no pertenece a esta app' });
    if (String(p.email_verified) !== 'true') return res.status(401).json({ error: 'Tu correo de Google no está verificado' });
    await socialLogin(req, res, 'Google', { email: p.email, name: p.name });
  } catch (e) { res.status(500).json({ error: 'No se pudo validar con Google: ' + e.message }); }
});

app.post('/api/auth/discord', async (req, res) => {
  try {
    const r = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + String((req.body || {}).accessToken || '') } });
    if (!r.ok) return res.status(401).json({ error: 'Token de Discord inválido' });
    const p = await r.json();
    const email = (p.email && p.verified) ? p.email : `discord_${p.id}@iphub.local`;
    await socialLogin(req, res, 'Discord', { email, name: p.global_name || p.username });
  } catch (e) { res.status(500).json({ error: 'No se pudo validar con Discord: ' + e.message }); }
});

// IP de red del equipo donde corre IPHub (para el Dashboard)
function maskToPrefix(mask) { return mask.split('.').reduce((n, o) => n + (parseInt(o, 10) >>> 0).toString(2).replace(/0/g, '').length, 0); }
app.get('/api/network/info', requireAuth, (req, res) => {
  const list = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const prefix = maskToPrefix(a.netmask);
      const net = a.address.split('.').map((o, i) => parseInt(o, 10) & parseInt(a.netmask.split('.')[i], 10)).join('.');
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      list.push({ iface, address: a.address, netmask: a.netmask, cidr: `${net}/${prefix}`, mac: a.mac, priv });
    }
  }
  list.sort((x, y) => (y.priv - x.priv));
  res.json({ primary: list[0] || null, interfaces: list });
});

// ---------- Fallback SPA ----------
app.get('/download/agent', (req, res) => {
  if (process.env.EXE_URL) return res.redirect(process.env.EXE_URL); // link a GitHub Releases (el exe no se sube al repo)
  const zip = path.join(__dirname, 'public', 'download', 'IPHub-Windows.zip');
  if (fs.existsSync(zip)) return res.download(zip, 'IPHub-Windows.zip');
  const candidates = [
    path.join(__dirname, 'public', 'download', 'IPHub.exe'),
    path.join(__dirname, 'public', 'download', 'IPHub-Monitor.exe'),
    path.join(__dirname, 'public', 'download', 'IPHub-Agent.exe'),
    path.join(__dirname, 'agent', 'dist', 'IPHub-win32-x64', 'IPHub.exe'),
    path.join(__dirname, 'agent', 'dist', 'IPHub.exe'),
    path.join(__dirname, 'dist', 'IPHub.exe'),
  ];
  for (const exe of candidates) {
    if (fs.existsSync(exe)) return res.download(exe, 'IPHub.exe');
  }
  res.status(404).type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>IPHub.exe</title>
  <style>body{font-family:system-ui;background:#0a1628;color:#e2e8f0;padding:2rem;max-width:640px;margin:auto;line-height:1.6}
  code{background:#1e293b;padding:.15rem .4rem;border-radius:4px}</style></head><body>
  <h1>IPHub para Windows aún no está compilado</h1>
  <p>En una PC con <strong>Windows</strong> y Node 18+, doble clic en <code>BUILD-EXE.bat</code>.</p>
  <p>Genera <code>public\download\IPHub-Windows.zip</code>. Descomprimilo y abrí <code>IPHub.exe</code>. No hace falta Modo desarrollador ni administrador.</p>
  <p><a href="/home" style="color:#06b6d4">Volver a IPHub</a></p></body></html>`);
});

try { require('./server-studio')(app, { db, requireAuth, addAudit, aiChat }); } catch (e) { console.error('server-studio:', e); }
try { require('./server-mods')(app, { db, requireAuth, addAudit, sendMail, crypto }); } catch (e) { console.error('server-mods:', e); }
try { require('./server-hub')(app, { db, requireAuth, addAudit }); } catch (e) { console.error('server-hub:', e); }
try { require('./server-profiles')(app, { db, bcrypt, crypto, requireAuth, addAudit, sendMail, SUPPORT_TO }); } catch (e) { console.error('profiles:', e); }
try { require('./server-org')(app, { db, bcrypt, jwt, crypto, requireAuth, addAudit, JWT_SECRET, sendMail }); } catch (e) { console.error('server-org:', e); }

app.get('/api/intercept/requests', requireOwner, (req, res) => {
  const since = +req.query.since || 0;
  res.json({ last: INTERCEPT.seq, total: INTERCEPT.buf.length, items: INTERCEPT.buf.filter(e => e.id > since).slice(-300) });
});
app.delete('/api/intercept/requests', requireOwner, (req, res) => { INTERCEPT.buf = []; res.json({ ok: true }); });

// ---------- Globo 3D: traza real -> POP -> IXP -> carrier -> destino con geolocalización ----------
const isPrivIp = ip => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);
app.post('/api/topo/globe', requireAuth, async (req, res) => {
  const target = String((req.body || {}).target || '').trim();
  if (!target || !isValidTarget(target)) return res.status(400).json({ error: 'Destino inválido' });
  const r = await traceCore(target, 25);
  if (!r) return res.status(503).json({ error: TRACE_FAIL });
  const hops = [];
  for (const line of r.raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/); if (!m) continue;
    const ip = (m[2].match(/(\d{1,3}(?:\.\d{1,3}){3})/) || [])[1]; const rt = [...m[2].matchAll(/(\d+[.,]?\d*)\s*ms/gi)].map(x => +x[1].replace(',', '.'));
    hops.push({ n: +m[1], ip: ip || null, rtt: rt.length ? Math.round(rt.reduce((a, b) => a + b, 0) / rt.length * 10) / 10 : null });
  }
  const pubs = [...new Set(hops.filter(h => h.ip && !isPrivIp(h.ip)).map(h => h.ip))].slice(0, 24);
  const clientIp = String(req.ip || '').replace('::ffff:', '');
  const geo = {}; await Promise.all([...pubs, ...(clientIp && !isPrivIp(clientIp) && /^\d/.test(clientIp) ? [clientIp] : [])].map(async ip => { try { geo[ip] = await geoLookup(ip); } catch (_) {} }));
  const IX = /(\bix\b|de-cix|ams-ix|linx|equinix|megaport|peering|exchange|mix-|nap\b|ix\.)/i;
  const nodes = []; let stage = 'pop', lastAs = null, seenPop = false;
  const local = geo[clientIp] && geo[clientIp].lat != null ? geo[clientIp] : null;
  for (const h of hops) {
    if (!h.ip) continue; const g = geo[h.ip];
    if (isPrivIp(h.ip) || !g || g.lat == null) { if (!nodes.length || nodes[nodes.length - 1].stage === 'local') nodes.push({ stage: 'local', ip: h.ip, n: h.n, rtt: h.rtt, private: true }); continue; }
    let st;
    if (!seenPop) { st = 'pop'; seenPop = true; } else if (IX.test(`${g.org} ${g.asname} ${g.reverse} ${g.isp}`)) st = 'ixp'; else st = 'carrier';
    nodes.push({ stage: st, ip: h.ip, n: h.n, rtt: h.rtt, lat: g.lat, lon: g.lon, city: g.city, country: g.country, cc: g.countryCode, as: g.as, org: g.org || g.isp });
  }
  if (nodes.length) nodes[nodes.length - 1].stage = nodes.length > 1 ? 'device' : nodes[0].stage;
  const firstPub = nodes.find(n => n.lat != null);
  const loc = local || (firstPub ? { lat: firstPub.lat + 0.08, lon: firstPub.lon + 0.08, city: firstPub.city, country: firstPub.country } : null);
  const out = { target, tool: r.tool, local: loc ? { stage: 'local', lat: loc.lat, lon: loc.lon, city: loc.city, country: loc.country, ip: local ? clientIp : null } : null, nodes: nodes.filter(n => n.lat != null) };
  addAudit(req.user.email, 'Globo 3D: traza geolocalizada', `Destino: ${target}`);
  res.json(out);
});
try { require('./server-innov')(app, { requireAuth, addAudit, isValidTarget: typeof isValidTarget === 'function' ? isValidTarget : null }); } catch (e) { console.error('server-innov:', e); }
try { require('./server-code')(app, { db, requireAuth, requireOwner, addAudit, crypto, publicUser, isOwnerUser }); } catch (e) { console.error('server-code:', e); }
try { require('./server-tracking')(app, { db, requireAuth, addAudit, crypto }); } catch (e) { console.error('server-tracking:', e); }
try { require('./server-tracking-analytics')(app, { db, requireAuth, addAudit, crypto }); } catch (e) { console.error('server-tracking-analytics:', e); }
try { require('./server-tracking-smart-alerts')(app, { db, requireAuth, addAudit, crypto }); } catch (e) { console.error('server-tracking-smart-alerts:', e); }
try { require('./server-tracking-predictive')(app, { db, requireAuth, addAudit, crypto }); } catch (e) { console.error('server-tracking-predictive:', e); }
try { require('./server-tracking-bridge')(app, { db, requireAuth, addAudit, crypto }); } catch (e) { console.error('server-tracking-bridge:', e); }
try { require('./server-tracking-gis')(app, { db, requireAuth, addAudit, crypto }); } catch (e) { console.error('server-tracking-gis:', e); }
try { require('./server-tracking-sim')(app, { db, requireAuth, addAudit, crypto }); } catch (e) { console.error('server-tracking-sim:', e); }
try { require('./server-tracking-ops')(app, { db, requireAuth, addAudit, crypto }); } catch (e) { console.error('server-tracking-ops:', e); }
try { require('./server-tracking-extra')(app, { db, requireAuth, addAudit, crypto }); } catch (e) { console.error('server-tracking-extra:', e); }

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (typeof global.iphubEnsureOwner === 'function') global.iphubEnsureOwner().catch(e => console.error(e));
if (process.env.RENDER_EXTERNAL_URL) setInterval(() => { fetch(process.env.RENDER_EXTERNAL_URL + '/').catch(() => {}); }, 10 * 60 * 1000); // evita que Render Free se duerma
process.on('uncaughtException', e => console.error('[uncaught]', e && e.stack || e));
process.on('unhandledRejection', e => console.error('[unhandled]', e && e.stack || e));
app.use((err, req, res, next) => { console.error('[express]', err && err.message); if (res.headersSent) return next(err); res.status(500).json({ error: 'Error interno del servidor' }); });
process.on('SIGTERM', async () => { try { await require('./remote-store').save(state, true); } catch (_) {} process.exit(0); });
app.listen(PORT, '0.0.0.0', () => {
  const { user: smtpU, pass: smtpP } = mailCfg();
  console.log('');
  console.log('========================================');
  console.log('  IPHub listo · puerto ' + PORT);
  console.log('========================================');
  console.log('  DB: ' + dbFile + ' · users=' + (db.get('users').value() || []).length);
  console.log('  JWT_SECRET: ' + (JWT_SECRET === 'inseguro_cambia_esto_en_.env' ? 'DEFAULT (CAMBIALO)' : 'ok'));
  console.log('  SMTP_USER: ' + (smtpU || 'VACIO') + ' · SMTP_PASS: ' + (smtpP ? smtpP.length + ' chars' : 'VACIO'));
  console.log('  AUTO_VERIFY_ON_SMTP_FAIL: ' + (process.env.AUTO_VERIFY_ON_SMTP_FAIL !== '0' ? 'si' : 'no'));
  aiProviders().then(l => {
    console.log('  IA proveedores: ' + (l.length ? l.map(p => p.name).join(' → ') : 'NINGUNO (poné GROQ_API_KEY o GEMINI_API_KEY en Environment)'));
  }).catch(() => {});
  console.log('');
});
