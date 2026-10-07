/* Código / Code Query / Foro — solo dueño */
(function () {
  const $ = id => document.getElementById(id);
  let tab = 'repos';

  function ownerOnly() {
    return !!(window.ME && window.ME.isOwner);
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
      ['repos', 'Repositorios'],
      ['commits', 'Commits'],
      ['functions', 'Funciones'],
      ['query', 'Code Query'],
      ['graph', 'Grafo'],
      ['forum', 'Foro'],
      ['share', 'Compartir']
    ];
    return `<div class="code-tabs">${items.map(([k, l]) =>
      `<button type="button" data-ctab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`
    ).join('')}</div>`;
  }

  async function renderRepos(root) {
    const d = await api('/api/code/repos');
    const rows = (d.repos || []).map(r =>
      `<tr><td>${r.name}</td><td>${r.provider}</td><td>${r.status}</td><td>${r.commitCount || 0}</td><td>${r.functionCount || 0}</td>
      <td><button class="btn btn-sm g" data-sync="${r.id}">Sync</button>
      <button class="btn btn-sm g" data-del="${r.id}">Quitar</button></td></tr>`
    ).join('') || '<tr><td colspan="6">Sin repositorios</td></tr>';
    root.innerHTML = tabsHtml() + `
      <div class="code-panel on">
        <div class="tool-form" style="margin-bottom:.6rem">
          <input id="cr-name" placeholder="nombre repo" style="min-width:140px">
          <input id="cr-url" placeholder="URL (opcional)" style="min-width:180px">
          <select id="cr-prov"><option value="github">GitHub</option><option value="gitlab">GitLab</option><option value="bitbucket">Bitbucket</option><option value="private">Privado</option><option value="internal">Espejo interno</option></select>
          <button class="btn btn-sm btn-primary" id="cr-add" type="button">Conectar</button>
        </div>
        <div class="table-wrap"><table class="code-table"><thead><tr><th>Nombre</th><th>Proveedor</th><th>Estado</th><th>Commits</th><th>Funciones</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <p class="muted small">Dual repo: marcá uno como principal al conectar. Credenciales mínimas; revocá con Quitar.</p>
      </div>`;
    root.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { tab = b.getAttribute('data-ctab'); render(); });
    const add = $('cr-add');
    if (add) add.onclick = async () => {
      try {
        await api('/api/code/repos', { method: 'POST', body: { name: $('cr-name').value, url: $('cr-url').value, provider: $('cr-prov').value, primary: true } });
        if (typeof toast === 'function') toast('Repositorio conectado');
        render();
      } catch (e) { if (typeof toast === 'function') toast(e.message, true); }
    };
    root.querySelectorAll('[data-sync]').forEach(b => b.onclick = async () => {
      try { await api('/api/code/repos/' + b.getAttribute('data-sync') + '/sync', { method: 'POST' }); toast('Sincronizado'); render(); } catch (e) { toast(e.message, true); }
    });
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      try { await api('/api/code/repos/' + b.getAttribute('data-del'), { method: 'DELETE' }); render(); } catch (e) { toast(e.message, true); }
    });
  }

  async function renderCommits(root) {
    const d = await api('/api/code/commits');
    const rows = (d.commits || []).map(c =>
      `<tr><td><code>${c.sha}</code></td><td>${c.message}</td><td>${c.author}</td><td>${c.branch}</td><td>${(c.functions || []).join(', ')}</td><td>${c.risk || '-'}</td></tr>`
    ).join('') || '<tr><td colspan="6">Sin commits</td></tr>';
    root.innerHTML = tabsHtml() + `
      <div class="tool-form" style="margin-bottom:.6rem">
        <input id="cq" placeholder="Buscar autor, archivo, función, mensaje…" style="min-width:260px">
        <button class="btn btn-sm g" id="cq-go" type="button">Buscar</button>
      </div>
      <div class="table-wrap"><table class="code-table"><thead><tr><th>SHA</th><th>Mensaje</th><th>Autor</th><th>Branch</th><th>Funciones</th><th>Riesgo</th></tr></thead>
      <tbody id="cq-body">${rows}</tbody></table></div>`;
    root.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { tab = b.getAttribute('data-ctab'); render(); });
    $('cq-go').onclick = async () => {
      const q = $('cq').value;
      const d2 = await api('/api/code/commits?q=' + encodeURIComponent(q));
      $('cq-body').innerHTML = (d2.commits || []).map(c =>
        `<tr><td><code>${c.sha}</code></td><td>${c.message}</td><td>${c.author}</td><td>${c.branch}</td><td>${(c.functions || []).join(', ')}</td><td>${c.risk || '-'}</td></tr>`
      ).join('') || '<tr><td colspan="6">Sin resultados</td></tr>';
    };
  }

  async function renderFunctions(root) {
    const d = await api('/api/code/functions');
    const rows = (d.functions || []).map(f =>
      `<tr data-fid="${f.id}" style="cursor:pointer"><td>${f.name}</td><td>${f.file}:${f.line}</td><td>${f.module}</td><td>${f.complexity}</td><td>${(f.deps || []).join(', ')}</td><td>${f.secrets ? 'sí' : 'no'}</td></tr>`
    ).join('') || '<tr><td colspan="6">Sin funciones</td></tr>';
    root.innerHTML = tabsHtml() + `
      <div class="table-wrap"><table class="code-table"><thead><tr><th>Función</th><th>Archivo</th><th>Módulo</th><th>Complejidad</th><th>Deps</th><th>Secretos</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div id="fn-detail" class="card glass" style="margin-top:.8rem;display:none"></div>`;
    root.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { tab = b.getAttribute('data-ctab'); render(); });
    root.querySelectorAll('[data-fid]').forEach(tr => tr.onclick = async () => {
      const d2 = await api('/api/code/functions/' + tr.getAttribute('data-fid'));
      const f = d2.function;
      const box = $('fn-detail');
      box.style.display = '';
      box.innerHTML = `<h3>${f.name}</h3>
        <p><code>${f.signature}</code></p>
        <p class="muted small">${f.file}:${f.line} · módulo ${f.module} · complejidad ${f.complexity} · tamaño ${f.size}</p>
        <p><strong>Entrantes:</strong> ${(f.callsIn || []).join(', ') || '-'} · <strong>Salientes:</strong> ${(f.callsOut || []).join(', ') || '-'}</p>
        <p><strong>Deps:</strong> ${(f.deps || []).join(', ')} · DB:${f.dbAccess ? 'sí' : 'no'} API:${f.apiAccess ? 'sí' : 'no'} Red:${f.netAccess ? 'sí' : 'no'} Secretos:${f.secrets ? 'sí' : 'no'}</p>
        <p><strong>Params:</strong> ${(f.params || []).join(', ')} · <strong>Tags:</strong> ${(f.tags || []).join(', ')}</p>`;
    });
  }

  async function renderQuery(root) {
    root.innerHTML = tabsHtml() + `
      <div class="tool-form">
        <select id="qe-ent"><option value="functions">Funciones</option><option value="commits">Commits</option><option value="files">Archivos</option></select>
        <input id="qe-name" placeholder="filtro nombre/mensaje">
        <input id="qe-tag" placeholder="tag">
        <label class="muted small"><input type="checkbox" id="qe-sec"> solo secretos</label>
        <select id="qe-sort"><option value="">orden</option><option value="complexity">complejidad</option><option value="size">tamaño</option></select>
        <button class="btn btn-sm btn-primary" id="qe-run" type="button">Ejecutar</button>
        <button class="btn btn-sm g" id="qe-save" type="button">Guardar consulta</button>
      </div>
      <pre id="qe-out" class="muted small" style="margin-top:.7rem;white-space:pre-wrap;max-height:420px;overflow:auto"></pre>`;
    root.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { tab = b.getAttribute('data-ctab'); render(); });
    async function run() {
      const body = {
        entity: $('qe-ent').value,
        filters: { name: $('qe-name').value, tag: $('qe-tag').value, secrets: $('qe-sec').checked },
        sort: $('qe-sort').value
      };
      const d = await api('/api/code/query', { method: 'POST', body });
      $('qe-out').textContent = JSON.stringify(d, null, 2);
      return body;
    }
    $('qe-run').onclick = () => run().catch(e => toast(e.message, true));
    $('qe-save').onclick = async () => {
      try {
        const body = await run();
        const name = prompt('Nombre de la consulta');
        if (!name) return;
        await api('/api/code/query/save', { method: 'POST', body: { name, ...body } });
        toast('Consulta guardada');
      } catch (e) { toast(e.message, true); }
    };
  }

  async function renderGraph(root) {
    const repos = await api('/api/code/repos');
    const id = (repos.repos && repos.repos[0] && repos.repos[0].id) || '';
    const d = id ? await api('/api/code/graph/' + id) : { graph: { nodes: [], edges: [] } };
    const g = d.graph || { nodes: [], edges: [] };
    root.innerHTML = tabsHtml() + `
      <p class="muted small">Repo: ${d.repoName || '-'}</p>
      <div class="table-wrap"><table class="code-table"><thead><tr><th>Nodo</th><th>Tipo</th><th>Crítico</th><th>Externo</th></tr></thead>
      <tbody>${(g.nodes || []).map(n => `<tr><td>${n.id}</td><td>${n.type}</td><td>${n.critical ? 'sí' : ''}</td><td>${n.external ? 'sí' : ''}</td></tr>`).join('')}</tbody></table></div>
      <p style="margin-top:.6rem"><strong>Enlaces</strong></p>
      <ul class="muted small">${(g.edges || []).map(e => `<li>${e.from} → ${e.to}</li>`).join('')}</ul>`;
    root.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { tab = b.getAttribute('data-ctab'); render(); });
  }

  async function renderForum(root) {
    const d = await api('/api/forum/posts');
    root.innerHTML = tabsHtml() + `
      <div class="tool-form">
        <input id="fp-title" placeholder="Título" style="min-width:180px">
        <select id="fp-cat"><option>seguridad</option><option>infraestructura</option><option>backend</option><option>frontend</option><option>apis</option><option>incidentes</option><option>revisiones</option></select>
        <button class="btn btn-sm btn-primary" id="fp-add" type="button">Publicar</button>
      </div>
      <textarea id="fp-body" rows="3" placeholder="Cuerpo" style="width:100%;margin:.5rem 0;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);color:inherit;border-radius:8px;padding:.5rem"></textarea>
      <div id="fp-list">${(d.posts || []).map(p =>
        `<article class="card glass" style="margin:.5rem 0"><h4>${p.title} <span class="muted small">[${p.category}]</span></h4>
        <p class="muted small">${p.authorName} · ${p.createdAt}</p><p>${p.body}</p></article>`
      ).join('') || '<p class="muted">Sin publicaciones</p>'}</div>`;
    root.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { tab = b.getAttribute('data-ctab'); render(); });
    $('fp-add').onclick = async () => {
      try {
        await api('/api/forum/posts', { method: 'POST', body: { title: $('fp-title').value, body: $('fp-body').value, category: $('fp-cat').value } });
        render();
      } catch (e) { toast(e.message, true); }
    };
  }

  async function renderShare(root) {
    root.innerHTML = tabsHtml() + `
      <p class="muted small">Generá una vista compartible (solo lectura). Secretos se ocultan en el payload.</p>
      <div class="tool-form">
        <select id="sh-type"><option value="query">Consulta</option><option value="graph">Grafo</option><option value="commit">Commit</option></select>
        <input id="sh-hours" type="number" placeholder="expira horas" style="width:120px">
        <button class="btn btn-sm btn-primary" id="sh-go" type="button">Crear enlace</button>
      </div>
      <p id="sh-out" class="muted small" style="margin-top:.6rem"></p>`;
    root.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { tab = b.getAttribute('data-ctab'); render(); });
    $('sh-go').onclick = async () => {
      try {
        const d = await api('/api/code/share', { method: 'POST', body: { type: $('sh-type').value, payload: { note: 'vista compartida' }, expiresHours: Number($('sh-hours').value) || 24, readOnly: true } });
        $('sh-out').textContent = 'Enlace: ' + location.origin + d.url;
      } catch (e) { toast(e.message, true); }
    };
  }

  async function render() {
    const root = $('code-root');
    if (!root) return;
    if (!ownerOnly()) {
      root.innerHTML = '<p class="muted">Este módulo está disponible solo para el dueño de la plataforma.</p>';
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
      root.innerHTML = tabsHtml() + `<p class="muted">Error: ${e.message}</p>`;
      root.querySelectorAll('[data-ctab]').forEach(b => b.onclick = () => { tab = b.getAttribute('data-ctab'); render(); });
    }
  }

  const orig = window.showSection;
  if (orig) {
    window.showSection = function (id) {
      orig(id);
      showNav();
      if (id === 'code') render();
    };
  }
  setInterval(showNav, 1500);
})();
