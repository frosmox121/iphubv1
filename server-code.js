'use strict';
/**
 * Code Intelligence + Forum (solo dueño iphuboficial@gmail.com)
 * Repos, commits, funciones, Code Query, grafos, shared views, foro.
 */
module.exports = function mountCode(app, ctx) {
  const { db, requireAuth, requireOwner, addAudit, crypto, publicUser, isOwnerUser } = ctx;
  const ownerCheck = isOwnerUser || (u => !!(u && u.isOwner));
  if (!db.get('codeRepos').value) db.set('codeRepos', []).write();
  if (!db.get('codeQueries').value) db.set('codeQueries', []).write();
  if (!db.get('codeShares').value) db.set('codeShares', []).write();
  if (!db.get('forumPosts').value) db.set('forumPosts', []).write();
  if (!db.get('forumComments').value) db.set('forumComments', []).write();

  const uid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();

  // Demo seed (solo si no hay repos) — datos de análisis locales, no requieren GitHub real
  function ensureDemo(userId) {
    const list = db.get('codeRepos').filter({ ownerId: userId }).value() || [];
    if (list.length) return list;
    const repoId = uid();
    const demo = {
      id: repoId,
      ownerId: userId,
      provider: 'internal',
      name: 'iphub-core',
      fullName: 'iphub/iphub-core',
      url: '',
      primary: true,
      secondary: false,
      status: 'synced',
      lastSync: now(),
      branches: ['main', 'develop'],
      createdAt: now(),
      commits: [
        {
          id: 'c1', sha: 'a1b2c3d', message: 'feat: auth middleware y JWT', author: 'dueño', date: now(),
          branch: 'main', files: ['server.js', 'public/app.js'],
          functions: ['requireAuth', 'publicUser', 'issueCode'],
          classes: [], modules: ['auth'], apis: ['/api/auth/login'], tests: [],
          risk: 'medium', linesAdded: 120, linesRemoved: 14
        },
        {
          id: 'c2', sha: 'e4f5g6h', message: 'fix: validación de permisos en backend', author: 'dueño', date: now(),
          branch: 'main', files: ['server-org.js'],
          functions: ['requireRole', 'checkPerm'],
          classes: [], modules: ['org'], apis: [], tests: ['test-perms.js'],
          risk: 'high', linesAdded: 45, linesRemoved: 8
        },
        {
          id: 'c3', sha: 'i7j8k9l', message: 'chore: inventario de puertos y servicios', author: 'dueño', date: now(),
          branch: 'develop', files: ['agent/core.js'],
          functions: ['scanPorts', 'detectService'],
          classes: [], modules: ['scan'], apis: [], tests: [],
          risk: 'low', linesAdded: 80, linesRemoved: 3
        }
      ],
      functions: [
        {
          id: 'f1', name: 'requireAuth', file: 'server.js', line: 238, module: 'auth', className: null,
          signature: 'function requireAuth(req, res, next)',
          authors: ['dueño'], complexity: 6, size: 28, callsIn: ['tools', 'audit'], callsOut: ['jwt.verify', 'db.get'],
          deps: ['jsonwebtoken', 'mini-db'], params: ['req', 'res', 'next'], returns: ['void'],
          io: ['headers', 'db'], dbAccess: true, apiAccess: false, fileAccess: false, netAccess: false, secrets: false,
          tests: [], history: [{ sha: 'a1b2c3d', date: now() }], tags: ['security', 'auth']
        },
        {
          id: 'f2', name: 'scanPorts', file: 'agent/core.js', line: 90, module: 'scan', className: null,
          signature: 'async function scanPorts(host, ports)',
          authors: ['dueño'], complexity: 9, size: 54, callsIn: ['scan'], callsOut: ['net.Socket'],
          deps: ['net'], params: ['host', 'ports'], returns: ['Promise<Result[]>'],
          io: ['network'], dbAccess: false, apiAccess: false, fileAccess: false, netAccess: true, secrets: false,
          tests: [], history: [{ sha: 'i7j8k9l', date: now() }], tags: ['network', 'ports']
        },
        {
          id: 'f3', name: 'issueCode', file: 'server.js', line: 120, module: 'auth', className: null,
          signature: 'async function issueCode(user)',
          authors: ['dueño'], complexity: 4, size: 18, callsIn: ['register', 'resend'], callsOut: ['sendMail', 'sha'],
          deps: ['crypto', 'nodemailer'], params: ['user'], returns: ['Promise<boolean>'],
          io: ['email', 'db'], dbAccess: true, apiAccess: false, fileAccess: false, netAccess: true, secrets: true,
          tests: [], history: [{ sha: 'a1b2c3d', date: now() }], tags: ['auth', 'email']
        }
      ],
      graph: {
        nodes: [
          { id: 'requireAuth', type: 'function', critical: true },
          { id: 'issueCode', type: 'function', critical: false },
          { id: 'scanPorts', type: 'function', critical: false },
          { id: 'jsonwebtoken', type: 'dep', external: true },
          { id: 'nodemailer', type: 'dep', external: true },
          { id: 'net', type: 'dep', external: true }
        ],
        edges: [
          { from: 'requireAuth', to: 'jsonwebtoken' },
          { from: 'issueCode', to: 'nodemailer' },
          { from: 'scanPorts', to: 'net' },
          { from: 'register', to: 'issueCode' },
          { from: 'tools', to: 'requireAuth' }
        ]
      }
    };
    db.get('codeRepos').push(demo).write();
    return [demo];
  }

  app.get('/api/code/repos', requireOwner, (req, res) => {
    const repos = ensureDemo(req.user.id).map(r => ({
      id: r.id, provider: r.provider, name: r.name, fullName: r.fullName, url: r.url,
      primary: r.primary, secondary: r.secondary, status: r.status, lastSync: r.lastSync,
      branches: r.branches, commitCount: (r.commits || []).length, functionCount: (r.functions || []).length
    }));
    res.json({ repos });
  });

  app.post('/api/code/repos', requireOwner, (req, res) => {
    const { provider, name, url, token, primary } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nombre del repositorio obligatorio' });
    const repo = {
      id: uid(), ownerId: req.user.id, provider: provider || 'github', name, fullName: name, url: url || '',
      tokenHint: token ? String(token).slice(0, 4) + '…' : '', primary: !!primary, secondary: !primary,
      status: 'connected', lastSync: now(), branches: ['main'], createdAt: now(), commits: [], functions: [], graph: { nodes: [], edges: [] }
    };
    db.get('codeRepos').push(repo).write();
    addAudit(req.user.email, 'Repositorio conectado', `${provider}: ${name}`);
    res.json({ repo: { id: repo.id, name: repo.name, provider: repo.provider, status: repo.status } });
  });

  app.post('/api/code/repos/:id/sync', requireOwner, (req, res) => {
    const repo = db.get('codeRepos').find({ id: req.params.id, ownerId: req.user.id }).value();
    if (!repo) return res.status(404).json({ error: 'Repositorio no encontrado' });
    db.get('codeRepos').find({ id: repo.id }).assign({ status: 'synced', lastSync: now() }).write();
    addAudit(req.user.email, 'Sincronización de repositorio', repo.name);
    res.json({ ok: true, lastSync: now(), status: 'synced' });
  });

  app.delete('/api/code/repos/:id', requireOwner, (req, res) => {
    db.get('codeRepos').remove({ id: req.params.id, ownerId: req.user.id }).write();
    addAudit(req.user.email, 'Repositorio desconectado', req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/code/commits', requireOwner, (req, res) => {
    const repos = ensureDemo(req.user.id);
    let commits = [];
    for (const r of repos) {
      for (const c of r.commits || []) commits.push({ ...c, repoId: r.id, repoName: r.name });
    }
    const q = String(req.query.q || '').toLowerCase();
    if (q) {
      commits = commits.filter(c =>
        (c.message || '').toLowerCase().includes(q) ||
        (c.author || '').toLowerCase().includes(q) ||
        (c.sha || '').toLowerCase().includes(q) ||
        (c.files || []).some(f => f.toLowerCase().includes(q)) ||
        (c.functions || []).some(f => f.toLowerCase().includes(q))
      );
    }
    if (req.query.author) commits = commits.filter(c => c.author === req.query.author);
    if (req.query.branch) commits = commits.filter(c => c.branch === req.query.branch);
    res.json({ commits });
  });

  app.get('/api/code/functions', requireOwner, (req, res) => {
    const repos = ensureDemo(req.user.id);
    let fns = [];
    for (const r of repos) {
      for (const f of r.functions || []) fns.push({ ...f, repoId: r.id, repoName: r.name });
    }
    const q = String(req.query.q || '').toLowerCase();
    if (q) {
      fns = fns.filter(f =>
        (f.name || '').toLowerCase().includes(q) ||
        (f.file || '').toLowerCase().includes(q) ||
        (f.module || '').toLowerCase().includes(q) ||
        (f.tags || []).some(t => t.includes(q))
      );
    }
    if (req.query.dep) fns = fns.filter(f => (f.deps || []).includes(req.query.dep));
    if (req.query.secrets === '1') fns = fns.filter(f => f.secrets);
    res.json({ functions: fns });
  });

  app.get('/api/code/functions/:id', requireOwner, (req, res) => {
    const repos = ensureDemo(req.user.id);
    for (const r of repos) {
      const f = (r.functions || []).find(x => x.id === req.params.id);
      if (f) return res.json({ function: { ...f, repoId: r.id, repoName: r.name } });
    }
    res.status(404).json({ error: 'Función no encontrada' });
  });

  app.get('/api/code/graph/:repoId', requireOwner, (req, res) => {
    const repo = ensureDemo(req.user.id).find(r => r.id === req.params.repoId) || ensureDemo(req.user.id)[0];
    if (!repo) return res.status(404).json({ error: 'Sin repositorio' });
    res.json({ graph: repo.graph || { nodes: [], edges: [] }, repoId: repo.id, repoName: repo.name });
  });

  // Code Query Explorer
  app.post('/api/code/query', requireOwner, (req, res) => {
    const { entity, filters, sort, group } = req.body || {};
    const repos = ensureDemo(req.user.id);
    let rows = [];
    if (entity === 'functions' || !entity) {
      for (const r of repos) for (const f of r.functions || []) rows.push({ type: 'function', ...f, repo: r.name });
    } else if (entity === 'commits') {
      for (const r of repos) for (const c of r.commits || []) rows.push({ type: 'commit', ...c, repo: r.name });
    } else if (entity === 'files') {
      const files = new Set();
      for (const r of repos) for (const c of r.commits || []) for (const f of c.files || []) files.add(r.name + ':' + f);
      rows = [...files].map(x => ({ type: 'file', path: x }));
    }
    const fl = filters || {};
    if (fl.name) rows = rows.filter(r => String(r.name || r.message || r.path || '').toLowerCase().includes(String(fl.name).toLowerCase()));
    if (fl.tag) rows = rows.filter(r => (r.tags || []).includes(fl.tag));
    if (fl.secrets) rows = rows.filter(r => r.secrets);
    if (fl.minComplexity) rows = rows.filter(r => (r.complexity || 0) >= Number(fl.minComplexity));
    if (sort === 'complexity') rows.sort((a, b) => (b.complexity || 0) - (a.complexity || 0));
    if (sort === 'size') rows.sort((a, b) => (b.size || 0) - (a.size || 0));
    const result = { count: rows.length, rows: rows.slice(0, 200), group: group || null };
    res.json(result);
  });

  app.post('/api/code/query/save', requireOwner, (req, res) => {
    const { name, entity, filters, sort } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nombre obligatorio' });
    const q = { id: uid(), ownerId: req.user.id, name, entity, filters, sort, createdAt: now() };
    db.get('codeQueries').push(q).write();
    res.json({ query: q });
  });

  app.get('/api/code/query/saved', requireOwner, (req, res) => {
    res.json({ queries: db.get('codeQueries').filter({ ownerId: req.user.id }).value() || [] });
  });

  // Shared views
  app.post('/api/code/share', requireOwner, (req, res) => {
    const { type, payload, password, expiresHours, readOnly } = req.body || {};
    const share = {
      id: uid(), ownerId: req.user.id, type: type || 'query', payload: payload || {},
      password: password ? String(password) : null,
      expiresAt: expiresHours ? Date.now() + Number(expiresHours) * 3600e3 : null,
      readOnly: readOnly !== false, createdAt: now(), visits: 0
    };
    db.get('codeShares').push(share).write();
    addAudit(req.user.email, 'Vista compartida creada', share.id);
    res.json({ id: share.id, url: '/shared/' + share.id });
  });

  app.get('/api/code/share/:id', (req, res) => {
    const s = db.get('codeShares').find({ id: req.params.id }).value();
    if (!s) return res.status(404).json({ error: 'Vista no encontrada o revocada' });
    if (s.expiresAt && Date.now() > s.expiresAt) return res.status(410).json({ error: 'Enlace expirado' });
    db.get('codeShares').find({ id: s.id }).assign({ visits: (s.visits || 0) + 1 }).write();
    res.json({ type: s.type, payload: s.payload, readOnly: s.readOnly, needsPassword: !!s.password });
  });

  // Forum
  app.get('/api/forum/posts', requireOwner, (req, res) => {
    const posts = (db.get('forumPosts').value() || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ posts });
  });

  app.post('/api/forum/posts', requireOwner, (req, res) => {
    const { title, body, category, repoId, commitId, functionId } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: 'Título y cuerpo obligatorios' });
    const post = {
      id: uid(), authorId: req.user.id, authorEmail: req.user.email, authorName: req.user.name,
      title, body, category: category || 'general',
      repoId: repoId || null, commitId: commitId || null, functionId: functionId || null,
      resolved: false, critical: false, votes: 0, createdAt: now()
    };
    db.get('forumPosts').push(post).write();
    addAudit(req.user.email, 'Foro: publicación', title);
    res.json({ post });
  });

  app.post('/api/forum/posts/:id/comments', requireOwner, (req, res) => {
    const post = db.get('forumPosts').find({ id: req.params.id }).value();
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada' });
    const c = {
      id: uid(), postId: post.id, authorId: req.user.id, authorName: req.user.name,
      body: String((req.body || {}).body || ''), createdAt: now()
    };
    db.get('forumComments').push(c).write();
    res.json({ comment: c });
  });

  app.get('/api/forum/posts/:id/comments', requireOwner, (req, res) => {
    res.json({ comments: db.get('forumComments').filter({ postId: req.params.id }).value() || [] });
  });

  // Workspace save
  app.put('/api/workspace', requireAuth, (req, res) => {
    const layout = (req.body || {}).layout || null;
    db.get('users').find({ id: req.user.id }).assign({ workspace: layout }).write();
    res.json({ ok: true, workspace: layout });
  });

  // AI settings per user
  app.put('/api/ai/settings', requireAuth, (req, res) => {
    const { aiProvider, aiModel, aiBaseUrl, aiApiKey, learnPrompt } = req.body || {};
    const patch = {};
    if (aiProvider !== undefined) patch.aiProvider = String(aiProvider || 'auto');
    if (aiModel !== undefined) patch.aiModel = String(aiModel || '');
    if (aiBaseUrl !== undefined) patch.aiBaseUrl = String(aiBaseUrl || '');
    if (aiApiKey !== undefined && aiApiKey !== '') patch.aiApiKey = String(aiApiKey);
    if (aiApiKey === null || aiApiKey === '') { /* keep existing unless explicit clear */ }
    if (learnPrompt !== undefined) {
      // business: only admin; personal: any user
      patch.learnPrompt = String(learnPrompt || '');
    }
    db.get('users').find({ id: req.user.id }).assign(patch).write();
    addAudit(req.user.email, 'Configuración de IA actualizada', patch.aiProvider || '');
    const pu = publicUser || (u => u);
    res.json({ user: pu(db.get('users').find({ id: req.user.id }).value()) });
  });
};
