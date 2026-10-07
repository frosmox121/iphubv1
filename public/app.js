function countryFlag(cc){if(!cc)return "";const c=String(cc).toLowerCase();return `<img class="flag-img" src="https://flagcdn.com/w40/${c}.png" srcset="https://flagcdn.com/w80/${c}.png 2x" alt="${c.toUpperCase()}" loading="lazy" onerror="this.style.display='none'">`;}
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const API = ''; // mismo origen: el propio Express sirve el frontend

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3200);
}

let TOKEN = localStorage.getItem('iphub_token') || null;
let ME = null;

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const isJson = (r.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await r.json() : await r.text();
  if (!r.ok) {
    // Sesión huérfana (DB reiniciada en Render Free): limpiar y volver al login
    if (r.status === 401 && data && (data.code === 'USER_GONE' || data.error === 'Usuario no existe' || data.code === 'BAD_TOKEN')) {
      TOKEN = null;
      try { localStorage.removeItem('iphub_token'); } catch (_) {}
      ME = null;
      const app = document.getElementById('app');
      const auth = document.getElementById('auth-screen');
      if (app) app.classList.add('hidden');
      if (auth) auth.classList.remove('hidden');
      toast(data.hint || 'Sesión inválida. Volvé a iniciar sesión o registrate.', true);
    }
    throw new Error((data && data.error) || `Error ${r.status}`);
  }
  return data;
}

// ---------- Auth ----------
$$('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.auth-tab').forEach(t => t.classList.remove('active'));
    $$('.auth-form').forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    $(`#${tab.dataset.tab}-form`).classList.add('active');
  });
});

async function enterApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  showSection('dashboard');
  const me = await api('/api/auth/me');
  ME = me.user;
  $('#user-name').textContent = ME.name;
  $('#user-email').textContent = ME.email;
  (function setAv() {
    const n = String(ME.name || ME.email || '?').trim().split(/\s+/).filter(Boolean);
    const ini = n.length >= 2 ? (n[0][0] + n[1][0]) : (n[0] || '?').slice(0, 2);
    const av = $('#user-avatar');
    if (av) av.textContent = ini.toUpperCase();
  })();
  $('#acc-name').value = ME.name;
  $('#acc-company').value = ME.company || '';
  $('#api-key').textContent = ME.apiKey;
  const w = $('#dash-welcome');
  if (w) w.textContent = '¡Bienvenido a IPHub! (' + (ME.name || '') + ')';
  await Promise.all([refreshDashboard(), refreshDevices(), refreshAudit(), refreshProgress()]);
  try {
    if (ME && ME.isOwner) {
      document.querySelectorAll('#acc-email, #acc-password, [data-delete-account], #delete-account-btn').forEach(el => {
        if (!el) return;
        el.disabled = true;
        el.title = 'La cuenta del dueño no se puede modificar ni eliminar';
      });
      const del = document.querySelector('#account h3');
      // hide delete section if present
      document.querySelectorAll('#account h3').forEach(h => {
        if (/Eliminar cuenta/i.test(h.textContent || '')) {
          let n = h.nextElementSibling;
          h.style.display = 'none';
          while (n && n.tagName !== 'H3') { const nx = n.nextElementSibling; n.style.display = 'none'; n = nx; }
        }
      });
    }
  } catch (_) {}

  try { if (typeof saveAccountLocal === 'function') saveAccountLocal(ME); } catch (_) {}
}

async function refreshProgress() {
  try {
    const p = await api('/api/progress');
    const lv = $('#prog-level'), xp = $('#prog-xp'), need = $('#prog-need'), bar = $('#prog-bar');
    if (lv) lv.textContent = p.level;
    if (xp) xp.textContent = p.xp;
    if (need) need.textContent = p.need;
    if (bar) bar.style.width = Math.min(100, Math.round((p.xp / Math.max(1, p.need)) * 100)) + '%';
    const cd = $('#quiz-cooldown');
    if (cd) cd.textContent = p.quizCooldown > 0 ? ('Próximo quiz disponible en ' + Math.ceil(p.quizCooldown / 60000) + ' min') : 'Podés iniciar un quiz ahora';
  } catch (_) {}
}

let PENDING_EMAIL = '';
function showVerify(email, emailSent) {
  PENDING_EMAIL = email;
  $$('.auth-form').forEach(f => f.classList.remove('active')); $('#verify-form').classList.add('active');
  $$('.auth-tab').forEach(t => t.classList.remove('active'));
  $('#verify-info').textContent = emailSent
    ? `Te enviamos un código de 6 dígitos a ${email}. Ingresalo para activar tu cuenta.`
    : `No se pudo enviar el correo a ${email}. Mirá los Logs de Render: buscá "[VERIFY CODE]" y copiá el código de 6 dígitos. También revisá SMTP_USER (Gmail) y SMTP_PASS (App Password de 16 letras sin espacios).`;
  $('#verify-code').focus();
}
function fail(el, e) { el.textContent = e.message; el.classList.remove('hidden'); }

