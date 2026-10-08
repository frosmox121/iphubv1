// ---------- Partículas de fondo (estética) ----------
(function particles() {
  const cv = document.getElementById('particles'); if (!cv) return;
  const ctx = cv.getContext('2d'); let pts = [];
  function resize() {
    cv.width = innerWidth; cv.height = innerHeight;
    pts = Array.from({ length: Math.min(28, innerWidth / 40) }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35 }));
  }
  resize(); addEventListener('resize', resize);
  (function frame() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > cv.width) p.vx *= -1;
      if (p.y < 0 || p.y > cv.height) p.vy *= -1;
      ctx.fillStyle = 'rgba(34,211,238,0.5)'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, 7); ctx.fill();
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < 80) { ctx.strokeStyle = `rgba(129,140,248,${.14 * (1 - d / 120)})`; ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); }
    }
    requestAnimationFrame(frame);
  })();
})();

// ---------- Continuar con Google / Discord ----------
(function social() {
  // ----- Conectar el exe: el exe abre /?conectar=CODIGO[&p=google|discord] en el navegador -----
  const LQ = new URLSearchParams(location.search), LINK = (LQ.get('conectar') || '').replace(/[^a-f0-9]/gi, '').slice(0, 64), LP = LQ.get('p') || '';
  try { if (LINK) { sessionStorage.setItem('iphub_link', LINK); } } catch (_) {}
  window.__LINK_CODE = LINK || (function () { try { return sessionStorage.getItem('iphub_link') || ''; } catch (_) { return ''; } })();
  let banner = null;
  const bn = (txt, cls) => {
    if (!banner) { banner = document.createElement('div'); banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:.7rem 1rem;text-align:center;font:600 14px system-ui;color:#fff;background:#0891b2;box-shadow:0 2px 12px #0006'; document.body.appendChild(banner); }
    banner.textContent = txt; banner.style.background = cls === 'ok' ? '#16a34a' : cls === 'err' ? '#dc2626' : '#0891b2';
  };
  window.__linkOk = () => bn('✓ Listo: el exe ya está conectado a tu cuenta. Podés cerrar esta pestaña y volver a la app.', 'ok');
  window.__linkErr = m => bn('No se pudo conectar el exe: ' + m, 'err');
  if (window.__LINK_CODE) addEventListener('DOMContentLoaded', () => bn('Conectando tu exe de IPHub… ' + (LP === 'google' ? 'tocá «Google» para continuar.' : LP === 'discord' ? 'te llevamos a Discord…' : 'iniciá sesión o registrate y se conecta solo.')));
  // Vuelta de Discord en pantalla completa (sin popup): /auth/discord#access_token=...&state=CODIGO
  if (!window.opener && /access_token=/.test(location.hash) && /^\/auth\/discord/.test(location.pathname)) {
    const h = new URLSearchParams(location.hash.slice(1)), st = (h.get('state') || '').replace(/[^a-f0-9]/gi, '');
    history.replaceState({}, '', '/');
    addEventListener('DOMContentLoaded', async () => {
      try {
        bn('Validando Discord…');
        const r = await fetch('/api/auth/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: h.get('access_token') }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'No se pudo iniciar sesión con Discord');
        if (st) {
          const c = await fetch('/api/agent/link/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + d.token }, body: JSON.stringify({ code: st }) });
          const cj = await c.json().catch(() => ({})); if (!c.ok) throw new Error(cj.error || 'No se pudo conectar el exe');
          try { localStorage.setItem('iphub_token', d.token); } catch (_) {}
          window.__linkOk();
        } else { localStorage.setItem('iphub_token', d.token); location.replace('/'); }
      } catch (e) { bn(e.message || String(e), 'err'); }
    });
    return;
  }
  // Popup de Discord: devuelve el token a la ventana principal y se cierra
  if (window.opener && (/access_token=/.test(location.hash) || /error=/.test(location.search + location.hash))) {
    const h = new URLSearchParams(location.hash.slice(1)), q = new URLSearchParams(location.search);
    const msg = { iphubDiscord: h.get('access_token'), iphubDiscordError: h.get('error_description') || q.get('error_description') || h.get('error') || q.get('error') };
    try { window.opener.postMessage(msg, '*'); } catch (_) {}
    window.close();
    return;
  }
  let cfg = { googleClientId: '', discordClientId: '', discordRedirect: location.origin + '/auth/discord' };
  const gBtn = document.getElementById('google-btn'), dBtn = document.getElementById('discord-btn');
  if (!gBtn || !dBtn) return;
  let gReady = false;
  const oerr = e => { const el = document.getElementById('oauth-error'); if (el) { el.textContent = e.message || String(e); el.classList.remove('hidden'); } toast(e.message || String(e), true); };
  const oclr = () => document.getElementById('oauth-error')?.classList.add('hidden');

  async function finish(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'No se pudo iniciar sesión');
    TOKEN = d.token; localStorage.setItem('iphub_token', TOKEN);
    toast('Sesión iniciada'); await enterApp();
  }

  fetch('/api/auth/config').then(r => r.json()).then(c => {
    cfg = Object.assign(cfg, c);
    if (LINK && LP === 'discord' && !localStorage.getItem('iphub_token')) { // el exe pidió Discord: va directo a authorize
      location.replace(`https://discord.com/oauth2/authorize?client_id=${cfg.discordClientId}&response_type=token&redirect_uri=${encodeURIComponent(cfg.discordRedirect)}&scope=identify+email&state=${LINK}`);
      return;
    }
    if (LINK && LP === 'google') { gBtn.style.boxShadow = '0 0 0 3px #06b6d4'; gBtn.scrollIntoView({ block: 'center' }); }
    gBtn.disabled = !cfg.googleClientId; gBtn.style.opacity = cfg.googleClientId ? '1' : '.5';
    if (!cfg.googleClientId) { gBtn.title = 'Falta GOOGLE_CLIENT_ID en .env'; return; }
    // Se precarga el script para que el clic abra la ventana sin que el navegador la bloquee
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => { gReady = true; }; document.head.appendChild(s);
  }).catch(() => {});

  gBtn.addEventListener('click', () => {
    oclr();
    if (!cfg.googleClientId) return toast('Google no está configurado (GOOGLE_CLIENT_ID en .env)', true);
    if (!gReady || !window.google?.accounts?.oauth2) return toast('Cargando Google… probá de nuevo en un segundo (¿hay internet?)', true);
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: cfg.googleClientId, scope: 'openid email profile',
      callback: resp => {
        if (resp.error) return toast('Google: ' + (resp.error_description || resp.error), true);
        finish('/api/auth/google', { accessToken: resp.access_token }).catch(oerr);
      },
      error_callback: e => toast('Google: ' + (e.message || e.type || 'ventana cerrada o bloqueada'), true),
    });
    tc.requestAccessToken({ prompt: 'select_account' });
  });

  let dPop = null;
  dBtn.addEventListener('click', () => {
    oclr();
    const redirect = encodeURIComponent(cfg.discordRedirect);
    const url = `https://discord.com/oauth2/authorize?client_id=${cfg.discordClientId}&response_type=token&redirect_uri=${redirect}&scope=identify+email`;
    dPop = window.open(url, 'discord', 'width=500,height=720');
    if (!dPop) toast('El navegador bloqueó la ventana de Discord', true);
  });
  addEventListener('message', ev => {
    let okOrigin = false; try { okOrigin = ev.origin === new URL(cfg.discordRedirect).origin || ev.origin === location.origin; } catch (_) {}
    if (!okOrigin || !ev.data) return;
    if (ev.data.iphubDiscordError) return oerr(new Error('Discord: ' + ev.data.iphubDiscordError));
    if (ev.data.iphubDiscord) finish('/api/auth/discord', { accessToken: ev.data.iphubDiscord }).catch(oerr);
  });
})();

