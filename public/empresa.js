/* Empresa, roles y topología conectada al exe. */
(function () {
  const PERM_LABEL = {
    dashboard: 'Dashboard', topology: 'Topología', tools: 'Herramientas',
    audit: 'Auditoría', learn: 'Aprender', ranking: 'Ranking', support: 'Soporte',
  };
  const $ = id => document.getElementById(id);
  let poll = null;

  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function applyAccess() {
    const owner = !!(ME && ME.isOwner);
    const nav = $('nav-empresa');
    if (nav) nav.hidden = !owner;
    const role = ME && ME.role;
    document.querySelectorAll('.nav-item[data-section]').forEach(a => {
      const sec = a.dataset.section;
      if (sec === 'empresa') return;
      if (sec === 'account') { a.hidden = false; return; }
      if (!role || owner) { a.hidden = false; return; }
      a.hidden = !(role.perms || []).includes(sec);
    });
    const pill = $('user-email');
    if (pill && ME) {
      const tag = owner ? 'Dueño' : (role ? role.name : '');
      pill.textContent = ME.email + (tag ? ' · ' + tag : '');
    }
  }

  const origShow = window.showSection;
  window.showSection = function (id) {
    const role = ME && ME.role;
    if (id === 'empresa' && !(ME && ME.isOwner)) id = 'dashboard';
    if (role && !ME.isOwner && id !== 'account' && id !== 'empresa' && !(role.perms || []).includes(id)) {
      if (typeof toast === 'function') toast('Tu rol no incluye esa sección');
      id = (role.perms || [])[0] || 'account';
    }
    origShow(id);
    if (id === 'topology') startTopo();
    else stopTopo();
    if (id === 'empresa') loadOrg();
  };

  function stopTopo() { if (poll) { clearInterval(poll); poll = null; } }

  async function startTopo() {
    await loadSnap();
    stopTopo();
    poll = setInterval(loadSnap, 8000);
  }

  function paintSnap(snap) {
    const box = $('agent-view');
    if (!box) return;
    if (!snap) {
      box.innerHTML = '<p class="muted">Todavía no hay una red del exe. Abrí IPHub.exe, iniciá sesión con esta cuenta (o Google/Discord) y esta sección se llena sola. También podés importar el archivo que exporta el exe.</p>';
      return;
    }
    const when = snap.updatedAt ? new Date(snap.updatedAt).toLocaleString() : '';
    const src = snap.source === 'archivo' ? 'Archivo importado' : 'Exe conectado';
    const rows = (snap.devices || []).map(d => `<tr><td>${esc(d.ip)}</td><td>${esc(d.mac)}</td><td>${esc(d.name || d.vendor || '—')}</td><td>${d.online ? 'En línea' : 'Fuera'}</td><td>${d.rtt == null ? '—' : esc(d.rtt)}</td><td>${esc((d.ports || []).map(p => p.port).join(', '))}</td></tr>`).join('');
    box.innerHTML = `<div class="agent-head"><strong>${src}</strong><span class="muted">${esc(snap.host || '')} ${snap.gateway ? '· gw ' + esc(snap.gateway) : ''} · ${esc(when)}</span></div>
      <div class="agent-stats"><span><b>${snap.online || 0}</b> en línea</span><span><b>${snap.offline || 0}</b> fuera</span><span><b>${(snap.devices || []).length}</b> equipos</span><span><b>${esc(snap.score || 0)}</b> score</span></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>IP</th><th>MAC</th><th>Nombre</th><th>Estado</th><th>RTT</th><th>Puertos</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Sin dispositivos en el último envío.</td></tr>'}</tbody></table></div>`;
    const list = $('device-list');
    if (list) {
      list.innerHTML = (snap.devices || []).map(d => `<div class="device-row"><strong>${esc(d.ip)}</strong> <span class="muted">${esc(d.name || d.vendor || '')}</span> <span>${d.online ? '●' : '○'}</span></div>`).join('') || '<p class="muted">Sin datos del exe.</p>';
    }
    drawMap(snap.devices || []);
  }

  function drawMap(devices) {
    const cv = $('topo-canvas'); if (!cv) return;
    const wrap = cv.parentElement;
    cv.width = wrap.clientWidth || 640; cv.height = 280;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const list = devices.slice(0, 28);
    if (!list.length) { ctx.fillStyle = '#8b98b8'; ctx.font = '14px sans-serif'; ctx.fillText('Sin nodos del exe todavía.', 16, 28); return; }
    const cx = cv.width / 2, cy = cv.height / 2;
    ctx.strokeStyle = 'rgba(34,211,238,.35)'; ctx.fillStyle = '#22d3ee';
    ctx.beginPath(); ctx.arc(cx, cy, 16, 0, 7); ctx.fill();
    list.forEach((d, i) => {
      const a = (Math.PI * 2 * i) / list.length - Math.PI / 2;
      const x = cx + Math.cos(a) * Math.min(cx, cy) * 0.72;
      const y = cy + Math.sin(a) * Math.min(cx, cy) * 0.72;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      ctx.beginPath(); ctx.fillStyle = d.online ? '#34d399' : '#64748b'; ctx.arc(x, y, 8, 0, 7); ctx.fill();
      ctx.fillStyle = '#e8eefc'; ctx.font = '11px sans-serif'; ctx.fillText(d.ip, x + 10, y + 4);
    });
  }

  async function loadSnap() {
    if (!TOKEN || !$('topology')?.classList.contains('active')) return;
    try { const d = await api('/api/agent/snapshot'); paintSnap(d.snapshot); }
    catch (e) { const box = $('agent-view'); if (box) box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  }

  $('topo-import')?.addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const d = await api('/api/agent/import', { method: 'POST', body: json });
      paintSnap(d.snapshot);
      if (typeof toast === 'function') toast('Red importada');
    } catch (err) { if (typeof toast === 'function') toast(err.message || 'Archivo inválido'); }
    e.target.value = '';
  });

  function permBoxes(selected) {
    return Object.keys(PERM_LABEL).map(k => `<label class="ck role-tick"><input type="checkbox" value="${k}" ${(selected || []).includes(k) ? 'checked' : ''}><span>${PERM_LABEL[k]}</span></label>`).join('');
  }

  async function loadOrg() {
    const root = $('empresa-root'); if (!root || !(ME && ME.isOwner)) return;
    root.innerHTML = '<p class="muted">Cargando empresa…</p>';
    let d;
    try { d = await api('/api/org'); } catch (e) { root.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    const max = Math.max(1, ...d.roles.map(r => r.members));
    root.innerHTML = `
      <div class="agent-stats"><span><b>${d.totals.roles}</b> roles</span><span><b>${d.totals.members}</b> personas</span><span><b>${d.totals.withAgent}</b> redes de exe</span></div>
      <div class="card glass" style="margin:1rem 0">
        <h3>Empresa</h3>
        <div class="tool-form"><input id="co-name" value="${esc(d.companyName)}"><button class="btn btn-primary" id="co-save" type="button">Guardar nombre</button></div>
      </div>
      <div class="card glass">
        <h3>Gráfico de roles</h3>
        <p class="muted small">Solo lo ves vos, como dueño.</p>
        ${d.roles.map(r => `<div class="share-row"><span>${esc(r.name)}</span><div class="share-bar"><i style="width:${Math.round(100 * r.members / max)}%"></i></div><b>${r.members}</b></div>`).join('') || '<p class="muted">Sin roles.</p>'}
        <div class="share-org">${d.roles.map(r => `<div><strong>${esc(r.name)}</strong><small>${r.members} persona(s)</small><em>${(r.perms || []).map(p => PERM_LABEL[p] || p).join(' · ')}</em></div>`).join('')}</div>
      </div>
      <div class="card glass role-create">
        <h3>Crear rol</h3>
        <p class="muted small">Elegí qué puede ver este rol. El tick confirma la opción.</p>
        <div class="input-group"><input id="role-name" placeholder="Nombre del rol"></div>
        <div class="input-group"><input id="role-desc" placeholder="Para qué sirve"></div>
        <div class="perm-grid" id="role-perms">${permBoxes(['dashboard', 'topology'])}</div>
        <button class="btn btn-primary" id="role-add" type="button">Agregar rol</button>
      </div>
      <div class="card glass role-list">
        <h3>Roles actuales</h3>
        ${d.roles.map(r => `<div class="role-card" data-id="${esc(r.id)}">
          <strong>${esc(r.name)}</strong> <span class="muted">${r.members} persona(s)</span>
          <p class="muted small">${esc(r.desc || '')}</p>
          <div class="perm-grid">${permBoxes(r.perms)}</div>
          <div class="tool-form">
            <button class="btn btn-accent btn-sm" type="button" data-save-role="${esc(r.id)}">Guardar</button>
            <button class="btn btn-glass btn-sm" type="button" data-share-role="${esc(r.id)}">Compartir</button>
            <button class="btn btn-glass btn-sm" type="button" data-del-role="${esc(r.id)}">Eliminar</button>
          </div>
        </div>`).join('') || '<p class="muted">Todavía no hay roles.</p>'}
        <button class="btn btn-accent" id="share-all" type="button" style="margin-top:.8rem">Compartir todo</button>
      </div>
      <div class="card glass" style="margin-top:1rem">
        <h3>Asignar correo a un rol</h3>
        <div class="tool-form">
          <input id="mem-email" type="email" placeholder="empleado@empresa.com">
          <input id="mem-name" placeholder="Nombre (opcional)">
          <select id="mem-role">${d.roles.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
          <button class="btn btn-primary" id="mem-add" type="button">Asignar</button>
        </div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th></th></tr></thead><tbody>
          ${d.members.map(m => { const r = d.roles.find(x => x.id === m.roleId); return `<tr><td>${esc(m.email)}</td><td>${esc(m.name || '')}</td><td>${esc(r ? r.name : '—')}</td><td><button class="btn btn-glass btn-sm" type="button" data-del-mem="${esc(m.email)}">Quitar</button></td></tr>`; }).join('') || '<tr><td colspan="4">Nadie asignado.</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card glass" style="margin-top:1rem">
        <h3>Enlaces compartidos</h3>
        ${(d.shares || []).map(s => `<div class="tool-form"><a href="/compartir/${esc(s.token)}" target="_blank">/compartir/${esc(s.token)}</a> <span class="muted">${s.scope === 'all' ? 'Todo' : 'Un rol'}${s.includeGraph ? ' · con gráfico' : ''}</span> <button class="btn btn-glass btn-sm" type="button" data-del-share="${esc(s.id)}">Revocar</button></div>`).join('') || '<p class="muted">Todavía no compartiste nada.</p>'}
      </div>`;
    wireOrg();
  }

  function checked(root) { return [...root.querySelectorAll('input:checked')].map(i => i.value); }

  async function share(body) {
    const graphs = confirm('¿Incluir gráficos en el enlace?');
    const names = confirm('¿Incluir nombres de las personas?');
    const d = await api('/api/org/shares', { method: 'POST', body: { ...body, includeGraph: graphs, includeNames: names } });
    const url = location.origin + d.url;
    try { await navigator.clipboard.writeText(url); } catch (_) {}
    if (typeof toast === 'function') toast('Enlace copiado');
    prompt('Compartí este enlace', url);
    loadOrg();
  }

  function wireOrg() {
    $('co-save').onclick = async () => { await api('/api/org', { method: 'PUT', body: { companyName: $('co-name').value } }); loadOrg(); };
    $('role-add').onclick = async () => {
      try {
        await api('/api/org/roles', { method: 'POST', body: { name: $('role-name').value, desc: $('role-desc').value, perms: checked($('role-perms')) } });
        loadOrg();
      } catch (e) { if (typeof toast === 'function') toast(e.message); }
    };
    $('mem-add').onclick = async () => {
      try {
        await api('/api/org/members', { method: 'POST', body: { email: $('mem-email').value, name: $('mem-name').value, roleId: $('mem-role').value } });
        loadOrg();
      } catch (e) { if (typeof toast === 'function') toast(e.message); }
    };
    $('share-all').onclick = () => share({ scope: 'all', label: 'Empresa completa' });
    document.querySelectorAll('[data-save-role]').forEach(b => b.onclick = async () => {
      const card = b.closest('.role-card');
      await api('/api/org/roles/' + b.dataset.saveRole, { method: 'PUT', body: { perms: checked(card) } });
      loadOrg();
    });
    document.querySelectorAll('[data-del-role]').forEach(b => b.onclick = async () => {
      if (!confirm('¿Eliminar este rol y sus asignaciones?')) return;
      await api('/api/org/roles/' + b.dataset.delRole, { method: 'DELETE' });
      loadOrg();
    });
    document.querySelectorAll('[data-share-role]').forEach(b => b.onclick = () => share({ scope: 'role', roleId: b.dataset.shareRole }));
    document.querySelectorAll('[data-del-mem]').forEach(b => b.onclick = async () => {
      await api('/api/org/members/' + encodeURIComponent(b.dataset.delMem), { method: 'DELETE' });
      loadOrg();
    });
    document.querySelectorAll('[data-del-share]').forEach(b => b.onclick = async () => {
      await api('/api/org/shares/' + b.dataset.delShare, { method: 'DELETE' });
      loadOrg();
    });
  }

  async function confirmLink() {
    const code = new URLSearchParams(location.search).get('conectar');
    if (!code || !TOKEN || confirmLink.done) return;
    confirmLink.done = true;
    try {
      await api('/api/agent/link/confirm', { method: 'POST', body: { code } });
      if (typeof toast === 'function') toast('Exe conectado a esta cuenta');
      history.replaceState({}, '', '/topologia');
    } catch (err) { if (typeof toast === 'function') toast(err.message || 'No se pudo conectar el exe'); }
  }
  function boot() {
    if (typeof ME === 'undefined' || !ME) return;
    applyAccess();
    confirmLink();
    if ($('topology')?.classList.contains('active')) startTopo();
  }
  setInterval(boot, 700);
  document.addEventListener('iphub-ready', boot);
})();