// Captcha simple (math) — sin dependencias externas
let _capLogin = 0, _capReg = 0;
async function refreshCaptcha(which) {
  const r = await fetch('/api/auth/captcha'); const d = await r.json();
  if (which === 'login') { window._capIdLogin = d.id; const el = $('#captcha-q-login'); if (el) el.textContent = d.question + ' = ?'; $('#login-captcha') && ($('#login-captcha').value = ''); }
  else { window._capIdReg = d.id; const el = $('#captcha-q-reg'); if (el) el.textContent = d.question + ' = ?'; $('#reg-captcha') && ($('#reg-captcha').value = ''); }
}
document.addEventListener('DOMContentLoaded', () => { refreshCaptcha('login'); refreshCaptcha('reg'); });
document.addEventListener('click', e => {
  if (e.target?.id === 'captcha-refresh-login') refreshCaptcha('login');
  if (e.target?.id === 'captcha-refresh-reg') refreshCaptcha('reg');
});

let LOGIN_STAGE = 0; // 0=creds 1=code
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#login-error'); err.classList.add('hidden');
  if (LOGIN_STAGE === 0) {
    const ans = parseInt($('#login-captcha')?.value, 10);
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value, captchaId: window._capIdLogin, captcha: $('#login-captcha').value }) });
    const data = await r.json();
    if (r.status === 403 && data.needsVerification) return showVerify(data.email, data.emailSent);
    if (r.status === 202 && data.needsLoginCode) {
      LOGIN_STAGE = 1;
      $('#login-code-g')?.classList.remove('hidden');
      $('#login-code-info').textContent = data.emailSent
        ? 'Te enviamos un código de 6 dígitos a ' + data.email + '. Ingresalo para completar el acceso.'
        : 'SMTP sin configurar: el código está en la consola del servidor.';
      $('#login-submit-btn').textContent = 'Confirmar código';
      $('#login-code')?.focus();
      return;
    }
    if (!r.ok) { refreshCaptcha('login'); return fail(err, new Error(data.error)); }
    TOKEN = data.token; localStorage.setItem('iphub_token', TOKEN); toast('Sesión iniciada'); await enterApp();
    return;
  }
  // stage 1: code
  try {
    const d = await api('/api/auth/login-code', { method: 'POST', body: { email: $('#login-email').value, code: $('#login-code').value } });
    TOKEN = d.token; localStorage.setItem('iphub_token', TOKEN);
    LOGIN_STAGE = 0; $('#login-code-g')?.classList.add('hidden'); $('#login-submit-btn').textContent = 'Acceder a la Plataforma';
    toast('Sesión iniciada'); await enterApp();
  } catch (ex) { fail(err, ex); }
});

$('#register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#register-error'); err.classList.add('hidden');
  if (!window._capIdReg) { await refreshCaptcha('reg'); return fail(err, new Error('Esperá a que cargue el captcha y volvé a intentar')); }
  try {
    const d = await api('/api/auth/register', { method: 'POST', body: {
      name: $('#reg-name').value, company: $('#reg-company').value, companyName: $('#reg-company').value, kind: document.querySelector('input[name=reg-kind]:checked')?.value || 'personal', email: $('#reg-email').value, password: $('#reg-password').value, captchaId: window._capIdReg, captcha: $('#reg-captcha').value } });
    // Si SMTP falló, el servidor auto-verifica y devuelve token
    if (d.token && (d.autoVerified || !d.needsVerification)) {
      TOKEN = d.token; localStorage.setItem('iphub_token', TOKEN);
      toast(d.autoVerified ? 'Cuenta lista (correo no disponible). Entraste sin código.' : 'Cuenta creada');
      await enterApp();
      return;
    }
    showVerify(d.email, d.emailSent);
  } catch (ex) { refreshCaptcha('reg'); fail(err, ex); }
});

$('#verify-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#verify-error'); err.classList.add('hidden');
  try {
    const d = await api('/api/auth/verify', { method: 'POST', body: { email: PENDING_EMAIL, code: $('#verify-code').value } });
    TOKEN = d.token; localStorage.setItem('iphub_token', TOKEN); toast('Correo verificado. ¡Bienvenido a IPHub!'); await enterApp();
  } catch (e) { fail(err, e); }
});
$('#resend-btn').addEventListener('click', async () => {
  try { const d = await api('/api/auth/resend', { method: 'POST', body: { email: PENDING_EMAIL } });
    toast(d.emailSent ? 'Código reenviado' : 'SMTP sin configurar: código en consola del servidor', !d.emailSent); } catch (e) { toast(e.message, true); }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  TOKEN = null; localStorage.removeItem('iphub_token');
  $('#app').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  document.body.dataset.uii = 1;
  toast('Sesión cerrada');
});