// ---------- IP de red en el Dashboard ----------
(function netIp() {
  const grid = document.getElementById('dashboard-grid'); if (!grid) return;
  async function load() {
    if (typeof TOKEN === 'undefined' || !TOKEN) return;
    const ip = document.getElementById('net-ip'), sub = document.getElementById('net-ip-sub'), oth = document.getElementById('net-ip-others');
    try {
      const d = await api('/api/network/info');
      if (!d.primary) { ip.textContent = '—'; sub.textContent = 'Sin conexión de red detectada'; oth.innerHTML = ''; return; }
      ip.textContent = d.primary.address;
      sub.textContent = `${d.primary.iface} · red ${d.primary.cidr} · máscara ${d.primary.netmask}`;
      oth.innerHTML = d.interfaces.slice(1).map(i => `<span class="net-chip" title="${i.iface} · ${i.cidr}">${i.address}</span>`).join('');
    } catch (_) { ip.textContent = '—'; sub.textContent = 'No se pudo leer la IP de red'; }
  }
  // refreshDashboard() reescribe la grilla cada vez que se entra: ahí actualizamos la IP
  new MutationObserver(load).observe(grid, { childList: true });
  load();
})();

// ---------- Laboratorio IDE (stubs seguros, modo lab) ----------
(function labIde() {
  function toastMsg(m) { if (typeof toast === 'function') toast(m); else console.log(m); }
  document.querySelectorAll('[data-labtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-labtab]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      const t = btn.getAttribute('data-labtab');
      const tree = document.getElementById('lab-tree');
      const agent = document.getElementById('agent-panel');
      if (tree) tree.style.display = t === 'tree' ? '' : 'none';
      if (agent) agent.style.display = t === 'agent' ? '' : 'none';
    });
  });
  const bind = (id, msg) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => {
      toastMsg(msg);
      const st = document.getElementById('lab-status');
      if (st) st.textContent = msg + ' · modo laboratorio (sin acción real sobre redes externas)';
    });
  };
  bind('lab-new-proj', 'Nuevo proyecto de red creado (virtual)');
  bind('lab-new-net', 'Red/subred agregada al laboratorio');
  bind('lab-new-host', 'Host virtual agregado');
  bind('lab-trace', 'Traza simulada entre nodos (lab)');
  bind('lab-stress', 'Prueba de estrés controlada (límites activos)');
  bind('lab-worm', 'Simulación de propagación hipotética (solo eventos virtuales, no malware)');
  bind('lab-export', 'Exportar topología (JSON del laboratorio)');
})();

