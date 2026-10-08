/** Módulos de la cuenta oficial: entorno virtual, seguimiento de claves API, simulacro de phishing, commits y foro. */
module.exports = function (app, ctx) {
  const { db, requireAuth, addAudit, sendMail, crypto } = ctx;
  const OWNER = String(process.env.OWNER_EMAIL || 'iphuboficial@gmail.com').toLowerCase();
  const isOwner = u => !!u && (String(u.email || '').toLowerCase() === OWNER || u.isOwner === true);
  const gate = (req, res, next) => isOwner(req.user) ? next() : res.status(403).json({ error: 'Módulo disponible solo para la cuenta oficial.' });
  const col = (k, d) => db.get(k).value() || d;
  const put = (k, v) => db.set(k, v).write();
  const id = () => crypto.randomBytes(6).toString('hex');
  const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 1) Entorno virtual de red (mapa IP editable; trazas y estrés 100% simulados) ----------
  const DEF = { nodes: [{ id: 'gw', name: 'Gateway', ip: '10.0.0.1', type: 'router', lat: 2 }, { id: 'sw', name: 'Switch', ip: '10.0.0.2', type: 'switch', lat: 1 }, { id: 'srv', name: 'Servidor', ip: '10.0.1.10', type: 'server', lat: 3 }, { id: 'pc', name: 'PC-01', ip: '10.0.1.21', type: 'pc', lat: 1 }], links: [['gw', 'sw'], ['sw', 'srv'], ['sw', 'pc']] };
  const okIp = v => /^(\d{1,3})(\.\d{1,3}){3}$/.test(v) && v.split('.').every(n => +n <= 255);
  function cleanSb(b) {
    b = b && typeof b === 'object' ? b : DEF; const seen = new Set();
    const nodes = (Array.isArray(b.nodes) ? b.nodes : []).slice(0, 60).map(n => ({ id: clip(n.id || id(), 24), name: clip(n.name, 40) || 'Nodo', ip: okIp(String(n.ip)) ? String(n.ip) : '0.0.0.0', type: clip(n.type, 12) || 'pc', lat: Math.max(0, Math.min(500, +n.lat || 1)) })).filter(n => !seen.has(n.id) && seen.add(n.id));
    const links = (Array.isArray(b.links) ? b.links : []).slice(0, 150).filter(l => Array.isArray(l) && seen.has(l[0]) && seen.has(l[1]) && l[0] !== l[1]).map(l => [l[0], l[1]]);
    return { nodes, links };
  }
  app.get('/api/mods/sandbox', requireAuth, gate, (req, res) => res.json(cleanSb((col('sandbox', {}))[req.user.id])));
  app.put('/api/mods/sandbox', requireAuth, gate, (req, res) => { const all = col('sandbox', {}); all[req.user.id] = cleanSb(req.body); put('sandbox', all); res.json(all[req.user.id]); });
  app.post('/api/mods/sandbox/trace', requireAuth, gate, (req, res) => { // BFS sobre el grafo virtual; no genera tráfico real
    const g = cleanSb((col('sandbox', {}))[req.user.id]), by = k => g.nodes.find(n => n.id === k || n.ip === k);
    const a = by(String(req.body.from)), b = by(String(req.body.to)); if (!a || !b) return res.status(400).json({ error: 'Origen o destino inexistente' });
    const adj = {}; g.links.forEach(([x, y]) => { (adj[x] = adj[x] || []).push(y); (adj[y] = adj[y] || []).push(x); });
    const prev = { [a.id]: null }, q = [a.id]; while (q.length) { const c = q.shift(); if (c === b.id) break; for (const n of adj[c] || []) if (!(n in prev)) { prev[n] = c; q.push(n); } }
    if (!(b.id in prev)) return res.json({ reachable: false, hops: [] });
    const path = []; for (let c = b.id; c; c = prev[c]) path.unshift(c); let acc = 0;
    res.json({ reachable: true, hops: path.map((k, i) => { const n = by(k); acc += n.lat; return { hop: i + 1, name: n.name, ip: n.ip, rtt: +(acc + Math.random() * .6).toFixed(2) }; }) });
  });
  app.post('/api/mods/sandbox/stress', requireAuth, gate, (req, res) => { // modelo de colas simulado, con topes duros
    const pps = Math.max(1, Math.min(100000, +req.body.pps || 1000)), secs = Math.max(1, Math.min(60, +req.body.secs || 10));
    const g = cleanSb((col('sandbox', {}))[req.user.id]), cap = n => ({ router: 50000, switch: 80000, server: 20000, pc: 5000 }[n.type] || 10000);
    const rows = g.nodes.map(n => { const load = pps / cap(n), lost = load > 1 ? 1 - 1 / load : 0; return { name: n.name, ip: n.ip, capacity: cap(n), load: +(Math.min(load, 9.99) * 100).toFixed(1), lossPct: +(lost * 100).toFixed(1), status: load < .7 ? 'ok' : load < 1 ? 'alto' : 'saturado' }; });
    res.json({ pps, secs, simulated: true, rows });
  });

  // ---------- 2) Seguimiento de claves API ----------
  global.iphubApiUse = (user, req) => {
    const svc = (String(req.path).match(/^\/api\/([^/]+)/) || [])[1] || 'otro'; const all = col('apiUse', []);
    all.push({ u: user.email, svc, m: req.method, at: Date.now(), ip: clip(req.headers['x-forwarded-for'] || req.ip, 45) }); if (all.length > 3000) all.splice(0, all.length - 3000); put('apiUse', all);
  };
  app.get('/api/mods/apitrack', requireAuth, gate, (req, res) => {
    const use = col('apiUse', []), users = {}; for (const e of use) { const u = users[e.u] = users[e.u] || { email: e.u, total: 0, last: 0, services: {}, ips: new Set() }; u.total++; u.last = Math.max(u.last, e.at); u.services[e.svc] = (u.services[e.svc] || 0) + 1; u.ips.add(e.ip); }
    const keys = (db.get('users').value() || []).filter(u => u.apiKey).map(u => ({ email: u.email, name: u.name, keyTail: '…' + String(u.apiKey).slice(-4) }));
    res.json({ keys, usage: Object.values(users).map(u => ({ ...u, ips: [...u.ips].slice(0, 8) })).sort((a, b) => b.last - a.last), recent: use.slice(-40).reverse() });
  });

  // ---------- 3) Simulacro de phishing (con consentimiento, transparente y educativo) ----------
  app.get('/api/mods/phish', requireAuth, gate, (req, res) => res.json({ campaigns: col('phish', []).map(c => ({ ...c, targets: c.targets.map(t => ({ email: t.email, opened: !!t.opened, clicked: !!t.clicked, reported: !!t.reported, sent: !!t.sent })) })) }));
  app.post('/api/mods/phish', requireAuth, gate, async (req, res) => {
    const b = req.body || {}; if (!b.consent) return res.status(400).json({ error: 'Tenés que confirmar que los participantes dieron su consentimiento.' });
    const emails = [...new Set(String(b.emails || '').split(/[\s,;]+/).map(e => e.toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)))].slice(0, 100); if (!emails.length) return res.status(400).json({ error: 'Cargá al menos un correo válido' });
    const c = { id: id(), name: clip(b.name, 60) || 'Simulacro', subject: clip(b.subject, 120) || 'Acción requerida en tu cuenta', pretext: clip(b.pretext, 600) || 'Detectamos actividad inusual. Revisá tu cuenta.', at: Date.now(), by: req.user.email, targets: emails.map(e => ({ email: e, token: crypto.randomBytes(10).toString('hex') })) };
    const base = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
    for (const t of c.targets) {
      const body = `${c.pretext}\n\n${base}/sim/c/${t.token}\n\n— Este es un SIMULACRO interno de concientización autorizado por tu organización. Si lo recibís como real, usá el botón de reportar de tu correo.`;
      try { await sendMail(t.email, c.subject, body, `<p>${esc(c.pretext)}</p><p><a href="${base}/sim/c/${t.token}">Revisar mi cuenta</a></p><img src="${base}/sim/o/${t.token}.gif" width="1" height="1" alt=""><hr><small>Simulacro interno de concientización autorizado por tu organización.</small>`); t.sent = true; } catch (_) { t.sent = false; }
    }
    put('phish', [c, ...col('phish', [])].slice(0, 50)); addAudit(req.user.email, 'Simulacro de phishing', `${c.name} · ${emails.length} participantes`); res.json({ ok: true, id: c.id });
  });
  const mark = (tok, f) => { const all = col('phish', []); for (const c of all) { const t = c.targets.find(x => x.token === tok); if (t) { t[f] = Date.now(); put('phish', all); return c; } } return null; };
  app.get('/sim/o/:t.gif', (req, res) => { mark(String(req.params.t), 'opened'); res.set('Content-Type', 'image/gif').end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')); });
  app.get('/sim/c/:t', (req, res) => { const c = mark(String(req.params.t), 'clicked'); res.send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Simulacro de phishing</title><body style="font:16px system-ui;background:#0a0f1e;color:#e6edf7;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:520px;padding:28px;border:1px solid #22d3ee55;border-radius:18px;background:linear-gradient(160deg,#14203a,#0a1020)"><h2 style="background:linear-gradient(135deg,#22d3ee,#818cf8);-webkit-background-clip:text;color:transparent">Esto era un simulacro</h2><p>${c ? 'Hiciste clic en un enlace de una campaña interna de concientización.' : 'Enlace de simulacro vencido.'} No se guardó ningún dato personal ni contraseña.</p><p><b>Cómo detectarlo:</b> revisá el remitente real, desconfiá de la urgencia, pasá el mouse sobre el enlace antes de hacer clic y, ante la duda, avisá al área de seguridad.</p></div>`); });
  app.post('/api/mods/phish/report/:t', (req, res) => { mark(String(req.params.t), 'reported'); res.json({ ok: true }); });

  // ---------- 4) Commits (GitHub) y foro empresarial ----------
  app.post('/api/mods/commit', requireAuth, gate, async (req, res) => { // el token se usa una vez y NO se guarda
    const b = req.body || {}, repo = clip(b.repo, 100), path = clip(b.path, 200).replace(/^\/+/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !path || /\.\./.test(path) || !b.token) return res.status(400).json({ error: 'Completá repo (usuario/repositorio), ruta y token' });
    const H = { Authorization: 'Bearer ' + b.token, Accept: 'application/vnd.github+json', 'User-Agent': 'IPHub', 'Content-Type': 'application/json' }, url = `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}`;
    try {
      let sha; const cur = await fetch(url + (b.branch ? '?ref=' + encodeURIComponent(b.branch) : ''), { headers: H }); if (cur.ok) sha = (await cur.json()).sha;
      const r = await fetch(url, { method: 'PUT', headers: H, body: JSON.stringify({ message: clip(b.message, 200) || 'IPHub: actualización de vista', content: Buffer.from(String(b.content || '')).toString('base64'), sha, branch: b.branch || undefined }) });
      const d = await r.json(); if (!r.ok) return res.status(r.status).json({ error: d.message || 'GitHub rechazó el commit' });
      addAudit(req.user.email, 'Commit a GitHub', `${repo}/${path}`); res.json({ ok: true, url: d.content && d.content.html_url, commit: d.commit && d.commit.sha });
    } catch (e) { res.status(502).json({ error: 'No se pudo contactar a GitHub: ' + e.message }); }
  });
  app.get('/api/mods/forum', requireAuth, gate, (req, res) => res.json({ threads: col('forum', []).slice(0, 100) }));
  app.post('/api/mods/forum', requireAuth, gate, (req, res) => { const b = req.body || {}, all = col('forum', []);
    if (b.reply) { const t = all.find(x => x.id === b.reply); if (!t) return res.status(404).json({ error: 'Hilo inexistente' }); t.posts.push({ by: req.user.name || req.user.email, at: Date.now(), text: clip(b.text, 2000) }); }
    else { if (!clip(b.title, 120)) return res.status(400).json({ error: 'Poné un título' }); all.unshift({ id: id(), title: clip(b.title, 120), posts: [{ by: req.user.name || req.user.email, at: Date.now(), text: clip(b.text, 2000) }] }); }
    put('forum', all.slice(0, 200)); res.json({ threads: all });
  });
  app.post('/api/mods/share', requireAuth, gate, (req, res) => { const all = col('shares', {}), k = id(); all[k] = { title: clip(req.body.title, 80) || 'Vista IPHub', html: clip(req.body.text, 50000), at: Date.now() }; put('shares', all); res.json({ url: `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}/vista/${k}` }); });
  app.get('/vista/:k', (req, res) => { const v = col('shares', {})[req.params.k]; if (!v) return res.status(404).send('Vista no encontrada'); res.send(`<!doctype html><meta charset=utf-8><title>${esc(v.title)}</title><body style="font:15px system-ui;background:#0a0f1e;color:#e6edf7;max-width:860px;margin:40px auto;padding:0 18px"><h1 style="background:linear-gradient(135deg,#22d3ee,#818cf8);-webkit-background-clip:text;color:transparent">${esc(v.title)}</h1><pre style="white-space:pre-wrap;line-height:1.55">${esc(v.html)}</pre>`); });
};