// ---------- Navegación ----------
const UII = { leaderboard: 7, dashboard: 2, topology: 3, tools: 4, audit: 5, learn: 2, support: 6, account: 1 };
function clearToolState() {
  // Al salir de una sección, dejar todo como desde 0 (no persistir inputs/resultados de herramientas)
  const ids = ['ip-input','port-target','port-range','trace-target','dns-domain','cidr-input','discover-cidr'];
  const defaults = { 'ip-input':'8.8.8.8', 'port-range':'22,80,443,21,25,53,3389', 'trace-target':'8.8.8.8', 'cidr-input':'192.168.1.0/24', 'discover-cidr':'' };
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = defaults[id] ?? ''; });
  ['ip-results','cidr-results'].forEach(id => { const el = document.getElementById(id); if (el) { el.classList.add('hidden'); el.innerHTML = ''; } });
  ['port-grid','arp-results','trace-body'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  ['ip-error','port-error','trace-error','dns-error','discover-status'].forEach(id => { const el = document.getElementById(id); if (el) { el.classList.add('hidden'); el.textContent = ''; } });
  const tr = document.getElementById('trace-output'); if (tr) tr.textContent = '';
  const tw = document.getElementById('trace-table-wrap'); if (tw) tw.classList.add('hidden');
  const dns = document.getElementById('dns-results'); if (dns) dns.innerHTML = '';
  const dl = document.getElementById('dl-speed'); if (dl) dl.textContent = '—';
  const ul = document.getElementById('ul-speed'); if (ul) ul.textContent = '—';
  const lat = document.getElementById('latency'); if (lat) lat.textContent = '—';
  if (typeof LAST !== 'undefined') { LAST.dl = LAST.ul = null; }
}
function showSection(id) {
  document.body.dataset.uii = UII[id] || 1;
  $$('.section').forEach(s => s.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  $(`#${id}`)?.classList.add('active');
  $(`.nav-item[data-section="${id}"]`)?.classList.add('active');
  $('#sidebar')?.classList.remove('open');
  clearToolState();
  try { document.dispatchEvent(new CustomEvent('iphub:section', { detail: id })); } catch (_) {}
}
$$('.nav-item').forEach(item => item.addEventListener('click', e => { e.preventDefault(); showSection(item.dataset.section); }));
$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.add('open'));
$('#sidebar-close').addEventListener('click', () => $('#sidebar').classList.remove('open'));

$$('.tool-tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tool-tab').forEach(t => t.classList.remove('active'));
  $$('.tool-panel').forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  $(`#tool-${tab.dataset.tool}`).classList.add('active');
  // Al cambiar de herramienta, limpiar como si fuera otra página
  if (typeof clearToolState === 'function') clearToolState();
}));

