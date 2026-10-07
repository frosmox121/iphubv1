/* IPHub v3 — ranking, limpieza de sesión/login, XP por herramientas, rutas de herramientas, perfil */
(function () {
  const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];

  /* ---------- Limpieza del login / registro (captcha incluido) ---------- */
  const DEF_FORGOT = 'Ingresá el correo de tu cuenta. Te enviaremos un código de verificación para restablecer la contraseña.';
  function resetAuth() {
    qa('#auth-screen form').forEach(f => f.reset());
    ['login-code-g', 'forgot-code-g', 'forgot-pass-g', 'forgot-pass2-g'].forEach(id => q('#' + id)?.classList.add('hidden'));
    qa('#auth-screen .form-error').forEach(e => { e.classList.add('hidden'); e.textContent = ''; });
    LOGIN_STAGE = 0; PENDING_EMAIL = '';
    q('#login-submit-btn').textContent = 'Acceder a la Plataforma';
    q('#forgot-submit-btn').textContent = 'Enviar código';
    q('#forgot-info').textContent = DEF_FORGOT; q('#login-code-info').textContent = '';
    window.__resetForgot && window.__resetForgot();
    qa('.auth-form').forEach(f => f.classList.remove('active')); q('#login-form').classList.add('active');
    qa('.auth-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    refreshCaptcha('login'); refreshCaptcha('reg');
    qa('#auth-screen input').forEach(i => { if (i.type !== 'hidden') i.value = ''; });
  }
  const auth = q('#auth-screen');
  new MutationObserver(() => { if (!auth.classList.contains('hidden')) { resetAuth(); setTimeout(resetAuth, 150); } }).observe(auth, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pageshow', e => { if (e.persisted && !auth.classList.contains('hidden')) resetAuth(); });

  /* ---------- Limpieza de todo lo que dejó el usuario anterior ---------- */
  window.resetSession = function () {
    try { window.__chatReset && window.__chatReset(); } catch (_) {}
    try { clearInterval(QTIMER); QZ = null; } catch (_) {}
    q('#quiz-box')?.classList.add('hidden'); const r = q('#quiz-result'); if (r) { r.classList.add('hidden'); r.innerHTML = ''; }
    const d = q('#quiz-diff'); if (d) d.disabled = false;
    try { TFILES = []; renderFiles(); } catch (_) {}
    q('#contact-files-err')?.classList.add('hidden');
    q('#contact-form')?.reset();
    const fb = q('#feedback-text'); if (fb) fb.value = '';
    try { RATING = 0; paintStars(q('#stars'), 0); } catch (_) {}
    ['pw-cur', 'pw-new', 'pw-new2', 'del-pw', 'del-code'].forEach(id => { const e = q('#' + id); if (e) e.value = ''; });
    try { DEL_STAGE = 0; } catch (_) {}
    q('#del-code-g')?.classList.add('hidden'); const db = q('#del-btn'); if (db) db.textContent = 'Eliminar mi cuenta';
    try { AVATAR_PENDING = undefined; } catch (_) {}
    q('#avatar-pending') && (q('#avatar-pending').style.display = 'none'); q('#save-profile-btn')?.classList.remove('pulse');
    const gs = q('#global-search'); if (gs) gs.value = '';
    try { clearToolState(); } catch (_) {}
  };
  new MutationObserver(() => { if (q('#app').classList.contains('hidden')) resetSession(); }).observe(q('#app'), { attributes: true, attributeFilter: ['class'] });

  // Al iniciar sesión: idioma del perfil
  const _enter = enterApp;
  enterApp = async function () { await _enter(); try { window.IPHUB_applyUser && IPHUB_applyUser(ME); } catch (_) {} };

  /* ---------- Tocar el recuadro de usuario → Mi cuenta ---------- */
  q('#user-pill')?.addEventListener('click', e => {
    if (e.target.closest('#acct-switch, #acct-menu')) return;
    showSection('account'); history.pushState({}, '', '/cuenta');
  });

  /* ---------- Salir de secciones: limpiar resultado del quiz / foto sin guardar ---------- */
  new MutationObserver(() => {
    if (!q('#learn').classList.contains('active')) { const r = q('#quiz-result'); if (r && !r.classList.contains('hidden')) { r.classList.add('hidden'); r.innerHTML = ''; } }
  }).observe(q('#learn'), { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => {
    if (!q('#account').classList.contains('active') && typeof AVATAR_PENDING !== 'undefined' && AVATAR_PENDING !== undefined) {
      AVATAR_PENDING = undefined; applyAvatar(ME && ME.avatar, true);
      const p = q('#avatar-pending'); if (p) p.style.display = 'none'; q('#save-profile-btn')?.classList.remove('pulse');
    }
  }).observe(q('#account'), { attributes: true, attributeFilter: ['class'] });

  /* ---------- +1 XP por herramienta usada ---------- */
  const _api = api;
  api = async function (path, opts) {
    const r = await _api(path, opts);
    if (/^\/api\/(tools\/(?!speedtest\/(download|upload))|devices\/discover)/.test(path)) { if (r && r.xp) { xpPop(r.xp); if (r.xp.gain) setTimeout(refreshProgress, 150); } }
    return r;
  };
  function xpPop(x) {
    const d = document.createElement('div'); d.className = 'xp-pop' + (x.gain ? '' : ' wait'); d.setAttribute('data-no-i18n', '');
    const sec = Math.ceil((x.wait || 0) / 1000);
    d.textContent = x.gain ? '+1 XP' : '+0 XP · ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    document.body.appendChild(d); setTimeout(() => d.remove(), 1900);
  }

  /* ---------- Una URL por herramienta (/herramientas/puertos …) ---------- */
  qa('.tool-tab').forEach(t => t.addEventListener('click', () => {
    if (window.__routing) return;
    history.pushState({}, '', '/herramientas/' + t.dataset.slug);
  }));

  /* ---------- Leaderboard ---------- */
  const esc2 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TIERS = [[150, 'Leyenda', '#f0abfc'], [100, 'Maestro', '#fbbf24'], [60, 'Experto', '#c084fc'], [30, 'Avanzado', '#818cf8'], [10, 'Técnico', '#22d3ee'], [1, 'Novato', '#8b98b8']];
  const tier = lv => TIERS.find(t => lv >= t[0]);
  const ini = n => String(n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const av = u => `<div class="avatar ${u.avatar ? 'has-img' : ''}" ${u.avatar ? `style="background-image:url(${u.avatar})"` : ''}>${u.avatar ? '' : esc2(ini(u.name))}</div>`;
  const badge = lv => { const t = tier(lv); return `<span class="lb-lv" style="--c:${t[2]}">Nv. ${lv}</span><span class="lb-tier" style="color:${t[2]}">${t[1]}</span>`; };
  const bar = u => `<div class="lb-bar"><i style="width:${Math.min(100, Math.round(u.xp / Math.max(1, u.need) * 100))}%"></i></div>`;
  const nf = n => Number(n).toLocaleString();
  async function loadLB() {
    if (!TOKEN) return;
    try {
      const d = await api('/api/leaderboard');
      const me = d.me;
      q('#lb-me').innerHTML = me ? `<div class="lb-me-rank">#${me.rank}<small>de ${d.total}</small></div>
        <div class="lb-me-body"><div class="lb-me-name">${av(me)}<strong>${esc2(me.name)}</strong> ${badge(me.level)}</div>${bar(me)}
        <p class="muted small">${nf(me.xp)} / ${nf(me.need)} XP para el nivel ${Math.min(150, me.level + 1)} · ${nf(me.score)} XP totales</p>
        <p class="lb-gap">${me.rank === 1 ? '👑 ¡Sos el #1! Seguí sumando XP para defender tu corona.' : `Te faltan <b>${nf(me.gap)} XP</b> para superar a <b>${esc2(me.above)}</b> y subir al #${me.rank - 1}.`}</p></div>` : '';
      const top = d.top, order = [1, 0, 2].filter(i => top[i]);
      q('#lb-podium').innerHTML = order.map(i => { const u = top[i]; return `<div class="pod pod-${u.rank} ${u.me ? 'me' : ''}"><div class="pod-medal">${['🥇', '🥈', '🥉'][u.rank - 1]}</div>${av(u)}<strong>${esc2(u.name)}</strong>${badge(u.level)}<span class="pod-xp">${nf(u.score)} XP</span></div>`; }).join('');
      const row = u => `<div class="lb-row ${u.me ? 'me' : ''}"><span class="lb-rk">${u.rank}</span>${av(u)}<div class="lb-info"><strong>${esc2(u.name)}${u.me ? ' <em>(vos)</em>' : ''}</strong>${bar(u)}</div><div class="lb-right">${badge(u.level)}<span class="muted small">${nf(u.score)} XP</span></div></div>`;
      let html = top.slice(3).map(row).join('');
      if (me && me.rank > top.length) html += '<div class="lb-dots">⋯</div>' + row(me);
      q('#lb-list').innerHTML = html || '<p class="muted">Todavía no hay más usuarios. ¡Invitá a tus amigos a competir!</p>';
    } catch (e) { q('#lb-list').innerHTML = `<p class="form-error">${esc2(e.message)}</p>`; }
  }
  let lbT = null;
  new MutationObserver(() => {
    clearInterval(lbT);
    if (q('#leaderboard').classList.contains('active')) { loadLB(); lbT = setInterval(loadLB, 30000); }
  }).observe(q('#leaderboard'), { attributes: true, attributeFilter: ['class'] });
})();

// Sesión ya guardada al abrir la página: aplicar idioma del perfil
if (typeof TOKEN !== 'undefined' && TOKEN) { const t = setInterval(() => { if (typeof ME !== 'undefined' && ME) { clearInterval(t); try { IPHUB_applyUser(ME); } catch (_) {} } }, 250); setTimeout(() => clearInterval(t), 15000); }

/* ---------- Ojo para mostrar / ocultar contraseña (login, registro, recuperar, cuenta) ---------- */
(function pwEyes() {
  const SV = 'viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const EYE = `<svg ${SV}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF = `<svg ${SV}><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>`;
  const paint = (b, shown) => { // contraseña oculta -> ojo tachado; visible -> ojo normal
    b.innerHTML = shown ? EYE : EYE_OFF;
    const t = shown ? 'Ocultar contraseña' : 'Mostrar contraseña'; b.title = t; b.setAttribute('aria-label', t); b.setAttribute('aria-pressed', shown ? 'true' : 'false');
  };
  function add(inp) {
    if (inp.dataset.pwEye) return; inp.dataset.pwEye = '1';
    const w = document.createElement('div'); w.className = 'pw-wrap'; inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pw-eye'; b.tabIndex = 0; paint(b, false); w.appendChild(b);
    b.addEventListener('mousedown', e => e.preventDefault()); // no le saca el foco al campo
    b.addEventListener('click', () => {
      const shown = inp.type === 'password'; inp.type = shown ? 'text' : 'password'; paint(b, shown);
      try { inp.focus({ preventScroll: true }); const n = inp.value.length; inp.setSelectionRange(n, n); } catch (_) {}
    });
    inp.addEventListener('pwreset', () => { inp.type = 'password'; paint(b, false); });
  }
  const scan = () => document.querySelectorAll('input[type=password]').forEach(add);
  const reset = () => document.querySelectorAll('input[data-pw-eye]').forEach(i => i.dispatchEvent(new Event('pwreset')));
  scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  // al entrar/salir de la sesión o resetear un formulario, las contraseñas vuelven a quedar ocultas
  ['#auth-screen', '#app'].forEach(sel => { const el = document.querySelector(sel); if (el) new MutationObserver(reset).observe(el, { attributes: true, attributeFilter: ['class'] }); });
  document.addEventListener('reset', () => setTimeout(reset, 0), true);
})();
