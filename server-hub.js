/** Perfil, IA elegible, prompt de Aprender, trazas y clave API. */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit } = ctx;
  const PROVIDERS = ['auto', 'groq', 'gemini', 'openrouter'];
  const DEFAULT_PROMPT = 'Sos un profesor de redes. Escribí preguntas claras, correctas y prácticas para un técnico. No inventes opciones tramposas.';

  function ensureProfile(user) {
    if (!user) return null;
    if (user.profile && user.profile.profileId) return user.profile;
    const profile = { profileId: Date.now() % 100000000, isBusiness: !!user.company, createdAt: new Date().toISOString() };
    db.get('users').find({ id: user.id }).assign({ profile, aiProvider: user.aiProvider || 'auto', learnPrompt: user.learnPrompt || '' }).write();
    return profile;
  }

  app.use((req, _res, next) => {
    if (req.user && req.user.id) ensureProfile(req.user);
    next();
  });

  app.get('/api/profile', requireAuth, (req, res) => {
    const u = db.get('users').find({ id: req.user.id }).value();
    const profile = ensureProfile(u);
    res.json({
      profile, aiProvider: u.aiProvider || 'auto', learnPrompt: u.learnPrompt || DEFAULT_PROMPT,
      apiKey: u.apiKey, isOwner: String(u.email).toLowerCase() === 'iphuboficial@gmail.com',
    });
  });

  app.put('/api/profile', requireAuth, (req, res) => {
    const b = req.body || {};
    const u = db.get('users').find({ id: req.user.id });
    const cur = u.value();
    const profile = ensureProfile(cur);
    if (typeof b.isBusiness === 'boolean') profile.isBusiness = b.isBusiness;
    const patch = { profile };
    if (PROVIDERS.includes(b.aiProvider)) patch.aiProvider = b.aiProvider;
    if (typeof b.learnPrompt === 'string') patch.learnPrompt = b.learnPrompt.slice(0, 2000);
    u.assign(patch).write();
    addAudit(cur.email, 'Perfil actualizado', profile.isBusiness ? 'empresa' : 'personal');
    res.json({ ok: true, profile, aiProvider: patch.aiProvider || cur.aiProvider || 'auto', learnPrompt: patch.learnPrompt || cur.learnPrompt || DEFAULT_PROMPT });
  });

  app.get('/api/ai/options', requireAuth, (_req, res) => {
    res.json({
      providers: [
        { id: 'auto', name: 'Automática (la que tenga clave)' },
        { id: 'groq', name: 'Groq' },
        { id: 'gemini', name: 'Gemini' },
        { id: 'openrouter', name: 'OpenRouter' },
      ],
    });
  });

  global.iphubLearnExtra = user => {
    const u = db.get('users').find({ id: user.id }).value() || user;
    return { provider: u.aiProvider || 'auto', learnPrompt: u.learnPrompt || DEFAULT_PROMPT };
  };
};