// ---------- Dashboard (datos reales) ----------
async function refreshDashboard() {
  const d = await api('/api/dashboard/activity');
  const c = (t, n, u = '') => `<div class="card glass stat-card"><h4>${t}</h4><p class="stat-value"><span data-count="${n}">0</span>${u}</p></div>`;
  const recentHtml = d.recent.length
    ? `<div class="activity-list">${d.recent.map(e => `<div class="activity-item"><span class="activity-dot"></span><div><p>${e.action}</p><small>${new Date(e.ts).toLocaleString()}${e.detail ? ' · ' + e.detail : ''}</small></div></div>`).join('')}</div>`
    : '<p class="muted">Todavía no hiciste nada. Probá una herramienta o un quiz en Aprender.</p>';
  $('#dashboard-grid').innerHTML =
    c('Eventos (24 h)', d.events24h) + c('Consultas de IP', d.ipLookups) + c('Escaneos de puertos', d.portScans) + c('Consultas DNS', d.dnsQueries) +
    c('Tickets abiertos', d.openTickets) +
    `<div class="card glass stat-card"><h4>Valoración que dejaste</h4><p class="stat-value">${d.avgRating ?? '—'}<small>${d.avgRating ? ' / 5 ★' : ''}</small></p></div>` +
    `<div class="card glass full-width"><h4>Actividad reciente</h4>${recentHtml}
      <p class="muted small" style="margin-top:1rem">También podés ver niveles en la tarjeta de arriba y practicar en <strong>Aprender</strong>.</p></div>`;
  $$('#dashboard-grid [data-count]').forEach(el => { const to = +el.dataset.count, t0 = performance.now();
    (function step(t) { const p = Math.min(1, (t - t0) / 1000); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(t0); });
}

// ---------- Topología / dispositivos ----------
async function refreshDevices() {
  const { devices } = await api('/api/devices');
  const list = $('#device-list');
  list.innerHTML = devices.length ? devices.map(d => `
    <div class="device-item">
      <span class="dot ${d.online ? 'green' : 'red'}"></span>
      <div>
        <strong>${d.alias || d.ip} ${d.suspicious ? '⚠️ desconocido' : ''}</strong>
        <p>${d.ip} · MAC: ${d.mac || 'sin resolver'} · RTT: ${d.lastRttMs ?? '—'} ms · visto: ${new Date(d.lastSeen).toLocaleString()}</p>
      </div>
      ${d.suspicious ? `<button class="btn btn-sm btn-accent" onclick="trustDevice('${d.id}')">Confiar</button>` : ''}
    </div>`).join('') : '<p class="muted">Sin dispositivos aún. Ejecutá "Descubrir Red".</p>';
}

async function trustDevice(id) {
  try { await api('/api/devices/' + id, { method: 'PUT', body: { suspicious: false, trusted: true } });
    await Promise.all([refreshDevices(), refreshDashboard()]); } catch (e) { toast(e.message, true); }
}
$('#discover-cidr').addEventListener('keydown', e => { if (e.key === 'Enter') $('#discover-btn').click(); });
$('#discover-btn').addEventListener('click', async () => {
  const status = $('#discover-status');
  const cidr = $('#discover-cidr').value.trim();
  if (cidr && !cidr.includes('/')) { // IP o IP:puerto -> sondeo instantáneo
    status.textContent = 'Sondeando…';
    try {
      const r = await api('/api/devices/probe', { method: 'POST', body: { target: cidr } });
      status.textContent = r.port !== null
        ? `${r.host}:${r.port} → ${r.open ? 'ABIERTO' : 'cerrado / filtrado'} (${r.service}) · ${r.ms} ms`
        : `${r.host} → ${r.alive ? 'responde' : 'sin respuesta'}${r.rtt != null ? ' · ' + r.rtt + ' ms' : ''}`;
      refreshAudit();
    } catch (e) { status.textContent = ''; toast(e.message, true); }
    return;
  }
  status.textContent = 'Escaneando de verdad (ping sweep + ARP), puede tardar unos segundos...';
  try {
    const data = await api('/api/devices/discover', { method: 'POST', body: cidr ? { cidr } : {} });
    status.textContent = `Listo: ${data.online} hosts activos de ${data.scanned} IPs escaneadas.`;
    toast('Descubrimiento de red completado');
    await Promise.all([refreshDevices(), refreshDashboard(), refreshAudit()]);
  } catch (e) { status.textContent = ''; toast(e.message, true); }
});

// ---------- Tools (event delegation — siempre funciona) ----------
function toolErr(id, msg) {
  const el = document.getElementById(id);
  if (!el) { toast(msg, true); return; }
  el.textContent = msg; el.classList.remove('hidden');
}
function toolOk(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

async function toolIpLookup() {
  toolOk('ip-error');
  try {
    const d = await api('/api/tools/ip-lookup', { method: 'POST', body: { ip: ($('#ip-input') || {}).value?.trim() || '' } });
    const box = $('#ip-results'); if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="result-item"><label>IP</label><strong>${d.query}</strong></div>
      <div class="result-item"><label>País / Región</label><strong><span class="flag">${d.countryCode ? countryFlag(d.countryCode) : ""}</span> ${d.country || '—'} (${d.countryCode || '—'}) · ${d.regionName || '—'}</strong></div>
      <div class="result-item"><label>Ciudad</label><strong>${d.city || '—'}</strong></div>
      <div class="result-item"><label>ISP / Org / AS</label><strong>${d.isp || '—'} · ${d.org || '—'} · ${d.as || '—'}</strong></div>
      <div class="result-item"><label>VPN / Proxy</label><strong><span class="vpn-badge ${d.isVpnOrProxy ? 'vpn-yes' : 'vpn-no'}">${d.isVpnOrProxy ? 'Detectado' : 'No detectado'}</span></strong></div>
      <div class="result-item"><label>Hosting / Móvil</label><strong>${d.hosting ? 'Hosting' : 'No'} · ${d.mobile ? 'Móvil' : 'No'}</strong></div>
      <div class="result-item"><label>Coords / Mapa</label><strong>${d.lat}, ${d.lon} · <a href="${d.osmUrl || '#'}" target="_blank" rel="noopener">OSM</a></strong></div>
      <div class="result-item"><label>API</label><strong class="muted">POST /api/tools/ip-lookup → ip-api.com</strong></div>`;
    refreshAudit(); toast('IP analizada');
  } catch (e) { toolErr('ip-error', e.message); }
}

async function toolPortScan() {
  toolOk('port-error');
  try {
    const d = await api('/api/tools/port-scan', {
      method: 'POST',
      body: { host: ($('#port-target') || {}).value?.trim(), ports: ($('#port-range') || {}).value?.trim() },
    });
    const g = $('#port-grid');
    if (g) g.innerHTML = (d.results || []).map(r => `
      <div class="port-item ${r.open ? 'open' : 'closed'}">
        <div style="font-family:var(--mono);font-size:1.05rem;font-weight:700">${r.port}</div>
        <div style="font-size:.75rem">${r.open ? 'ABIERTO' : 'cerrado'}</div>
        <div style="font-size:.7rem;color:var(--text-dim)">${r.service || ''}${r.critical ? ' ⚠️' : ''}</div>
      </div>`).join('');
    toast('Escaneo en ' + d.host); refreshAudit(); refreshDashboard();
  } catch (e) { toolErr('port-error', e.message); }
}

function parseTraceRows(raw) {
  const rows = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!m) continue;
    const hop = m[1], rest = m[2].trim();
    if (/^\*\s+\*\s+\*/.test(rest) || rest === '* * *') {
      rows.push({ hop, host: '*', rtts: ['*', '*', '*'] }); continue;
    }
    const rtts = [...rest.matchAll(/(\d+[.,]?\d*)\s*ms/gi)].map(x => x[1].replace(',', '.'));
    const host = rest.replace(/\d+[.,]?\d*\s*ms/gi, '').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').replace(/\*/g, '').trim() || '*';
    while (rtts.length < 3) rtts.push('—');
    rows.push({ hop, host, rtts: rtts.slice(0, 3) });
  }
  return rows;
}
function renderTrace(d) {
  const out = $('#trace-output');
  const wrap = $('#trace-table-wrap');
  const body = $('#trace-body');
  const rows = d.hops || parseTraceRows(d.raw);
  if (wrap && body && rows.length) {
    wrap.classList.remove('hidden');
    body.innerHTML = rows.map(r => `<tr><td>${r.hop}</td><td style="font-family:var(--mono)">${r.host}</td><td>${r.rtts[0]}</td><td>${r.rtts[1]}</td><td>${r.rtts[2]}</td></tr>`).join('');
  } else if (wrap) wrap.classList.add('hidden');
  if (out) out.textContent = (d.tool ? '[' + d.tool + ']\n' : '') + (d.raw || '');
}

async function runTrace(mode) {
  const errEl = $('#trace-error'); if (errEl) errEl.classList.add('hidden');
  const out = $('#trace-output');
  if (out) out.textContent = mode === 'packet' ? 'Ejecutando tracepacket…' : 'Ejecutando traceroute…';
  try {
    const path = mode === 'packet' ? '/api/tools/tracepacket' : '/api/tools/traceroute';
    const d = await api(path, { method: 'POST', body: { target: ($('#trace-target') || {}).value?.trim() } });
    renderTrace(d);
    toast(mode === 'packet' ? 'Tracepacket listo' : 'Traceroute listo');
    refreshAudit();
  } catch (e) {
    if (out) out.textContent = '';
    toolErr('trace-error', e.message);
  }
}

async function toolDns() {
  toolOk('dns-error');
  try {
    const d = await api('/api/tools/dns-lookup', {
      method: 'POST', body: { domain: ($('#dns-domain') || {}).value?.trim(), type: ($('#dns-type') || {}).value },
    });
    const box = $('#dns-results');
    if (box) box.innerHTML = `<p class="muted" style="margin:.75rem 0">${d.note || ('Registros ' + d.type + ' para ' + d.domain + ':')}</p>` +
      (d.records || []).map(r => `<div class="result-item" style="margin-bottom:.4rem"><strong style="font-family:var(--mono)">${r}</strong></div>`).join('');
    toast('DNS OK'); refreshAudit();
  } catch (e) { toolErr('dns-error', e.message); }
}

async function toolCidr() {
  try {
    const d = await api('/api/tools/subnet-calc', { method: 'POST', body: { cidr: ($('#cidr-input') || {}).value?.trim() } });
    const box = $('#cidr-results'); if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = Object.entries({
      'Red': d.network, 'Máscara': d.mask, 'Broadcast': d.broadcast, 'Primer host': d.firstHost,
      'Último host': d.lastHost, 'Hosts útiles': d.usableHosts, 'CIDR': d.cidr, 'Wildcard': d.wildcard,
    }).map(([k, v]) => `<div class="cidr-item"><label>${k}</label><strong>${v}</strong></div>`).join('');
    toast('Subred calculada'); refreshAudit();
  } catch (e) { toast(e.message, true); }
}

async function toolArp() {
  try {
    const d = await api('/api/tools/arp-table');
    const box = $('#arp-results');
    if (box) box.innerHTML = (d.entries || []).length ? d.entries.map(e => `
      <div class="port-item open"><div style="font-size:.8rem">${e.ip}</div><div style="font-family:var(--mono);font-size:.75rem">${e.mac}</div></div>`).join('') : '<p class="muted">Sin entradas ARP (normal en hosting cloud)</p>';
    toast('ARP leída'); refreshAudit();
  } catch (e) { toast(e.message, true); }
}

async function toolSpeed() {
  const btn = $('#speed-test-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Midiendo…'; }
  try {
    const sizeMb = 2;
    const t0 = performance.now();
    const resp = await fetch(`/api/tools/speedtest/download?mb=${sizeMb}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!resp.ok) throw new Error('Download falló');
    await resp.arrayBuffer();
    const dlMs = performance.now() - t0;
    const dlMbps = (sizeMb * 8 * 1000) / dlMs;
    const buf = new Uint8Array(sizeMb * 1024 * 1024);
    const t1 = performance.now();
    await fetch('/api/tools/speedtest/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${TOKEN}` }, body: buf,
    });
    const upMs = performance.now() - t1;
    const upMbps = (sizeMb * 8 * 1000) / upMs;
    await api('/api/tools/speedtest/log', { method: 'POST', body: { downloadMbps: dlMbps, uploadMbps: upMbps } }).catch(() => {});
    const unit = ($('#speed-unit') || {}).value || 'Mbps';
    const conv = v => unit === 'MB/s' ? (v / 8).toFixed(2) + ' MB/s' : unit === 'Gbps' ? (v / 1000).toFixed(3) + ' Gbps' : unit === 'kbps' ? (v * 1000).toFixed(0) + ' kbps' : unit === 'KB/s' ? (v * 125).toFixed(0) + ' KB/s' : v.toFixed(2) + ' Mbps';
    toast('↓ ' + conv(dlMbps) + ' · ↑ ' + conv(upMbps));
    refreshAudit();
  } catch (e) { toast(e.message, true); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Ejecutar Prueba de Velocidad Real'; } }
}

async function toolPingMatrix() {
  const host = prompt('Host o IP a medir (ping TCP :80/:443):', '1.1.1.1');
  if (!host) return;
  try {
    const d = await api('/api/tools/ping-matrix', { method: 'POST', body: { host, samples: 5 } });
    const box = $('#innov-results');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = `<h4>Ping matrix TCP · ${d.host}</h4>
        <div class="result-item"><label>Muestras</label><strong>${d.samples}</strong></div>
        <div class="result-item"><label>RTT min/avg/max</label><strong>${d.min} / ${d.avg} / ${d.max} ms</strong></div>
        <div class="result-item"><label>Pérdida</label><strong>${d.loss}%</strong></div>
        <div class="result-item"><label>Puertos</label><strong>${(d.ports || []).join(', ')}</strong></div>
        <div class="result-item"><label>API</label><strong class="muted">POST /api/tools/ping-matrix</strong></div>`;
    }
    toast('Ping matrix OK');
  } catch (e) { toast(e.message, true); }
}

async function toolPathMtu() {
  const host = prompt('Host para estimar path (TCP connect timings):', 'cloudflare.com');
  if (!host) return;
  try {
    const d = await api('/api/tools/path-probe', { method: 'POST', body: { host } });
    const box = $('#innov-results');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = `<h4>Path probe · ${d.host}</h4>
        ${(d.probes || []).map(p => `<div class="result-item"><label>${p.port}/${p.proto}</label><strong>${p.ok ? p.ms + ' ms' : 'fail'} · ${p.note || ''}</strong></div>`).join('')}
        <div class="result-item"><label>Sugerencia</label><strong>${d.hint || '—'}</strong></div>
        <div class="result-item"><label>API</label><strong class="muted">POST /api/tools/path-probe</strong></div>`;
    }
    toast('Path probe listo');
  } catch (e) { toast(e.message, true); }
}

