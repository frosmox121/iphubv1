/* Código / Code Query / Foro — solo dueño (estable, sin parpadeo) */
(function () {
  const $ = id => document.getElementById(id);
  let tab = 'repos';
  let lastRender = 0;
  let wrapped = false;

  function ownerOnly() {
    const m = window.ME;
    if (!m) return false;
    if (m.isOwner) return true;
    return String(m.email || '').toLowerCase() === 'iphuboficial@gmail.com';
  }

  function showNav() {
    const n = $('nav-code');
    if (n) n.hidden = !ownerOnly();
  }

  async function api(path, opts) {
    if (typeof window.api === 'function') return window.api(path, opts);
    const headers = { 'Content-Type': 'application/json' };
    const t = localStorage.getItem('iphub_token');
    if (t) headers.Authorization = 'Bearer ' + t;
    const r = await fetch(path, { method: (opts && opts.method) || 'GET', headers, body: opts && opts.body ? JSON.stringify(opts.body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  }

  function tabsHtml() {
    const items = [
      ['repos', 'Repositorios'], ['commits', 'Commits'], ['functions', 'Funciones'],
      ['query', 'Code Query'], ['graph', 'Grafo'], ['forum', 'Foro'], ['share', 'Compartir']
    ];
    return '<div class="code-tabs">' + items.map(function (it) {
      return '<button type="button" data-ctab="' + it[0] + '" class="' + (it[0] === tab ? 'on' : '') + '">' + it[1] + '</button>';
    }).join('') + '</div>';
  }

  function bindTabs(root) {
    root.querySelectorAll('[data-ctab]').forEach(function (b) {
      b.onclick = function () { tab = b.getAttribute('data-ctab'); render(true); };
    });
  }

  async function renderRepos(root) {
    const d = await api('/api/code/repos');
    const rows = (d.repos || []).map(function (r) {
      return '<tr><td>' + r.name + '</td><td>' + r.provider + '</td><td>' + r.status + '</td><td>' + (r.commitCount || 0) + '</td><td>' + (r.functionCount || 0) + '</td>' +
        '<td><button class="btn btn-sm g" data-sync="' + r.id + '" type="button">Sync</button> ' +
        '<button class="btn btn-sm g" data-del="' + r.id + '" type="button">Quitar</button></td></tr>';
    }).join('') || '<tr><td colspan="6">Sin repositorios</td></tr>';
    root.innerHTML = tabsHtml() +
      '<div class="tool-form" style="margin-bottom:.6rem">' +
      '<input id="cr-name" placeholder="nombre repo" style="min-width:140px"> ' +
      '<input id="cr-url" placeholder="URL (opcional)" style="min-width:180px"> ' +
      '<select id="cr-prov"><option value="github">GitHub</option><option value="gitlab">GitLab</option><option value="bitbucket">Bitbucket</option><option value="private">Privado</option><option value="internal">Espejo interno</option></select> ' +
      '<button class="btn btn-sm btn-primary" id="cr-add" type="button">Conectar</button></div>' +
      '<div class="table-wrap"><table class="code-table"><thead><tr><th>Nombre</th><th>Proveedor</th><th>Estado</th><th>Commits</th><th>Funciones</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    bindTabs(root);
    var add = $('cr-add');
    if (add) add.onclick = async function () {
      try {
        await api('/api/code/repos', { method: 'POST', body: { name: $('cr-name').value, url: $('cr-url').value, provider: $('cr-prov').value, primary: true } });
        if (typeof toast === 'function') toast('Repositorio conectado');
        render(true);
      } catch (e) { if (typeof toast === 'function') toast(e.message, true); }
    };
    root.querySelectorAll('[data-sync]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/api/code/repos/' + b.getAttribute('data-sync') + '/sync', { method: 'POST' }); toast('Sincronizado'); render(true); } catch (e) { toast(e.message, true); }
      };
    });
    root.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/api/code/repos/' + b.getAttribute('data-del'), { method: 'DELETE' }); render(true); } catch (e) { toast(e.message, true); }
      };
    });
  }

  async function renderCommits(root) {
    const d = await api('/api/code/commits');
    const rows = (d.commits || []).map(function (c) {
      return '<tr><td><code>' + c.sha + '</code></td><td>' + c.message + '</td><td>' + c.author + '</td><td>' + c.branch + '</td><td>' + (c.functions || []).join(', ') + '</td><td>' + (c.risk || '-') + '</td></tr>';
    }).join('') || '<tr><td colspan="6">Sin commits</td></tr>';
    root.innerHTML = tabsHtml() +
      '<div class="tool-form" style="margin-bottom:.6rem"><input id="cq" placeholder="Buscar…" style="min-width:260px"> <button class="btn btn-sm g" id="cq-go" type="button">Buscar</button></div>' +
      '<div class="table-wrap"><table class="code-table"><thead><tr><th>SHA</th><th>Mensaje</th><th>Autor</th><th>Branch</th><th>Funciones</th><th>Riesgo</th></tr></thead><tbody id="cq-body">' + rows + '</tbody></table></div>';
    bindTabs(root);
    $('cq-go').onclick = async function () {
      const d2 = await api('/api/code/commits?q=' + encodeURIComponent($('cq').value));
      $('cq-body').innerHTML = (d2.commits || []).map(function (c) {
        return '<tr><td><code>' + c.sha + '</code></td><td>' + c.message + '</td><td>' + c.author + '</td><td>' + c.branch + '</td><td>' + (c.functions || []).join(', ') + '</td><td>' + (c.risk || '-') + '</td></tr>';
      }).join('') || '<tr><td colspan="6">Sin resultados</td></tr>';
    };
  }

  async function renderFunctions(root) {
    const d = await api('/api/code/functions');
    const rows = (d.functions || []).map(function (f) {
      return '<tr data-fid="' + f.id + '" style="cursor:pointer"><td>' + f.name + '</td><td>' + f.file + ':' + f.line + '</td><td>' + f.module + '</td><td>' + f.complexity + '</td><td>' + (f.deps || []).join(', ') + '</td><td>' + (f.secrets ? 'sí' : 'no') + '</td></tr>';
    }).join('') || '<tr><td colspan="6">Sin funciones</td></tr>';
    root.innerHTML = tabsHtml() +
      '<div class="table-wrap"><table class="code-table"><thead><tr><th>Función</th><th>Archivo</th><th>Módulo</th><th>Complejidad</th><th>Deps</th><th>Secretos</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div id="fn-detail" class="card glass" style="margin-top:.8rem;display:none"></div>';
    bindTabs(root);
    root.querySelectorAll('[data-fid]').forEach(function (tr) {
      tr.onclick = async function () {
        const d2 = await api('/api/code/functions/' + tr.getAttribute('data-fid'));
        const f = d2.function;
        const box = $('fn-detail');
        box.style.display = '';
        box.innerHTML = '<h3>' + f.name + '</h3><p><code>' + f.signature + '</code></p><p class="muted small">' + f.file + ':' + f.line + '</p>';
      };
    });
  }

  async function renderQuery(root) {
    root.innerHTML = tabsHtml() +
      '<div class="tool-form"><select id="qe-ent"><option value="functions">Funciones</option><option value="commits">Commits</option><option value="files">Archivos</option></select> ' +
      '<input id="qe-name" placeholder="filtro"> <button class="btn btn-sm btn-primary" id="qe-run" type="button">Ejecutar</button></div>' +
      '<pre id="qe-out" class="muted small" style="margin-top:.7rem;white-space:pre-wrap;max-height:420px;overflow:auto"></pre>';
    bindTabs(root);
    $('qe-run').onclick = async function () {
      try {
        const d = await api('/api/code/query', { method: 'POST', body: { entity: $('qe-ent').value, filters: { name: $('qe-name').value } } });
        $('qe-out').textContent = JSON.stringify(d, null, 2);
      } catch (e) { toast(e.message, true); }
    };
  }

  async function renderGraph(root) {
    const repos = await api('/api/code/repos');
    const id = (repos.repos && repos.repos[0] && repos.repos[0].id) || '';
    const d = id ? await api('/api/code/graph/' + id) : { graph: { nodes: [], edges: [] } };
    const g = d.graph || { nodes: [], edges: [] };
    root.innerHTML = tabsHtml() +
      '<p class="muted small">Repo: ' + (d.repoName || '-') + '</p>' +
      '<div class="table-wrap"><table class="code-table"><thead><tr><th>Nodo</th><th>Tipo</th><th>Crítico</th></tr></thead><tbody>' +
      (g.nodes || []).map(function (n) { return '<tr><td>' + n.id + '</td><td>' + n.type + '</td><td>' + (n.critical ? 'sí' : '') + '</td></tr>'; }).join('') +
      '</tbody></table></div><ul class="muted small">' +
      (g.edges || []).map(function (e) { return '<li>' + e.from + ' → ' + e.to + '</li>'; }).join('') + '</ul>';
    bindTabs(root);
  }

  async function renderForum(root) {
    const d = await api('/api/forum/posts');
    root.innerHTML = tabsHtml() +
      '<div class="tool-form"><input id="fp-title" placeholder="Título" style="min-width:180px"> ' +
      '<select id="fp-cat"><option>seguridad</option><option>backend</option><option>apis</option><option>incidentes</option></select> ' +
      '<button class="btn btn-sm btn-primary" id="fp-add" type="button">Publicar</button></div>' +
      '<textarea id="fp-body" rows="3" placeholder="Cuerpo" style="width:100%;margin:.5rem 0;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);color:inherit;border-radius:8px;padding:.5rem"></textarea>' +
      '<div id="fp-list">' + ((d.posts || []).map(function (p) {
        return '<article class="card glass" style="margin:.5rem 0"><h4>' + p.title + ' <span class="muted small">[' + p.category + ']</span></h4><p class="muted small">' + p.authorName + '</p><p>' + p.body + '</p></article>';
      }).join('') || '<p class="muted">Sin publicaciones</p>') + '</div>';
    bindTabs(root);
    $('fp-add').onclick = async function () {
      try {
        await api('/api/forum/posts', { method: 'POST', body: { title: $('fp-title').value, body: $('fp-body').value, category: $('fp-cat').value } });
        render(true);
      } catch (e) { toast(e.message, true); }
    };
  }

  async function renderShare(root) {
    root.innerHTML = tabsHtml() +
      '<div class="tool-form"><select id="sh-type"><option value="query">Consulta</option><option value="graph">Grafo</option></select> ' +
      '<input id="sh-hours" type="number" value="24" style="width:100px"> ' +
      '<button class="btn btn-sm btn-primary" id="sh-go" type="button">Crear enlace</button></div><p id="sh-out" class="muted small"></p>';
    bindTabs(root);
    $('sh-go').onclick = async function () {
      try {
        const d = await api('/api/code/share', { method: 'POST', body: { type: $('sh-type').value, payload: {}, expiresHours: Number($('sh-hours').value) || 24, readOnly: true } });
        $('sh-out').textContent = 'Enlace: ' + location.origin + d.url;
      } catch (e) { toast(e.message, true); }
    };
  }

  async function render(force) {
    const root = $('code-root');
    if (!root) return;
    const now = Date.now();
    if (!force && now - lastRender < 400) return;
    lastRender = now;
    showNav();
    if (!ownerOnly()) {
      root.innerHTML = '<p class="muted">Solo el dueño (iphuboficial@gmail.com). Si sos el dueño y ves esto, cerrá sesión y volvé a entrar.</p>';
      return;
    }
    try {
      if (tab === 'repos') await renderRepos(root);
      else if (tab === 'commits') await renderCommits(root);
      else if (tab === 'functions') await renderFunctions(root);
      else if (tab === 'query') await renderQuery(root);
      else if (tab === 'graph') await renderGraph(root);
      else if (tab === 'forum') await renderForum(root);
      else if (tab === 'share') await renderShare(root);
    } catch (e) {
      root.innerHTML = tabsHtml() + '<p class="muted">Error: ' + e.message + '</p>';
      bindTabs(root);
    }
  }

  function wrapShow() {
    if (wrapped) return;
    wrapped = true;
    const orig = window.showSection;
    if (!orig) return;
    window.showSection = function (id) {
      orig(id);
      showNav();
      if (id === 'code') render(true);
    };
  }
  wrapShow();
  var t = setInterval(function () {
    if (window.ME) { showNav(); clearInterval(t); }
  }, 300);
  setTimeout(function () { clearInterval(t); }, 20000);
})();
