/** Suscripción (solo cuenta oficial por ahora) y Estudio modular: el diseño se guarda como datos validados, nunca como código libre. */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit, aiChat } = ctx;
  const OWNER = 'iphuboficial@gmail.com';
  const SECTIONS = ['dashboard', 'topology', 'tools', 'audit', 'learn', 'leaderboard', 'support', 'empresa', 'manual', 'account'];
  const FONTS = ['system', 'serif', 'mono', 'rounded'], DENS = ['compact', 'normal', 'cozy'], NAVS = ['left', 'hidden'];
  const FEATURES = [
    { id: 'studio', name: 'Estudio modular + IA', desc: 'Cambiá colores, orden y secciones de la página por bloques, con 3 espacios guardados.', ready: true, admin: true },
    { id: 'embed', name: 'Modo embebido', desc: 'La página dentro de otras apps (iframe): agregá ?embed=1 a la URL.', ready: true, admin: false },
    { id: 'a11y', name: 'Accesibilidad', desc: 'Daltonismo, texto grande, contraste, dislexia y más.', ready: true, admin: false },
    { id: 'sandbox', name: 'Entorno virtual de red', desc: 'Mapa IP editable con pruebas de traza y estrés controlado.', ready: false, admin: true },
    { id: 'apitrack', name: 'Seguimiento de claves API', desc: 'El administrador ve a qué servicios se conecta cada empleado.', ready: false, admin: true },
    { id: 'phish', name: 'Simulacro de phishing', desc: 'Campañas internas con consentimiento para medir concientización.', ready: false, admin: true },
    { id: 'commits', name: 'Commits y foro empresarial', desc: 'Vistas compartibles con commit a GitHub o a un repositorio privado.', ready: false, admin: true },
  ];
  const isOwner = u => !!u && (String(u.email || '').toLowerCase() === OWNER || u.isOwner === true);
  const gate = (req, res, next) => isOwner(req.user) ? next() : res.status(403).json({ error: 'Función de suscripción: por ahora solo la cuenta oficial.' });

  function sanitize(l) {
    l = l && typeof l === 'object' ? l : {};
    const hex = (v, d) => /^#[0-9a-f]{6}$/i.test(v) ? v : d, uniq = a => [...new Set((Array.isArray(a) ? a : []).filter(x => SECTIONS.includes(x)))];
    const out = { accent: hex(l.accent, '#22d3ee'), accent2: hex(l.accent2, '#818cf8'), bg: hex(l.bg, '#0a0f1e'),
      radius: Math.max(0, Math.min(28, parseInt(l.radius, 10) || 14)), density: DENS.includes(l.density) ? l.density : 'normal',
      font: FONTS.includes(l.font) ? l.font : 'system', nav: NAVS.includes(l.nav) ? l.nav : 'left', order: uniq(l.order), hidden: uniq(l.hidden).filter(x => x !== 'account') };
    return out;
  }
  const row = id => { const all = db.get('studio').value() || {}; return all[id] || { active: 0, slots: [null, null, null] }; };

  app.get('/api/sub/me', requireAuth, (req, res) => {
    const o = isOwner(req.user);
    res.json({ plan: o ? 'admin' : 'free', features: FEATURES.map(f => ({ ...f, enabled: f.admin ? o && f.ready : f.ready })) });
  });
  app.get('/api/studio', requireAuth, gate, (req, res) => res.json({ ...row(req.user.id), sections: SECTIONS }));
  app.put('/api/studio', requireAuth, gate, (req, res) => {
    const b = req.body || {}, cur = row(req.user.id), slots = [...cur.slots];
    if (Number.isInteger(b.slot) && b.slot >= 1 && b.slot <= 3 && b.layout) slots[b.slot - 1] = { name: String(b.name || 'Espacio ' + b.slot).slice(0, 30), layout: sanitize(b.layout) };
    if (Number.isInteger(b.clear) && b.clear >= 1 && b.clear <= 3) slots[b.clear - 1] = null;
    let active = Number.isInteger(b.active) ? b.active : cur.active; if (active < 0 || active > 3 || (active > 0 && !slots[active - 1])) active = 0;
    const next = { active, slots }; db.set('studio', { ...(db.get('studio').value() || {}), [req.user.id]: next }).write();
    addAudit(req.user.email, 'Estudio actualizado', `espacio activo ${active}`); res.json(next);
  });
  app.post('/api/studio/ai', requireAuth, gate, async (req, res) => {
    const prompt = String((req.body || {}).prompt || '').slice(0, 400); if (!prompt) return res.status(400).json({ error: 'Escribí qué querés cambiar' });
    const cur = sanitize((req.body || {}).current);
    const sys = `Sos el editor de diseño de IPHub. Devolvé SOLO un objeto JSON (sin texto ni markdown) con estas claves, modificando el diseño actual según el pedido:
accent, accent2, bg (colores #rrggbb), radius (0-28), density (compact|normal|cozy), font (system|serif|mono|rounded), nav (left|hidden),
order (lista de secciones en el orden deseado), hidden (secciones a ocultar). Secciones válidas: ${SECTIONS.join(', ')}. No inventes claves nuevas.`;
    const raw = await aiChat([{ role: 'system', content: sys }, { role: 'user', content: `Diseño actual: ${JSON.stringify(cur)}\nPedido: ${prompt}` }], { temperature: 0.4, max_tokens: 400 });
    if (!raw) return res.status(503).json({ error: 'La IA no está disponible ahora (revisá las claves en .env). Podés editar los bloques a mano.' });
    try { const m = raw.match(/\{[\s\S]*\}/); res.json({ layout: sanitize({ ...cur, ...JSON.parse(m[0]) }) }); }
    catch (_) { res.status(502).json({ error: 'La IA no devolvió un diseño válido, probá reformular.' }); }
  });
};