async function toolTls() {
  const host = prompt('Host TLS (sin https://):', 'google.com');
  if (!host) return;
  try {
    const d = await api('/api/tools/tls-info', { method: 'POST', body: { host } });
    const box = $('#innov-results');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = `<h4>TLS · ${d.host}</h4>
        <div class="result-item"><label>Subject</label><strong>${d.subject || '—'}</strong></div>
        <div class="result-item"><label>Issuer</label><strong>${d.issuer || '—'}</strong></div>
        <div class="result-item"><label>Válido hasta</label><strong>${d.validTo || '—'}</strong></div>
        <div class="result-item"><label>Protocolo / Cipher</label><strong>${d.protocol || '—'} · ${d.cipher || '—'}</strong></div>
        <div class="result-item"><label>Días restantes</label><strong>${d.daysLeft != null ? d.daysLeft : '—'}</strong></div>
        <div class="result-item"><label>API</label><strong class="muted">POST /api/tools/tls-info (tls.connect Node)</strong></div>`;
    }
    toast('TLS OK');
  } catch (e) { toast(e.message, true); }
}

async function toolHttpHeaders() {
  const url = prompt('URL a inspeccionar:', 'https://example.com');
  if (!url) return;
  try {
    const d = await api('/api/tools/http-headers', { method: 'POST', body: { url } });
    const box = $('#innov-results');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = `<h4>HTTP · ${d.status} · ${d.url}</h4>
        <div class="result-item"><label>Tiempo</label><strong>${d.ms} ms</strong></div>
        ${Object.entries(d.headers || {}).map(([k,v]) => `<div class="result-item"><label>${k}</label><strong style="font-family:var(--mono);font-size:.75rem">${v}</strong></div>`).join('')}
        <div class="result-item"><label>API</label><strong class="muted">POST /api/tools/http-headers</strong></div>`;
    }
    toast('Headers OK');
  } catch (e) { toast(e.message, true); }
}