// Workspace (widgets reales y funcionales)
(function workspaceMod() {
  const grid = () => document.getElementById('ws-grid');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => (typeof ME !== 'undefined' && ME) || null;
  const ws = () => { const m = me(); if (!m) return { widgets: [] }; if (!m.workspace || !Array.isArray(m.workspace.widgets)) m.workspace = { widgets: [] }; return m.workspace; };
  const T = { dashboard: 'Resumen de red', topology: 'Topología', 'tools-ip': 'Analizador de IP', audit: 'Últimas acciones', embed: 'Embed externo', notes: 'Notas', trace: 'Traceroute rápido', dns: 'DNS rápido', clock: 'Reloj y fecha', speed: 'Ping de latencia' };
  const SECTION = { dashboard: 'dashboard', topology: 'topology', 'tools-ip': 'tools', audit: 'audit' };
  const toastSafe = (t, err) => { try { toast(t, err); } catch (_) {} };
  let save_t = null;
  const autosave = () => { clearTimeout(save_t); save_t = setTimeout(save, 700); };
  async function save(manual) {
    try { await api('/api/workspace', { method: 'PUT', body: { layout: ws() } }); if (manual) toastSafe('Workspace guardado'); }
    catch (e) { toastSafe(e.message, true); }
  }
  const body = {
    dashboard: async el => { const d = await api('/api/dashboard/summary'); const rows = Object.entries(d).filter(([k, v]) => (typeof v === 'number' || v === null) && k !== 'hasData').slice(0, 8);
      el.innerHTML = rows.length ? `<div class="ws-kv">${rows.map(([k, v]) => `<div><small>${esc(k.replace(/([A-Z])/g, ' $1'))}</small><b>${v ?? '—'}</b></div>`).join('')}</div>` : '<p class="muted small">Sin datos todavía. Descubrí tu red desde Topología.</p>'; },
    topology: async el => { const d = await api('/api/dashboard/summary'); el.innerHTML = `<p class="muted small">Dispositivos y estado de la red local.</p><div class="ws-kv"><div><small>Puntaje</small><b>${d.score ?? '—'}</b></div><div><small>Latencia ms</small><b>${d.avgLatency ?? '—'}</b></div></div>`; },
    audit: async el => { const d = await api('/api/audit'); const l = (d.entries || []).slice(0, 6); el.innerHTML = l.length ? `<ul class="ws-list">${l.map(e => `<li>${esc(e.action)}<small>${esc(e.detail || e.details || '')}</small></li>`).join('')}</ul>` : '<p class="muted small">Sin actividad.</p>'; },
    'tools-ip': el => { el.innerHTML = '<div class="tool-form"><input class="ws-in" value="8.8.8.8"><button class="btn btn-sm btn-primary" type="button">Analizar</button></div><div class="ws-out muted small"></div>';
      const go = async () => { const o = el.querySelector('.ws-out'); o.textContent = 'Consultando…'; try { const d = await api('/api/tools/ip-lookup', { method: 'POST', body: { ip: el.querySelector('.ws-in').value.trim() } }); o.innerHTML = `<b>${esc(d.query)}</b> · ${esc(d.city)}, ${esc(d.country)}<br>${esc(d.isp)} · VPN/Proxy: ${d.isVpnOrProxy ? 'sí' : 'no'}`; } catch (e) { o.textContent = e.message; } };
      el.querySelector('button').onclick = go; },
    trace: el => { el.innerHTML = '<div class="tool-form"><input class="ws-in" value="8.8.8.8"><button class="btn btn-sm btn-primary" type="button">Trazar</button></div><pre class="ws-out raw-output" style="max-height:160px;overflow:auto"></pre>';
      el.querySelector('button').onclick = async () => { const o = el.querySelector('.ws-out'); o.textContent = 'Trazando ruta…'; try { const d = await api('/api/tools/traceroute', { method: 'POST', body: { target: el.querySelector('.ws-in').value.trim() } }); o.textContent = d.raw || ''; } catch (e) { o.textContent = e.message; } }; },
    dns: el => { el.innerHTML = '<div class="tool-form"><input class="ws-in" value="google.com"><button class="btn btn-sm btn-primary" type="button">Resolver</button></div><pre class="ws-out raw-output" style="max-height:160px;overflow:auto"></pre>';
      el.querySelector('button').onclick = async () => { const o = el.querySelector('.ws-out'); o.textContent = 'Consultando…'; try { const d = await api('/api/tools/dns-lookup', { method: 'POST', body: { domain: el.querySelector('.ws-in').value.trim(), host: el.querySelector('.ws-in').value.trim() } }); o.textContent = JSON.stringify(d.records || d, null, 1).slice(0, 1500); } catch (e) { o.textContent = e.message; } }; },
    clock: el => { const t = () => { const d = new Date(); el.innerHTML = `<div class="ws-clock">${d.toLocaleTimeString()}</div><small class="muted">${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</small>`; }; t(); const iv = setInterval(() => { if (!el.isConnected) return clearInterval(iv); t(); }, 1000); },
    speed: el => { el.innerHTML = '<button class="btn btn-sm btn-primary" type="button">Medir latencia</button><div class="ws-out muted small" style="margin-top:.4rem"></div>';
      el.querySelector('button').onclick = async () => { const o = el.querySelector('.ws-out'); const r = []; for (let i = 0; i < 5; i++) { const t0 = performance.now(); try { await fetch('/favicon.png?x=' + Date.now(), { cache: 'no-store' }); } catch (_) {} r.push(performance.now() - t0); } o.innerHTML = `Mín ${Math.min(...r).toFixed(0)} · Prom ${(r.reduce((a, b) => a + b, 0) / r.length).toFixed(0)} · Máx ${Math.max(...r).toFixed(0)} ms (hacia el servidor)`; }; },
    notes: (el, w, i) => { el.innerHTML = '<textarea></textarea>'; const t = el.querySelector('textarea'); t.value = w.text || ''; t.oninput = () => { ws().widgets[i].text = t.value; autosave(); }; },
    embed: (el, w) => { const u = String(w.url || ''); if (!/^https?:\/\//i.test(u)) { el.innerHTML = '<p class="muted small">URL inválida: usá https://…</p>'; return; } el.innerHTML = `<iframe src="${esc(u)}" sandbox="allow-scripts allow-same-origin allow-popups" referrerpolicy="no-referrer"></iframe><a class="muted small" href="${esc(u)}" target="_blank" rel="noopener">Abrir en pestaña nueva ↗</a>`; },
  };
  function load() {
    const g = grid(); if (!g || !me()) return;
    const list = ws().widgets; g.innerHTML = '';
    if (!list.length) { g.innerHTML = '<p class="muted small">Todavía no hay widgets. Elegí uno arriba y pulsá Agregar.</p>'; return; }
    list.forEach((w, i) => {
      const el = document.createElement('div');
      el.className = 'ws-card' + (w.size === 'wide' ? ' wide' : '') + (w.size === 'tall' ? ' tall' : '');
      el.innerHTML = `<h4><span>${esc(T[w.type] || w.type)}</span><span class="ws-ctl"><button class="ws-rm" type="button" data-act="up" title="Subir">↑</button><button class="ws-rm" type="button" data-act="size" title="Tamaño">⤢</button>${SECTION[w.type] ? '<button class="ws-rm" type="button" data-act="go" title="Abrir sección">↗</button>' : ''}<button class="ws-rm" type="button" data-act="rm" title="Quitar">✕</button></span></h4><div class="ws-body"><p class="muted small">Cargando…</p></div>`;
      if (w.w) el.style.width = w.w + 'px'; if (w.h) el.style.height = w.h + 'px'; if (w.min) el.classList.add('ws-min');
      const h4 = el.querySelector('h4');
      h4.title = 'Arrastrá para mover · doble clic para minimizar';
      h4.addEventListener('mousedown', ev => { if (!ev.target.closest('.ws-ctl')) el.draggable = true; });
      h4.addEventListener('dblclick', ev => { if (ev.target.closest('.ws-ctl')) return; w.min = !w.min; el.classList.toggle('ws-min', !!w.min); autosave(); });
      el.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', String(i)); ev.dataTransfer.effectAllowed = 'move'; el.classList.add('ws-drag'); });
      el.addEventListener('dragend', () => { el.draggable = false; el.classList.remove('ws-drag'); document.querySelectorAll('.ws-over').forEach(x => x.classList.remove('ws-over')); });
      el.addEventListener('dragover', ev => { ev.preventDefault(); el.classList.add('ws-over'); });
      el.addEventListener('dragleave', () => el.classList.remove('ws-over'));
      el.addEventListener('drop', ev => { ev.preventDefault(); const from = +ev.dataTransfer.getData('text/plain'); if (isNaN(from) || from === i) return; const l = ws().widgets; const [m] = l.splice(from, 1); l.splice(i, 0, m); autosave(); load(); });
      let r0 = null; el.addEventListener('mousedown', () => { const r = el.getBoundingClientRect(); r0 = [r.width, r.height]; });
      addEventListener('mouseup', () => { if (!r0 || !el.isConnected) return; const r = el.getBoundingClientRect(); if (Math.abs(r.width - r0[0]) > 3 || Math.abs(r.height - r0[1]) > 3) { w.w = Math.round(r.width); w.h = Math.round(r.height); autosave(); } r0 = null; });
      g.appendChild(el);
      const b = el.querySelector('.ws-body');
      Promise.resolve().then(() => (body[w.type] || (x => { x.innerHTML = '<p class="muted small">Widget desconocido.</p>'; }))(b, w, i)).catch(e => { b.innerHTML = '<p class="muted small">' + esc(e.message) + '</p>'; });
      el.querySelector('.ws-ctl').addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
        const l = ws().widgets;
        if (act === 'rm') l.splice(i, 1);
        else if (act === 'up' && i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]];
        else if (act === 'size') l[i].size = l[i].size === 'wide' ? 'normal' : l[i].size === 'normal' || !l[i].size ? 'tall' : 'wide';
        else if (act === 'go') { showSection(SECTION[w.type]); return; }
        autosave(); load();
      });
    });
  }
  document.getElementById('ws-add-btn')?.addEventListener('click', () => {
    const sel = document.getElementById('ws-add-widget'); const type = sel && sel.value;
    if (!type) return toastSafe('Elegí un widget de la lista', true);
    if (!me()) return;
    const w = { type, size: 'normal' };
    if (type === 'embed') { const u = prompt('URL del embed (https://…)'); if (!u || !/^https?:\/\//i.test(u.trim())) return toastSafe('URL inválida', true); w.url = u.trim(); }
    if (type === 'notes') w.text = '';
    ws().widgets.push(w); sel.value = ''; load(); autosave();
  });
  document.getElementById('ws-save-btn')?.addEventListener('click', () => save(true));
  const orig = window.showSection;
  if (orig) window.showSection = function (id) { orig(id); if (id === 'workspace') load(); };
  document.addEventListener('iphub-ready', load);
})();

// AI settings form
(function aiSettings() {
  function fill() {
    if (!window.ME) return;
    const p = document.getElementById('ai-provider');
    const m = document.getElementById('ai-model');
    const b = document.getElementById('ai-base');
    const lp = document.getElementById('ai-learn-prompt');
    if (p) p.value = ME.aiProvider || 'auto';
    if (m) m.value = ME.aiModel || '';
    if (b) b.value = ME.aiBaseUrl || '';
    if (lp) lp.value = ME.learnPrompt || '';
  }
  document.getElementById('ai-save-btn')?.addEventListener('click', async () => {
    try {
      const body = {
        aiProvider: document.getElementById('ai-provider')?.value,
        aiModel: document.getElementById('ai-model')?.value,
        aiBaseUrl: document.getElementById('ai-base')?.value,
        learnPrompt: document.getElementById('ai-learn-prompt')?.value
      };
      const k = document.getElementById('ai-key')?.value;
      if (k) body.aiApiKey = k;
      const d = await api('/api/ai/settings', { method: 'PUT', body });
      if (d.user) window.ME = Object.assign(window.ME || {}, d.user);
      if (typeof toast === 'function') toast('Configuración de IA guardada');
    } catch (e) { if (typeof toast === 'function') toast(e.message, true); }
  });
  const orig = window.showSection;
  if (orig) window.showSection = function (id) { orig(id); if (id === 'account') fill(); };
})();
