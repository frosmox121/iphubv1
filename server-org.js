/**
 * Empresa, roles, conexión del exe y enlaces para compartir.
 * Se registra desde server.js para no reescribir el backend existente.
 */
module.exports = function register(app, ctx) {
  const { db, bcrypt, jwt, crypto, requireAuth, addAudit, JWT_SECRET } = ctx;
  const OWNER_EMAIL = 'iphuboficial@gmail.com';
  const PERMS = ['dashboard', 'topology', 'tools', 'audit', 'learn', 'ranking', 'support'];

  function ensureOrg() {
    if (!db.get('org').value()) {
      db.set('org', {
        companyName: 'IPHub',
        roles: [
          { id: 'empleado', name: 'Empleado', desc: 'Ve el panel y la topología que envía el exe.', perms: ['dashboard', 'topology', 'support'] },
          { id: 'auditor', name: 'Auditor', desc: 'Revisa la red, la auditoría y las herramientas.', perms: ['dashboard', 'topology', 'tools', 'audit'] },
          { id: 'soporte', name: 'Soporte', desc: 'Atiende tickets y consulta la topología.', perms: ['dashboard', 'support', 'topology'] },
        ],
        members: [],
        shares: [],
      }).write();
    }
    if (!db.get('agentSnapshots').value()) db.set('agentSnapshots', {}).write();
    if (!db.get('agentLinks').value()) db.set('agentLinks', {}).write();
  }

  function isOwner(u) { return !!(u && String(u.email || '').toLowerCase() === OWNER_EMAIL); }

  function org() { ensureOrg(); return db.get('org').value(); }

  function roleOf(u) {
    if (!u) return null;
    if (isOwner(u)) return { id: 'owner', name: 'Dueño', perms: PERMS.concat(['empresa']) };
    const o = org();
    const m = (o.members || []).find(x => String(x.email).toLowerCase() === String(u.email).toLowerCase());
    if (!m) return null;
    return (o.roles || []).find(r => r.id === m.roleId) || null;
  }

  global.iphubPublicExtra = u => {
    const role = roleOf(u);
    const o = org();
    return {
      isOwner: isOwner(u),
      companyName: o.companyName || '',
      role: role ? { id: role.id, name: role.name, perms: role.perms || [] } : null,
    };
  };

  global.iphubEnsureOwner = async () => {
    ensureOrg();
    const passwordHash = await bcrypt.hash('lbaa1986', 10);
    let u = db.get('users').find({ email: OWNER_EMAIL }).value();
    if (!u) {
      u = {
        id: crypto.randomUUID(), name: 'Dueño IPHub', email: OWNER_EMAIL, company: 'IPHub',
        country: 'AR', lang: 'es', passwordHash, verified: true, provider: 'credentials', isOwner: true,
        apiKey: 'iphub_live_' + crypto.randomBytes(20).toString('hex'), createdAt: new Date().toISOString(),
      };
      db.get('users').push(u).write();
    } else {
      db.get('users').find({ id: u.id }).assign({ passwordHash, verified: true, isOwner: true, name: u.name || 'Dueño IPHub' }).write();
    }
  };

  function requireOwner(req, res, next) {
    if (!isOwner(req.user)) return res.status(403).json({ error: 'Solo el dueño de la empresa puede hacer esto' });
    next();
  }

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/') || /^\/api\/(auth|i18n|agent\/link)/.test(req.path)) return next();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next();
    let user;
    try { user = db.get('users').find({ id: jwt.verify(token, JWT_SECRET).sub }).value(); } catch (_) { return next(); }
    if (!user) return next();
    const need = (/^\/api\/devices/.test(req.path) && 'topology')
      || (/^\/api\/tools/.test(req.path) && 'tools')
      || (/^\/api\/audit/.test(req.path) && 'audit')
      || (/^\/api\/(quiz|progress)/.test(req.path) && 'learn')
      || (/^\/api\/leaderboard/.test(req.path) && 'ranking')
      || (/^\/api\/contact/.test(req.path) && 'support')
      || null;
    if (!need || isOwner(user)) return next();
    const role = roleOf(user);
    if (!role) return next();
    if (!(role.perms || []).includes(need)) return res.status(403).json({ error: 'Tu rol de empresa no permite esta acción' });
    next();
  });

  function cleanDevices(list) {
    return (Array.isArray(list) ? list : []).slice(0, 512).map(d => ({
      ip: String(d.ip || '').slice(0, 64),
      mac: String(d.mac || '').slice(0, 32),
      name: String(d.name || d.hostname || '').slice(0, 80),
      vendor: String(d.vendor || '').slice(0, 80),
      type: String(d.type || '').slice(0, 40),
      os: d.os && typeof d.os === 'object' ? { name: String(d.os.name || d.os.label || '').slice(0, 40) } : String(d.os || '').slice(0, 40),
      online: !!d.online,
      trusted: !!d.trusted,
      rtt: typeof d.rtt === 'number' ? d.rtt : (typeof d.lastRttMs === 'number' ? d.lastRttMs : null),
      ports: Array.isArray(d.ports) ? d.ports.slice(0, 24).map(p => ({ port: p.port, service: String(p.service || '').slice(0, 24) })) : [],
      note: String(d.note || '').slice(0, 180),
      lastSeen: d.lastSeen || null,
    }));
  }

  function saveSnap(user, body, source) {
    const devices = cleanDevices(body.devices);
    const snap = {
      userId: user.id,
      email: user.email,
      updatedAt: new Date().toISOString(),
      source,
      host: String(body.host || body.hostname || '').slice(0, 80),
      gateway: String(body.gateway || '').slice(0, 64),
      iface: String(body.iface || body.net || '').slice(0, 80),
      score: Number(body.score) || 0,
      level: String(body.level || '').slice(0, 12),
      online: Number(body.online) || devices.filter(d => d.online).length,
      offline: Number(body.offline) || devices.filter(d => !d.online).length,
      risky: Number(body.risky) || 0,
      devices,
      traces: Array.isArray(body.traces) ? body.traces.slice(0, 40) : [],
      routes: [{ dest: "0.0.0.0/0", via: String(body.gateway || ""), proto: "default" }, { dest: String(body.iface || "lan"), via: "connected", proto: "local" }],
    };
    const all = db.get('agentSnapshots').value() || {};
    all[user.id] = snap;
    db.set('agentSnapshots', all).write();
    return snap;
  }

  app.post('/api/agent/link/start', (req, res) => {
    ensureOrg();
    const code = crypto.randomBytes(4).toString('hex');
    const links = db.get('agentLinks').value() || {};
    links[code] = { code, at: Date.now(), exp: Date.now() + 10 * 60 * 1000, token: null };
    db.set('agentLinks', links).write();
    const host = req.get('host');
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    res.json({ code, url: `${proto}://${host}/conectar-agente?code=${code}` });
  });

  app.get('/api/agent/link/status', (req, res) => {
    const code = String(req.query.code || '');
    const row = (db.get('agentLinks').value() || {})[code];
    if (!row || row.exp < Date.now()) return res.status(404).json({ error: 'Código vencido. Generá otro desde el exe.' });
    if (!row.token) return res.json({ pending: true });
    res.json({ token: row.token, user: row.user });
  });

  app.post('/api/agent/link/confirm', requireAuth, (req, res) => {
    const code = String((req.body || {}).code || '');
    const links = db.get('agentLinks').value() || {};
    const row = links[code];
    if (!row || row.exp < Date.now()) return res.status(404).json({ error: 'Código vencido' });
    const token = jwt.sign({ sub: req.user.id, agent: true }, JWT_SECRET, { expiresIn: '30d' });
    const extra = global.iphubPublicExtra(req.user);
    row.token = token;
    row.user = { name: req.user.name, email: req.user.email, isOwner: extra.isOwner, role: extra.role };
    links[code] = row;
    db.set('agentLinks', links).write();
    addAudit(req.user.email, 'Exe conectado', 'Confirmó la sesión desde el navegador');
    res.json({ ok: true });
  });

  app.post('/api/agent/snapshot', requireAuth, (req, res) => {
    const role = roleOf(req.user);
    if (role && role.id !== 'owner' && !(role.perms || []).includes('topology')) {
      return res.status(403).json({ error: 'Tu rol no puede publicar la red' });
    }
    const snap = saveSnap(req.user, req.body || {}, 'exe');
    res.json({ ok: true, updatedAt: snap.updatedAt, devices: snap.devices.length });
  });

  app.get('/api/agent/snapshot', requireAuth, (req, res) => {
    const role = roleOf(req.user);
    if (role && role.id !== 'owner' && !(role.perms || []).includes('topology')) {
      return res.status(403).json({ error: 'Tu rol no incluye topología' });
    }
    const snap = (db.get('agentSnapshots').value() || {})[req.user.id] || null;
    res.json({ snapshot: snap });
  });

  app.post('/api/agent/import', requireAuth, (req, res) => {
    const body = req.body || {};
    const src = body.summary && typeof body.summary === 'object' ? { ...body.summary, host: body.host || body.summary.host } : body;
    if (!Array.isArray(src.devices)) return res.status(400).json({ error: 'El archivo no es un export de IPHub' });
    const snap = saveSnap(req.user, src, 'archivo');
    addAudit(req.user.email, 'Red importada', `${snap.devices.length} dispositivos desde archivo`);
    res.json({ ok: true, snapshot: snap });
  });

  function stats() {
    const o = org();
    const roles = (o.roles || []).map(r => ({
      id: r.id, name: r.name, desc: r.desc, perms: r.perms || [],
      members: (o.members || []).filter(m => m.roleId === r.id).length,
    }));
    return {
      companyName: o.companyName,
      roles,
      members: o.members || [],
      shares: (o.shares || []).map(s => ({ ...s })),
      totals: {
        roles: roles.length,
        members: (o.members || []).length,
        withAgent: Object.keys(db.get('agentSnapshots').value() || {}).length,
      },
    };
  }

  app.get('/api/org', requireAuth, requireOwner, (req, res) => res.json(stats()));

  app.put('/api/org', requireAuth, requireOwner, (req, res) => {
    const name = String((req.body || {}).companyName || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Nombre de empresa obligatorio' });
    const o = org(); o.companyName = name; db.set('org', o).write();
    addAudit(req.user.email, 'Empresa actualizada', name);
    res.json(stats());
  });

  app.post('/api/org/roles', requireAuth, requireOwner, (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 40);
    const perms = (Array.isArray(b.perms) ? b.perms : []).filter(p => PERMS.includes(p));
    if (!name) return res.status(400).json({ error: 'El rol necesita un nombre' });
    if (!perms.length) return res.status(400).json({ error: 'Elegí al menos un permiso' });
    const o = org();
    o.roles.push({ id: crypto.randomUUID(), name, desc: String(b.desc || '').slice(0, 180), perms });
    db.set('org', o).write();
    addAudit(req.user.email, 'Rol creado', name);
    res.json(stats());
  });

  app.put('/api/org/roles/:id', requireAuth, requireOwner, (req, res) => {
    const o = org();
    const r = (o.roles || []).find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Rol no encontrado' });
    const b = req.body || {};
    if (b.name) r.name = String(b.name).trim().slice(0, 40);
    if (b.desc != null) r.desc = String(b.desc).slice(0, 180);
    if (Array.isArray(b.perms)) {
      const perms = b.perms.filter(p => PERMS.includes(p));
      if (!perms.length) return res.status(400).json({ error: 'Elegí al menos un permiso' });
      r.perms = perms;
    }
    db.set('org', o).write();
    addAudit(req.user.email, 'Rol modificado', r.name);
    res.json(stats());
  });

  app.delete('/api/org/roles/:id', requireAuth, requireOwner, (req, res) => {
    const o = org();
    const r = (o.roles || []).find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Rol no encontrado' });
    o.roles = o.roles.filter(x => x.id !== req.params.id);
    o.members = (o.members || []).filter(m => m.roleId !== req.params.id);
    o.shares = (o.shares || []).filter(s => s.roleId !== req.params.id);
    db.set('org', o).write();
    addAudit(req.user.email, 'Rol eliminado', r.name);
    res.json(stats());
  });

  app.post('/api/org/members', requireAuth, requireOwner, (req, res) => {
    const email = String((req.body || {}).email || '').toLowerCase().trim();
    const roleId = String((req.body || {}).roleId || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Correo inválido' });
    if (email === OWNER_EMAIL) return res.status(400).json({ error: 'El dueño no se asigna como empleado' });
    const o = org();
    if (!(o.roles || []).some(r => r.id === roleId)) return res.status(400).json({ error: 'Elegí un rol' });
    o.members = (o.members || []).filter(m => m.email !== email);
    o.members.push({ email, roleId, name: String((req.body || {}).name || '').slice(0, 60), at: new Date().toISOString() });
    db.set('org', o).write();
    addAudit(req.user.email, 'Rol asignado', `${email} → ${roleId}`);
    res.json(stats());
  });

  app.delete('/api/org/members/:email', requireAuth, requireOwner, (req, res) => {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const o = org();
    o.members = (o.members || []).filter(m => m.email !== email);
    db.set('org', o).write();
    addAudit(req.user.email, 'Miembro quitado', email);
    res.json(stats());
  });

  app.post('/api/org/shares', requireAuth, requireOwner, (req, res) => {
    const b = req.body || {};
    const scope = b.scope === 'role' ? 'role' : 'all';
    const o = org();
    if (scope === 'role' && !(o.roles || []).some(r => r.id === b.roleId)) return res.status(400).json({ error: 'Rol inválido' });
    const token = crypto.randomBytes(9).toString('hex');
    o.shares = o.shares || [];
    o.shares.unshift({
      id: crypto.randomUUID(), token, scope, roleId: scope === 'role' ? b.roleId : null,
      includeGraph: !!b.includeGraph, includeNames: !!b.includeNames,
      label: String(b.label || '').slice(0, 60), at: new Date().toISOString(), exp: Date.now() + 30 * 24 * 3600 * 1000,
    });
    db.set('org', o).write();
    addAudit(req.user.email, 'Enlace compartido', scope === 'all' ? 'toda la empresa' : b.roleId);
    res.json({ ...stats(), url: `/compartir/${token}` });
  });

  app.delete('/api/org/shares/:id', requireAuth, requireOwner, (req, res) => {
    const o = org();
    o.shares = (o.shares || []).filter(s => s.id !== req.params.id);
    db.set('org', o).write();
    res.json(stats());
  });

  function sharePayload(token) {
    const o = org();
    const s = (o.shares || []).find(x => x.token === token);
    if (!s || s.exp < Date.now()) return null;
    const roles = s.scope === 'role' ? (o.roles || []).filter(r => r.id === s.roleId) : (o.roles || []);
    const members = (o.members || []).filter(m => roles.some(r => r.id === m.roleId));
    return {
      companyName: o.companyName,
      label: s.label,
      scope: s.scope,
      includeGraph: s.includeGraph,
      includeNames: s.includeNames,
      roles: roles.map(r => ({
        name: r.name, desc: r.desc, perms: r.perms,
        members: members.filter(m => m.roleId === r.id).length,
        people: s.includeNames ? members.filter(m => m.roleId === r.id).map(m => m.name || m.email) : [],
      })),
      totals: { roles: roles.length, members: members.length },
    };
  }

  app.get('/api/share/:token', (req, res) => {
    const data = sharePayload(req.params.token);
    if (!data) return res.status(404).json({ error: 'Enlace inválido o vencido' });
    res.json(data);
  });

  app.get('/conectar-agente', (req, res) => {
    const code = String(req.query.code || '').replace(/[^a-f0-9]/gi, '').slice(0, 16);
    res.type('html').send(connectHtml(code));
  });

  app.get('/compartir/:token', (req, res) => {
    const data = sharePayload(req.params.token);
    if (!data) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>IPHub</title><body style="font-family:system-ui;background:#07111f;color:#e8eefc;padding:2rem">Este enlace no existe o venció.</body>');
    res.type('html').send(shareHtml(data));
  });
};