async function toolAsn() {
  const ip = prompt('IP para ASN/geo rápida:', '8.8.8.8');
  if (!ip) return;
  try {
    const d = await api('/api/tools/asn-lookup', { method: 'POST', body: { ip } });
    const box = $('#innov-results');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = `<h4>ASN · ${d.ip}</h4>
        <div class="result-item"><label>AS</label><strong>${d.as || '—'}</strong></div>
        <div class="result-item"><label>Org</label><strong>${d.org || '—'}</strong></div>
        <div class="result-item"><label>ISP</label><strong>${d.isp || '—'}</strong></div>
        <div class="result-item"><label>Ruta</label><strong>${d.country || '—'} · ${d.city || '—'}</strong></div>
        <div class="result-item"><label>API</label><strong class="muted">POST /api/tools/asn-lookup → ip-api.com</strong></div>`;
    }
    toast('ASN OK');
  } catch (e) { toast(e.message, true); }
}

async function toolDnsProp() {
  const domain = prompt('Dominio para propagación DNS multi-resolver:', 'example.com');
  if (!domain) return;
  try {
    const d = await api('/api/tools/dns-propagation', { method: 'POST', body: { domain } });
    const box = $('#innov-results');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = `<h4>DNS propagation · ${d.domain}</h4>` +
        (d.resolvers || []).map(r => `<div class="result-item"><label>${r.server}</label><strong style="font-family:var(--mono);font-size:.75rem">${(r.records || []).join(', ') || r.error || '—'}</strong></div>`).join('') +
        `<div class="result-item"><label>API</label><strong class="muted">POST /api/tools/dns-propagation</strong></div>`;
    }
    toast('Propagación consultada');
  } catch (e) { toast(e.message, true); }
}

