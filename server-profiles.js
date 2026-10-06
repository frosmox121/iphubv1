/** Perfiles que agrupan cuentas. La sesión sigue siendo un JWT, no un booleano. */
module.exports = function register(app, ctx) {
  const { db, bcrypt, crypto, requireAuth, addAudit, sendMail, SUPPORT_TO } = ctx;
  const caps = new Map();

  function allProfiles() { return db.get('profiles').value() || []; }
  function saveProfiles(list) { db.set('profiles', list).write(); }
  function profileOf(user) { return allProfiles().find(p => p.profileId === user.profileId) || null; }
  function members(profileId) { return (db.get('users').value() || []).filter(u => u.profileId === profileId); }

  function makeProfile(isBusiness, companyName) {
    const p = { profileId: crypto.randomUUID(), isBusiness: !!isBusiness, companyName: String(companyName || '').slice(0, 80), createdAt: new Date().toISOString() };
    saveProfiles(allProfiles().concat(p));
    return p;
  }
  function bind(user, profile, isAdmin) {
    db.get('users').find({ id: user.id }).assign({ profileId: profile.profileId, isAdmin: !!isAdmin, company: profile.companyName || user.company || '' }).write();
  }
  function ensure(user) {
    if (!user) return null;
    if (user.profileId && profileOf(user)) return profileOf(user);
    const profile = makeProfile(false, '');
    bind(user, profile, true);
    return profile;
  }

  global.iphubAfterRegister = async (user, body) => {
    if (user.profileId && profileOf(user)) return;
    const business = body && body.kind === 'business';
    const profile = makeProfile(business, body && (body.companyName || body.company));
    bind(user, profile, true);
    if (business && sendMail) {
      await sendMail(SUPPORT_TO, '[IPHub] Nueva empresa registrada',
        `Se registró una empresa.\nNombre: ${profile.companyName || '-'}\nAdministrador: ${user.name} <${user.email}>\nPerfil: ${profile.profileId}\nNota: registro empresarial. No se incluye ninguna contraseña.`);
    }
  };

  const prev = global.iphubPublicExtra;
  global.iphubPublicExtra = u => {
    const extra = prev ? prev(u) : {};
    const profile = profileOf(u) || null;
    return { ...extra, profileId: u.profileId || null, isAdmin: !!u.isAdmin, isBusiness: !!(profile && profile.isBusiness), companyName: profile ? profile.companyName : '' };
  };

  app.get('/api/auth/captcha', (_req, res) => {
    const a = 1 + Math.floor(Math.random() * 8), b = 1 + Math.floor(Math.random() * 8);
    const id = crypto.randomUUID();
    caps.set(id, { answer: a + b, exp: Date.now() + 5 * 60 * 1000 });
    res.json({ id, question: `${a} + ${b}` });
  });
  global.iphubCheckCaptcha = body => {
    const row = caps.get(body && body.captchaId);
    if (!row || row.exp < Date.now() || Number(body.captcha) !== row.answer) return false;
    caps.delete(body.captchaId);
    return true;
  };

  app.get('/api/profile/accounts', requireAuth, (req, res) => {
    const profile = ensure(req.user);
    res.json({
      profile,
      me: req.user.id,
      accounts: members(profile.profileId).map(u => ({ id: u.id, name: u.name, email: u.email, isAdmin: !!u.isAdmin })),
    });
  });

  app.post('/api/profile/accounts', requireAuth, async (req, res) => {
    const profile = ensure(req.user);
    if (profile.isBusiness && !req.user.isAdmin) return res.status(403).json({ error: 'Solo el administrador puede agregar empleados' });
    const b = req.body || {};
    const email = String(b.email || '').toLowerCase().trim();
    const name = String(b.name || '').trim();
    const password = String(b.password || '');
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || password.length < 8) return res.status(400).json({ error: 'Nombre, correo válido y contraseña (mín. 8) son obligatorios' });
    if (db.get('users').find({ email }).value()) return res.status(409).json({ error: 'Ese correo ya tiene cuenta' });
    const user = { id: crypto.randomUUID(), name, email, company: profile.companyName || '', passwordHash: await bcrypt.hash(password, 10), verified: true, profileId: profile.profileId, isAdmin: false, apiKey: 'iphub_live_' + crypto.randomBytes(16).toString('hex'), createdAt: new Date().toISOString() };
    db.get('users').push(user).write();
    addAudit(req.user.email, 'Cuenta agregada al perfil', email);
    res.json({ ok: true, account: { id: user.id, name, email, isAdmin: false } });
  });

  app.delete('/api/profile/accounts/:id', requireAuth, (req, res) => {
    const profile = ensure(req.user);
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Solo el administrador puede desvincular cuentas' });
    const target = db.get('users').find({ id: req.params.id }).value();
    if (!target || target.profileId !== profile.profileId) return res.status(404).json({ error: 'Esa cuenta no está en este perfil' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'No podés desvincular la cuenta con la que estás' });
    db.get('users').find({ id: target.id }).assign({ profileId: null, isAdmin: false }).write();
    const personal = makeProfile(false, '');
    db.get('users').find({ id: target.id }).assign({ profileId: personal.profileId, isAdmin: true }).write();
    addAudit(req.user.email, 'Cuenta desvinculada', target.email);
    res.json({ ok: true });
  });
};