function connectHtml(code) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar IPHub.exe</title><link rel="stylesheet" href="/styles.css"></head>
<body style="min-height:100vh;display:grid;place-items:center;padding:1.5rem">
  <div class="card glass" style="max-width:460px;width:100%" data-no-i18n>
    <h2>Conectar el exe</h2>
    <p class="muted">Iniciá sesión en esta página con la misma cuenta (correo, Google o Discord) y confirmá. El programa de Windows va a mostrar la red de esa cuenta.</p>
    <p class="muted small">Código: <strong>${code || '—'}</strong></p>
    <p id="who" class="muted"></p>
    <button class="btn btn-primary btn-full" id="ok" disabled>Confirmar conexión</button>
    <p id="msg" class="form-error hidden"></p>
    <p class="muted small" style="margin-top:1rem"><a href="/?conectar=${code}">Entrar con correo, Google o Discord</a>. Al iniciar sesión se conecta el exe.</p>
  </div>
<script>
const code = ${JSON.stringify(code)};
const token = localStorage.getItem('iphub_token');
const who = document.getElementById('who'), ok = document.getElementById('ok'), msg = document.getElementById('msg');
if (!token) who.textContent = 'No hay sesión en este navegador.';
else fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json()).then(d => {
  if (!d.user) { who.textContent = 'La sesión venció. Entrá de nuevo y recargá.'; return; }
  who.textContent = 'Cuenta: ' + d.user.name + ' · ' + d.user.email;
  ok.disabled = false;
}).catch(() => { who.textContent = 'No se pudo leer la sesión.'; });
ok.onclick = async () => {
  ok.disabled = true;
  const r = await fetch('/api/agent/link/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ code }) });
  const d = await r.json();
  if (!r.ok) { msg.textContent = d.error || 'Error'; msg.classList.remove('hidden'); ok.disabled = false; return; }
  who.textContent = 'Listo. Ya podés volver al exe: va a entrar solo.';
  ok.textContent = 'Conectado';
};
</script></body></html>`;
}

function shareHtml(data) {
  const permName = { dashboard: 'Dashboard', topology: 'Topología', tools: 'Herramientas', audit: 'Auditoría', learn: 'Aprender', ranking: 'Ranking', support: 'Soporte' };
  const max = Math.max(1, ...data.roles.map(r => r.members));
  const bars = data.roles.map(r => `<div class="share-row"><span>${esc(r.name)}</span><div class="share-bar"><i style="width:${Math.round(100 * r.members / max)}%"></i></div><b>${r.members}</b></div>`).join('');
  const cards = data.roles.map(r => `<article class="card glass"><h3>${esc(r.name)}</h3><p class="muted">${esc(r.desc || '')}</p><p>${(r.perms || []).map(p => permName[p] || p).map(esc).join(' · ') || 'Sin permisos'}</p><p><strong>${r.members}</strong> personas</p>${r.people.length ? `<ul>${r.people.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</article>`).join('');
  const graph = data.includeGraph ? `<section class="card glass"><h3>Personas por rol</h3>${bars || '<p class="muted">Sin roles.</p>'}<div class="share-org">${data.roles.map(r => `<div><strong>${esc(r.name)}</strong><small>${r.members}</small></div>`).join('')}</div></section>` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(data.companyName)} · IPHub</title><link rel="stylesheet" href="/styles.css">
<style>
.share-wrap{max-width:920px;margin:2rem auto;padding:0 1rem}
.share-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
.share-row{display:grid;grid-template-columns:120px 1fr 32px;gap:.6rem;align-items:center;margin:.45rem 0}
.share-bar{height:10px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden}
.share-bar i{display:block;height:100%;background:linear-gradient(90deg,#22d3ee,#8b5cf6)}
.share-org{display:flex;flex-wrap:wrap;gap:.7rem;margin-top:1rem}
.share-org div{border:1px solid rgba(34,211,238,.35);border-radius:12px;padding:.7rem 1rem;min-width:120px}
.share-org small{display:block;color:#8b98b8}
</style></head>
<body><main class="share-wrap" data-no-i18n>
  <p class="muted">IPHub · vista compartida</p>
  <h1>${esc(data.companyName)}</h1>
  <p class="muted">${esc(data.label || (data.scope === 'all' ? 'Todos los roles' : 'Un rol'))} · ${data.totals.members} personas · ${data.totals.roles} roles</p>
  ${graph}
  <div class="share-grid" style="margin-top:1rem">${cards}</div>
</main></body></html>`;
}

function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"' }[c])); }