async function toolTraceCompare() {
  const target = ($('#trace-target') || {}).value?.trim() || prompt('Destino para comparar traceroute vs tracepacket:', '1.1.1.1');
  if (!target) return;
  const box = $('#innov-results');
  if (box) { box.classList.remove('hidden'); box.innerHTML = '<p class="muted">Comparando traceroute y tracepacket…</p>'; }
  try {
    const [a, b] = await Promise.all([
      api('/api/tools/traceroute', { method: 'POST', body: { target } }),
      api('/api/tools/tracepacket', { method: 'POST', body: { target } }),
    ]);
    const ha = a.hops || parseTraceRows(a.raw);
    const hb = b.hops || parseTraceRows(b.raw);
    if (box) box.innerHTML = `<h4>Compare · ${target}</h4>
      <div class="result-item"><label>Traceroute hops</label><strong>${ha.length} · tool ${a.tool || '—'}</strong></div>
      <div class="result-item"><label>Tracepacket hops</label><strong>${hb.length} · tool ${b.tool || '—'}</strong></div>
      <div class="result-item"><label>Último hop TR</label><strong>${ha.length ? ha[ha.length-1].host : '—'}</strong></div>
      <div class="result-item"><label>Último hop TP</label><strong>${hb.length ? hb[hb.length-1].host : '—'}</strong></div>
      <div class="result-item"><label>API</label><strong class="muted">POST /api/tools/traceroute + /tracepacket en paralelo</strong></div>`;
    toast('Comparación lista');
  } catch (e) { toast(e.message, true); }
}

document.addEventListener('click', e => {
  const id = e.target && e.target.id;
  if (!id) return;
  const map = {
    'ip-lookup-btn': toolIpLookup,
    'port-scan-btn': toolPortScan,
    'trace-btn': () => runTrace('route'),
    'tracepacket-btn': () => runTrace('packet'),
    'dns-lookup-btn': toolDns,
    'cidr-calc-btn': toolCidr,
    'arp-btn': toolArp,
    'speed-test-btn': toolSpeed,
    'innov-ping-btn': toolPingMatrix,
    'innov-path-btn': toolPathMtu,
    'innov-tls-btn': toolTls,
    'innov-http-btn': toolHttpHeaders,
    'innov-asn-btn': toolAsn,
    'innov-dnsprop-btn': toolDnsProp,
    'innov-compare-btn': toolTraceCompare,
  };
  if (map[id]) { e.preventDefault(); map[id](); }
});

