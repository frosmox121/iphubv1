/* Accesibilidad (todos), modo embebido (todos), Plan y Estudio modular (suscripción: solo cuenta oficial). */
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (m, bad) => { try { toast(m, bad); } catch (_) { alert(m); } };
  const SEC_NAME = { dashboard: 'Dashboard', topology: 'Topología', tools: 'Herramientas', audit: 'Auditoría', learn: 'Aprender', leaderboard: 'Ranking', support: 'Soporte', empresa: 'Empresa', manual: 'Manual', account: 'Mi Cuenta' };

  // ---------- Modo embebido: ?embed=1 ----------
  if (new URLSearchParams(location.search).get('embed') === '1') sessionStorage.setItem('iphub_embed', '1');
  if (sessionStorage.getItem('iphub_embed') === '1') document.documentElement.classList.add('embed');

  // ---------- Accesibilidad ----------
  const A_DEF = { cb: 'none', size: 100, contrast: false, dyslexia: false, spacing: false, motion: false, links: false, focus: false };
  let A = { ...A_DEF }; try { A = { ...A_DEF, ...JSON.parse(localStorage.getItem('iphub_a11y') || '{}') }; } catch (_) {}
  const CB = { protanopia: '.567 .433 0 0 0 .558 .442 0 0 0 0 .242 .758 0 0 0 0 0 1 0', deuteranopia: '.625 .375 0 0 0 .7 .3 0 0 0 0 .3 .7 0 0 0 0 0 1 0',
    tritanopia: '.95 .05 0 0 0 0 .433 .567 0 0 0 .475 .525 0 0 0 0 0 1 0', achromatopsia: '.299 .587 .114 0 0 .299 .587 .114 0 0 .299 .587 .114 0 0 0 0 0 1 0' };
  function injectBase() {
    if ($('#a11y-svg')) return;
    const d = document.createElement('div'); d.id = 'a11y-svg'; d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    d.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${Object.entries(CB).map(([k, v]) => `<filter id="cb-${k}"><feColorMatrix type="matrix" values="${v}"/></filter>`).join('')}</svg>`;
    document.body.appendChild(d);
  }
  function applyA() {
    injectBase(); const h = document.documentElement, set = (c, on) => h.classList.toggle(c, !!on);
    h.style.fontSize = A.size + '%'; h.style.filter = A.cb !== 'none' ? `url(#cb-${A.cb})` : '';
    set('a11y-contrast', A.contrast); set('a11y-dys', A.dyslexia); set('a11y-space', A.spacing); set('a11y-nomotion', A.motion); set('a11y-links', A.links); set('a11y-focus', A.focus);
    localStorage.setItem('iphub_a11y', JSON.stringify(A));
  }
  function a11yPanel() {
    if ($('#a11y-fab')) return;
    const fab = document.createElement('button'); fab.id = 'a11y-fab'; fab.type = 'button'; fab.title = 'Configuración de accesibilidad'; fab.setAttribute('aria-label', 'Configuración de accesibilidad');
    fab.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M19.4 13.1a7.6 7.6 0 0 0 .06-1.1 7.6 7.6 0 0 0-.06-1.1l1.7-1.3-1.5-2.6-2 .7a7 7 0 0 0-1.9-1.1l-.3-2.1h-3l-.3 2.1a7 7 0 0 0-1.9 1.1l-2-.7-1.5 2.6 1.7 1.3a7.6 7.6 0 0 0 0 2.2l-1.7 1.3 1.5 2.6 2-.7a7 7 0 0 0 1.9 1.1l.3 2.1h3l.3-2.1a7 7 0 0 0 1.9-1.1l2 .7 1.5-2.6-1.7-1.3z"/></svg>';
    const box = document.createElement('div'); box.id = 'a11y-box'; box.className = 'hidden'; box.setAttribute('data-no-i18n', '');
    const host = document.querySelector('#lang-top') || document.querySelector('#lang-auth');
    if (host && host.parentElement) host.parentElement.insertBefore(fab, host);
    else document.body.append(fab);
    document.body.append(box);
    const draw = () => {
      const sw = (k, l) => `<label class="a11y-row"><input type="checkbox" data-k="${k}" ${A[k] ? 'checked' : ''}> ${l}</label>`;
      box.innerHTML = `<h4>Accesibilidad <button type="button" id="a11y-x" aria-label="Cerrar">✕</button></h4>
        <label class="tm-lbl">Daltonismo</label><select id="a11y-cb" class="tm-in"><option value="none">Sin filtro</option><option value="protanopia">Protanopía (rojo)</option><option value="deuteranopia">Deuteranopía (verde)</option><option value="tritanopia">Tritanopía (azul)</option><option value="achromatopsia">Escala de grises</option></select>
        <label class="tm-lbl" style="margin-top:.7rem">Tamaño del texto: <b id="a11y-sv">${A.size}%</b></label><input type="range" id="a11y-size" min="90" max="200" step="10" value="${A.size}" style="width:100%">
        ${sw('contrast', 'Alto contraste')}${sw('dyslexia', 'Fuente amigable (dislexia)')}${sw('spacing', 'Más espacio entre letras y líneas')}${sw('motion', 'Reducir animaciones')}${sw('links', 'Subrayar enlaces')}${sw('focus', 'Resaltar foco del teclado')}
        <button type="button" class="btn btn-sm" id="a11y-reset" style="margin-top:.6rem">Restablecer</button>`;
      $('#a11y-cb').value = A.cb;
    };
    box.onchange = e => { const t = e.target; if (t.id === 'a11y-cb') A.cb = t.value; else if (t.dataset.k) A[t.dataset.k] = t.checked; applyA(); };
    box.oninput = e => { if (e.target.id === 'a11y-size') { A.size = +e.target.value; $('#a11y-sv').textContent = A.size + '%'; applyA(); } };
    box.onclick = e => { if (e.target.id === 'a11y-x') box.classList.add('hidden'); if (e.target.id === 'a11y-reset') { A = { ...A_DEF }; applyA(); draw(); } };
    fab.onclick = () => { draw(); box.classList.toggle('hidden'); };
  }
  document.addEventListener('DOMContentLoaded', () => { a11yPanel(); applyA(); }); if (document.readyState !== 'loading') { a11yPanel(); applyA(); }

  // ---------- Estudio: aplicar un diseño (datos validados en el servidor) ----------
  const FONTS = { system: '"Segoe UI",system-ui,-apple-system,sans-serif', serif: 'Georgia,"Times New Roman",serif', mono: 'ui-monospace,"Cascadia Mono",Consolas,monospace', rounded: '"Trebuchet MS","Nunito",system-ui,sans-serif' };
  function applyLayout(l) {
    let st = $('#studio-style'); if (!st) { st = document.createElement('style'); st.id = 'studio-style'; document.head.appendChild(st); }
    if (!l) { st.textContent = ''; $$('.nav-item').forEach(n => { n.style.order = ''; n.dataset.stHide = ''; }); return; }
    const pad = { compact: '.6rem', normal: '1.2rem', cozy: '1.8rem' }[l.density];
    st.textContent = `:root{--accent:${l.accent};--accent2:${l.accent2};--bg:${l.bg};--radius:${l.radius}px;--radius-sm:${Math.round(l.radius * .7)}px;--font:${FONTS[l.font]}}
      .section{padding-top:${pad}!important}.card{margin-bottom:${l.density === 'compact' ? '.5rem' : '1rem'}}` +
      (l.nav === 'hidden' ? `.sidebar{display:none}.main{margin-left:0!important}` : '') + (l.hidden.length ? l.hidden.map(h => `.nav-item[data-section="${h}"]{display:none!important}`).join('') : '');
    $$('.nav-item[data-section]').forEach(n => { const i = l.order.indexOf(n.dataset.section); n.style.order = i < 0 ? 99 : i; });
  }
  window.iphubApplyLayout = applyLayout;

  // ---------- Plan y Estudio ----------
  let SUB = null, ST = null, DRAFT = null;
  const DEF_LAYOUT = { accent: '#22d3ee', accent2: '#818cf8', bg: '#0a0f1e', radius: 14, density: 'normal', font: 'system', nav: 'left', order: [], hidden: [] };
  async function boot() {
    if (!window.ME || $('#studio')) return;
    try { SUB = await api('/api/sub/me'); } catch (_) { return; }
    const a = document.createElement('a'); a.href = '/plan'; a.className = 'nav-item'; a.dataset.section = 'studio'; a.innerHTML = '<span class="nav-icon"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"/></svg></span> Plan y Estudio';
    const acc = $('.nav-item[data-section="account"]'); acc.parentNode.insertBefore(a, acc);
    a.onclick = e => { e.preventDefault(); showSection('studio'); };
    const sec = document.createElement('section'); sec.id = 'studio'; sec.className = 'section'; sec.setAttribute('data-no-i18n', '');
    sec.innerHTML = '<div class="section-header"><h2>Plan y Estudio</h2><p>Funciones de suscripción. Por ahora solo la cuenta oficial las usa, para cuidar recursos del servidor.</p></div><div id="studio-root"></div>';
    $('#empresa').parentNode.appendChild(sec); try { UII.studio = 2; } catch (_) {}
    sec.addEventListener('click', onClick); sec.addEventListener('input', onInput);
    if (SUB.plan === 'admin') { try { ST = await api('/api/studio'); applyActive(); } catch (_) {} }
    const o = window.showSection; window.showSection = function (id) { o(id); if (id === 'studio') draw(); };
  }
  setInterval(() => { if (window.ME && !$('#studio')) boot(); if (!window.ME && $('#studio')) { $('#studio').remove(); $('.nav-item[data-section="studio"]')?.remove(); applyLayout(null); SUB = ST = null; } }, 900);
  function applyActive() { const s = ST && ST.active ? ST.slots[ST.active - 1] : null; applyLayout(s ? s.layout : null); }

  function draw() {
    const root = $('#studio-root'); if (!root || !SUB) return; const admin = SUB.plan === 'admin';
    const cat = SUB.features.map(f => `<div class="plan-card ${f.enabled ? 'on' : ''}"><b>${esc(f.name)}</b><p class="muted small">${esc(f.desc)}</p><span class="nl-badge ${f.enabled ? 'on' : f.ready ? 'warn' : ''}">${f.enabled ? 'Activo' : f.ready ? 'Solo cuenta oficial' : f.admin ? 'En desarrollo · cuenta oficial' : 'En desarrollo'}</span></div>`).join('');
    let html = `<div class="card glass"><div class="nl-head"><h3>Tu plan</h3><span class="nl-badge ${admin ? 'on' : ''}">${admin ? 'Administrador (cuenta oficial)' : 'Gratis'}</span></div><div class="plan-grid">${cat}</div></div>`;
    if (admin && ST) {
      const d = DRAFT || (DRAFT = JSON.parse(JSON.stringify(ST.active ? ST.slots[ST.active - 1].layout : DEF_LAYOUT))), order = d.order.length ? d.order : ST.sections;
      const ord = [...order, ...ST.sections.filter(s => !order.includes(s))];
      html += `<div class="card glass tm-card"><h3>Espacios</h3><p class="muted small">El espacio 0 es la página original de IPHub y no se toca. Podés guardar hasta 3 diseños propios.</p><div class="tm-row">
        <button class="btn ${ST.active === 0 ? 'btn-primary' : ''}" data-a="act" data-n="0" type="button">0 · IPHub (default)</button>
        ${[1, 2, 3].map(n => { const s = ST.slots[n - 1]; return `<button class="btn ${ST.active === n ? 'btn-primary' : ''}" data-a="act" data-n="${n}" type="button" ${s ? '' : 'disabled'}>${n} · ${s ? esc(s.name) : 'vacío'}</button>`; }).join('')}</div></div>
      <div class="card glass tm-card"><h3>Pedile un cambio a la IA</h3><div class="tm-row"><input class="tm-in" id="st-prompt" maxlength="400" placeholder="Ej: tema verde oscuro, bordes redondeados, ocultá Ranking y poné Topología primero"><button class="btn btn-primary" data-a="ai" type="button">Generar</button></div><p class="muted small">La IA solo puede mover los bloques de abajo; no escribe código.</p></div>
      <div class="card glass tm-card"><h3>Bloques del diseño</h3><div class="tm-grid">
        <div><span class="tm-lbl">Colores</span><div class="tm-row"><input type="color" data-f="accent" value="${d.accent}"><input type="color" data-f="accent2" value="${d.accent2}"><input type="color" data-f="bg" value="${d.bg}"></div>
          <span class="tm-lbl" style="margin-top:.7rem">Bordes: ${d.radius}px</span><input type="range" data-f="radius" min="0" max="28" value="${d.radius}" style="width:100%">
          <span class="tm-lbl" style="margin-top:.7rem">Densidad</span><select class="tm-in" data-f="density">${['compact', 'normal', 'cozy'].map(v => `<option ${d.density === v ? 'selected' : ''} value="${v}">${{ compact: 'Compacta', normal: 'Normal', cozy: 'Amplia' }[v]}</option>`).join('')}</select>
          <span class="tm-lbl" style="margin-top:.7rem">Tipografía</span><select class="tm-in" data-f="font">${['system', 'serif', 'mono', 'rounded'].map(v => `<option ${d.font === v ? 'selected' : ''} value="${v}">${{ system: 'Sistema', serif: 'Serif', mono: 'Monoespaciada', rounded: 'Redondeada' }[v]}</option>`).join('')}</select>
          <span class="tm-lbl" style="margin-top:.7rem">Menú lateral</span><select class="tm-in" data-f="nav"><option value="left" ${d.nav === 'left' ? 'selected' : ''}>Visible</option><option value="hidden" ${d.nav === 'hidden' ? 'selected' : ''}>Oculto (modo embebido/pantalla chica)</option></select></div>
        <div><span class="tm-lbl">Secciones: orden y visibilidad</span>${ord.map((s, i) => `<div class="tm-row" style="align-items:center;margin:.25rem 0"><label style="flex:1;display:flex;gap:.5rem"><input type="checkbox" data-h="${s}" ${d.hidden.includes(s) ? '' : 'checked'} ${s === 'account' ? 'disabled' : ''}> ${esc(SEC_NAME[s] || s)}</label><button class="btn btn-sm" data-a="up" data-s="${s}" type="button" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-sm" data-a="down" data-s="${s}" type="button" ${i === ord.length - 1 ? 'disabled' : ''}>↓</button></div>`).join('')}</div></div>
        <div class="tm-row"><button class="btn" data-a="prev" type="button">Vista previa</button>${[1, 2, 3].map(n => `<button class="btn btn-primary" data-a="save" data-n="${n}" type="button">Guardar en espacio ${n}</button>`).join('')}<button class="btn" data-a="reset" type="button">Volver al default</button></div></div>`;
    }
    html += `<div class="card glass tm-card"><h3>Modo embebido</h3><p class="muted small">Para usar IPHub dentro de otra app o web (iframe, pestaña de Teams/Notion, ventana de escritorio):</p><code class="embed-code">&lt;iframe src="${esc(location.origin)}/home?embed=1" width="100%" height="700" style="border:0"&gt;&lt;/iframe&gt;</code><p class="muted small">Oculta el menú y la barra superior. Discord no permite iframes sueltos: requeriría su Embedded App SDK (no incluido todavía).</p></div>`;
    root.innerHTML = html;
  }
  function onInput(e) { const t = e.target; if (!DRAFT) return; if (t.dataset.f) { DRAFT[t.dataset.f] = t.dataset.f === 'radius' ? +t.value : t.value; if (t.type === 'range') draw(); } }
  async function onClick(e) {
    const b = e.target.closest('[data-a]'), h = e.target.dataset && e.target.dataset.h; if (h && DRAFT) { DRAFT.hidden = e.target.checked ? DRAFT.hidden.filter(x => x !== h) : [...DRAFT.hidden, h]; return; }
    if (!b) return; const a = b.dataset.a;
    const ordNow = () => { const o = DRAFT.order.length ? DRAFT.order : ST.sections; return [...o, ...ST.sections.filter(s => !o.includes(s))]; };
    try {
      if (a === 'act') { ST = await api('/api/studio', { method: 'PUT', body: { active: +b.dataset.n } }); DRAFT = null; applyActive(); draw(); say('Espacio activado'); }
      else if (a === 'up' || a === 'down') { const o = ordNow(), i = o.indexOf(b.dataset.s), j = a === 'up' ? i - 1 : i + 1; [o[i], o[j]] = [o[j], o[i]]; DRAFT.order = o; draw(); }
      else if (a === 'prev') { applyLayout(DRAFT); say('Vista previa aplicada (no guardada)'); }
      else if (a === 'reset') { DRAFT = null; ST = await api('/api/studio', { method: 'PUT', body: { active: 0 } }); applyActive(); draw(); }
      else if (a === 'save') { const n = +b.dataset.n, name = prompt('Nombre del espacio', (ST.slots[n - 1] && ST.slots[n - 1].name) || 'Mi diseño'); if (name === null) return;
        ST = await api('/api/studio', { method: 'PUT', body: { slot: n, name, layout: { ...DRAFT, order: ordNow() }, active: n } }); DRAFT = null; applyActive(); draw(); say('Diseño guardado y activado'); }
      else if (a === 'ai') { const p = $('#st-prompt').value.trim(); if (!p) return say('Escribí qué querés cambiar', true); b.disabled = true; b.textContent = 'Pensando…';
        try { const r = await api('/api/studio/ai', { method: 'POST', body: { prompt: p, current: { ...DRAFT, order: ordNow() } } }); DRAFT = r.layout; applyLayout(DRAFT); say('Propuesta aplicada en vista previa: guardala en un espacio si te gusta'); } finally { draw(); } }
    } catch (err) { say(err.message, true); }
  }
})();
