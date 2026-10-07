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

// Workspace (delegación de eventos — funciona aunque ME cargue después)
(function workspaceMod() {
  function grid() { return document.getElementById('ws-grid'); }
  function ensureWs() {
    if (!window.ME) window.ME = {};
    if (!ME.workspace || !Array.isArray(ME.workspace.widgets)) ME.workspace = { widgets: [] };
    return ME.workspace;
  }
  function load() {
    const g = grid(); if (!g) return;
    const layout = ensureWs().widgets;
    g.innerHTML = '';
    if (!layout.length) {
      g.innerHTML = '<p class="muted small">Todavía no hay widgets. Elegí uno arriba y pulsá Agregar.</p>';
      return;
    }
    layout.forEach((w, i) => addCard(w, i));
  }
  function addCard(w, idx) {
    const g = grid(); if (!g) return;
    const el = document.createElement('div');
    el.className = 'ws-card' + (w.size === 'wide' ? ' wide' : '') + (w.size === 'tall' ? ' tall' : '');
    const title = { dashboard: 'Dashboard', topology: 'Topología', 'tools-ip': 'IP Lookup', audit: 'Auditoría', embed: 'Embed', notes: 'Notas' }[w.type] || w.type;
    let body = '';
    if (w.type === 'notes') body = '<textarea data-ws-note="' + idx + '">' + (w.text || '').replace(/</g, '&lt;') + '</textarea>';
    else if (w.type === 'embed') body = '<iframe src="' + String(w.url || 'about:blank').replace(/"/g, '') + '" sandbox="allow-scripts allow-same-origin"></iframe>';
    else body = '<p class="muted small">Widget “' + title + '”.</p><button class="btn btn-sm g" type="button" data-ws-go="' + w.type + '">Abrir sección</button>';
    el.innerHTML = '<h4>' + title + '<button class="ws-rm" type="button" data-ws-rm="' + idx + '" title="Quitar">x</button></h4>' + body;
    g.appendChild(el);
  }
  document.addEventListener('click', async e => {
    const addBtn = e.target.closest('#ws-add-btn');
    if (addBtn) {
      e.preventDefault();
      const sel = document.getElementById('ws-add-widget');
      const type = sel && sel.value;
      if (!type) { if (typeof toast === 'function') toast('Elegí un tipo de widget', true); return; }
      const ws = ensureWs();
      const w = { type, size: 'normal' };
      if (type === 'embed') w.url = prompt('URL del embed (https://…)') || '';
      if (type === 'notes') w.text = '';
      ws.widgets.push(w);
      if (sel) sel.value = '';
      load();
      return;
    }
    const saveBtn = e.target.closest('#ws-save-btn');
    if (saveBtn) {
      e.preventDefault();
      try {
        await api('/api/workspace', { method: 'PUT', body: { layout: ensureWs() } });
        if (typeof toast === 'function') toast('Workspace guardado');
      } catch (err) { if (typeof toast === 'function') toast(err.message, true); }
      return;
    }
    const rm = e.target.closest('[data-ws-rm]');
    if (rm) {
      const i = Number(rm.getAttribute('data-ws-rm'));
      ensureWs().widgets.splice(i, 1);
      load();
      return;
    }
    const go = e.target.closest('[data-ws-go]');
    if (go) {
      const map = { dashboard: 'dashboard', topology: 'topology', 'tools-ip': 'tools', audit: 'audit' };
      if (typeof showSection === 'function') showSection(map[go.getAttribute('data-ws-go')] || 'dashboard');
    }
  });
  document.addEventListener('change', e => {
    const ta = e.target.closest('[data-ws-note]');
    if (!ta) return;
    const i = Number(ta.getAttribute('data-ws-note'));
    if (ensureWs().widgets[i]) ensureWs().widgets[i].text = ta.value;
  });
  const orig = window.showSection;
  if (orig && !window.__wsWrapped) {
    window.__wsWrapped = true;
    window.showSection = function (id) { orig(id); if (id === 'workspace') load(); };
  }
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