// ---------- Auditoría ----------
let _AUDIT = [];
async function refreshAudit() {
  const { entries } = await api('/api/audit');
  _AUDIT = entries || [];
  renderAudit();
}
function renderAudit() {
  const type = ($('#audit-filter-type')?.value || '').toLowerCase();
  const from = $('#audit-filter-from')?.value;
  const to = $('#audit-filter-to')?.value;
  let list = _AUDIT.slice();
  if (type) list = list.filter(e => (e.action || '').toLowerCase().includes(type) || (e.detail || '').toLowerCase().includes(type));
  if (from) list = list.filter(e => e.ts >= from);
  if (to) list = list.filter(e => e.ts.slice(0, 10) <= to);
  const body = $('#audit-body');
  if (!body) return;
  body.innerHTML = list.length ? list.map(e => `
    <tr><td>${new Date(e.ts).toLocaleString()}</td><td>${e.user}</td><td>${e.action}</td><td>${e.detail}</td></tr>
  `).join('') : '<tr><td colspan="4" class="muted">Sin resultados para este filtro</td></tr>';
}
// Filtrado automático: apenas se elige acción o fecha
document.addEventListener('change', e => { if (['audit-filter-type', 'audit-filter-from', 'audit-filter-to'].includes(e.target?.id)) renderAudit(); });
document.addEventListener('input', e => { if (['audit-filter-from', 'audit-filter-to'].includes(e.target?.id)) renderAudit(); });


// ---------- Cuenta ----------
$('#save-profile-btn').addEventListener('click', async () => {
  try {
    const d = await api('/api/auth/profile', { method: 'PUT', body: { name: $('#acc-name').value, company: $('#acc-company').value } });
    ME = d.user; $('#user-name').textContent = ME.name;
    toast('Perfil actualizado en la base de datos');
  } catch (e) { toast(e.message, true); }
});
$('#regen-key-btn').addEventListener('click', async () => {
  try {
    const d = await api('/api/auth/regenerate-key', { method: 'POST' });
    $('#api-key').textContent = d.apiKey;
    toast('Nueva clave generada');
  } catch (e) { toast(e.message, true); }
});

// ---------- Init ----------
if (TOKEN) {
  enterApp().catch((e) => {
    console.warn('Sesión inválida, mostrando login', e);
    localStorage.removeItem('iphub_token');
    TOKEN = null;
    try { $('#app')?.classList.add('hidden'); $('#auth-screen')?.classList.remove('hidden'); } catch (_) {}
  });
}

document.body.dataset.uii = 1;


// ---------- Olvidé mi contraseña ----------
(function () {
  const showForgot = () => {
    $$('.auth-form').forEach(f => f.classList.remove('active'));
    $$('.auth-tab').forEach(t => t.classList.remove('active'));
    $('#forgot-form')?.classList.add('active');
    $('#forgot-error')?.classList.add('hidden');
  };
  const showLogin = () => {
    $$('.auth-form').forEach(f => f.classList.remove('active'));
    $('#login-form')?.classList.add('active');
    $$('.auth-tab')[0]?.classList.add('active');
  };
  document.getElementById('forgot-link')?.addEventListener('click', e => {
    e.preventDefault(); showForgot();
  });
  document.getElementById('forgot-back')?.addEventListener('click', showLogin);

  let forgotStage = 0; // 0 email, 1 code+pass
  window.__resetForgot = () => { forgotStage = 0; };
  $('#forgot-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#forgot-error'); if (err) { err.classList.add('hidden'); err.textContent = ''; }
    const email = $('#forgot-email')?.value?.trim();
    try {
      if (forgotStage === 0) {
        const r = await fetch('/api/auth/forgot', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Error');
        forgotStage = 1;
        $('#forgot-code-g')?.classList.remove('hidden');
        $('#forgot-pass-g')?.classList.remove('hidden');
        $('#forgot-pass2-g')?.classList.remove('hidden');
        $('#forgot-info').textContent = d.emailSent
          ? 'Te enviamos un código de 6 dígitos a ' + email + '. Ingresalo junto con tu nueva contraseña.'
          : (d.message || 'Revisá la consola del servidor por el código (SMTP no configurado).');
        $('#forgot-submit-btn').textContent = 'Restablecer contraseña';
        $('#forgot-code')?.focus();
        toast(d.emailSent ? 'Código enviado' : 'Código en consola del servidor', !d.emailSent);
        return;
      }
      const code = $('#forgot-code')?.value?.trim();
      const password = $('#forgot-pass')?.value || '';
      const password2 = $('#forgot-pass2')?.value || '';
      if (password !== password2) throw new Error('Las contraseñas no coinciden');
      if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error');
      toast('Contraseña actualizada. Ya podés iniciar sesión.');
      forgotStage = 0;
      $('#forgot-code-g')?.classList.add('hidden');
      $('#forgot-pass-g')?.classList.add('hidden');
      $('#forgot-pass2-g')?.classList.add('hidden');
      $('#forgot-submit-btn').textContent = 'Enviar código';
      $('#forgot-email').value = email;
      $('#login-email').value = email;
      showLogin();
    } catch (ex) {
      if (err) { err.textContent = ex.message; err.classList.remove('hidden'); }
    }
  });
})();
