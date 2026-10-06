/* =====================================================================
 * IPHub — features.js
 * Conecta con el backend todo lo que el HTML ya tenía pero app.js no:
 * velocidad (unidades), quiz + timers, tickets, reseñas, foto de perfil,
 * contraseña, eliminar cuenta, exportar auditoría, cambiar/agregar cuenta,
 * buscador, topología, chatbot, cookies y rutas (/home, /aprender, ...).
 * Se carga DESPUÉS de app.js y extra.js.
 * ===================================================================== */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMMSS = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- Velocidad: LAST / showSpeeds (app.js los usa pero no existían) ---------- */
const LAST = { dl: null, ul: null };
function showSpeeds() {
  const unit = (document.getElementById('speed-unit') || {}).value || 'Mbps';
  const conv = m => {
    if (m == null || !isFinite(m)) return '—';
    const v = { 'Mbps': m, 'Gbps': m / 1000, 'kbps': m * 1000, 'MB/s': m / 8, 'KB/s': m * 125 }[unit];
    return (v >= 100 ? v.toFixed(0) : v.toFixed(2)) + ' ' + unit;
  };
  const dl = document.getElementById('dl-speed'), ul = document.getElementById('ul-speed');
  if (dl) dl.textContent = conv(LAST.dl);
  if (ul) ul.textContent = conv(LAST.ul);
}
document.getElementById('speed-unit')?.addEventListener('change', showSpeeds);

/* ---------- Envolver enterApp para engancharse al inicio de sesión ---------- */
function afterEnter() {
  try { applyAvatar(ME && ME.avatar); } catch (_) {}
  try { syncQuiz(); loadTickets(); loadReviews(); loadTopo(); } catch (_) {}
  try { applyRoute(); } catch (_) {}
  showSpeeds();
}
const _enterApp = enterApp;
enterApp = async function () { try { resetSession(); } catch (_) {} await _enterApp(); afterEnter(); };
// Si había sesión guardada, app.js ya llamó a la enterApp original antes de cargar este archivo
if (TOKEN) { const t = setInterval(() => { if (ME) { clearInterval(t); afterEnter(); } }, 200); setTimeout(() => clearInterval(t), 15000); }

/* ---------- Guardar cuentas en el navegador (cambiar / agregar cuenta) ---------- */
const ACC_KEY = 'iphub_accounts';
const getAccs = () => { // solo cuentas válidas (con correo y sesión); se limpian las entradas rotas que mostraban un "?"
  let raw = []; try { raw = JSON.parse(localStorage.getItem(ACC_KEY) || '[]'); } catch (_) {}
  if (!Array.isArray(raw)) raw = [];
  const seen = new Set(), ok = raw.filter(a => a && typeof a.email === 'string' && /^\S+@\S+$/.test(a.email.trim()) && typeof a.token === 'string' && a.token && !seen.has(a.email.trim().toLowerCase()) && seen.add(a.email.trim().toLowerCase()));
  if (ok.length !== raw.length) { try { localStorage.setItem(ACC_KEY, JSON.stringify(ok)); } catch (_) {} }
  return ok;
};
const setAccs = a => localStorage.setItem(ACC_KEY, JSON.stringify(a));
function saveAccountLocal(u) {
  if (!u || !TOKEN || !u.email) return;
  const a = getAccs().filter(x => x.email !== u.email);
  a.unshift({ email: u.email, name: u.name || String(u.email).split('@')[0], token: TOKEN, provider: u.provider || 'credentials' });
  setAccs(a.slice(0, 6));
}
(function accountSwitcher() {
  const btn = document.getElementById('acct-switch'), menu = document.getElementById('acct-menu');
  if (!btn || !menu) return;
  const SV = 'viewBox="0 0 24 24" width="14" height="14"';
  const ICO = {
    credentials: `<svg ${SV} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8"/><path d="m16 7 3 3"/><path d="m14 9 2 2"/></svg>`,
    google: `<svg ${SV}><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5.1L1.3 17.2C3.3 21.2 7.3 24 12 24z"/><path fill="#FBBC05" d="M5.2 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3L1.3 6.8C.5 8.4 0 10.1 0 12s.5 3.6 1.3 5.2l3.9-2.9z"/><path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.3 0 3.3 2.8 1.3 6.8l3.9 2.9c.9-2.9 3.6-5 6.8-5z"/></svg>`,
    discord: `<svg ${SV} fill="#5865F2"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.9 3l-.2.4a18 18 0 0 1 4.5 2.3 18.6 18.6 0 0 0-16.4 0A18 18 0 0 1 8.3 3.4L8.1 3a19.8 19.8 0 0 0-4.4 1.4A20.4 20.4 0 0 0 .2 18.1a19.9 19.9 0 0 0 5.5 2.8l.5-.7a13 13 0 0 1-2.2-1.1l.5-.4a14.2 14.2 0 0 0 12.9 0l.5.4c-.7.4-1.4.8-2.2 1.1l.5.7a19.9 19.9 0 0 0 5.5-2.8 20.4 20.4 0 0 0-3.4-13.7zM8.7 15.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>`,
  };
  const LBL = { credentials: 'Inicio con credenciales', google: 'Inicio con Google', discord: 'Inicio con Discord' };
  const ini = n => String(n || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '·';
  const render = () => {
    const accs = getAccs();
    menu.innerHTML = accs.map(a => {
      const cur = ME && a.email === ME.email, pv = ICO[a.provider] ? a.provider : '';
      return `<button type="button" class="am-item${cur ? ' cur' : ''}" data-email="${esc(a.email)}"><span class="am-av" data-no-i18n>${esc(ini(a.name || a.email))}</span>
        <span class="am-txt"><strong data-no-i18n>${esc(a.name || a.email.split('@')[0])}</strong><small data-no-i18n>${esc(a.email)}</small>${pv ? `<em class="am-prov am-${pv}">${ICO[pv]}<span>${LBL[pv]}</span></em>` : ''}</span>
        ${cur ? '<svg class="am-ck" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : ''}</button>`;
    }).join('') + '<div class="am-sep"></div><button type="button" class="am-add" data-add="1"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span>Agregar otra cuenta</span></button>';
  };
  btn.addEventListener('click', e => { e.stopPropagation(); render(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.classList.add('hidden'); });
  menu.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    menu.classList.add('hidden');
    if (b.dataset.add) {
      TOKEN = null; localStorage.removeItem('iphub_token'); ME = null;
      document.getElementById('app').classList.add('hidden');
      document.getElementById('auth-screen').classList.remove('hidden');
      toast('Iniciá sesión con la otra cuenta; esta queda guardada');
      return;
    }
    const acc = getAccs().find(x => x.email === b.dataset.email);
    if (!acc || (ME && acc.email === ME.email)) return;
    const prev = TOKEN;
    try {
      TOKEN = acc.token; localStorage.setItem('iphub_token', TOKEN);
      await api('/api/auth/me');
      await enterApp(); toast('Cuenta cambiada a ' + acc.email);
    } catch (_) {
      setAccs(getAccs().filter(x => x.email !== acc.email));
      TOKEN = prev; if (prev) localStorage.setItem('iphub_token', prev);
      toast('La sesión de esa cuenta venció, iniciá sesión de nuevo', true);
    }
  });
})();

/* =====================================================================
 * QUIZ + TIMERS
 *  - Cuenta regresiva del cooldown (10 min) en #quiz-countdown
 *  - Timer por pregunta (25 s). Si se acaba, cuenta como incorrecta.
 * ===================================================================== */
const Q_SECONDS = 25;
let COOL_END = 0, QZ = null, QTIMER = null;

async function syncQuiz() {
  try {
    const p = await api('/api/progress');
    COOL_END = p.quizCooldown > 0 ? Date.now() + p.quizCooldown : 0;
  } catch (_) {}
  tickCooldown();
}
function tickCooldown() {
  const cd = document.getElementById('quiz-countdown'), start = document.getElementById('quiz-start'), note = document.getElementById('quiz-cooldown');
  if (!cd || !start) return;
  const left = COOL_END - Date.now();
  if (left > 0) {
    cd.textContent = fmtMMSS(left);
    start.disabled = true; start.textContent = 'Esperá el cooldown';
    if (note) note.textContent = 'Podés hacer un quiz cada 10 minutos.';
  } else {
    cd.textContent = '00:00';
    if (!QZ) { start.disabled = false; start.textContent = 'Iniciar quiz'; }
    if (note) note.textContent = 'Podés iniciar un quiz ahora';
  }
}
setInterval(tickCooldown, 1000);

document.getElementById('quiz-start')?.addEventListener('click', async () => {
  const btn = document.getElementById('quiz-start');
  btn.disabled = true; btn.textContent = 'Generando…';
  document.getElementById('quiz-result').classList.add('hidden');
  try {
    const d = await api('/api/quiz/generate', { method: 'POST', body: { difficulty: document.getElementById('quiz-diff').value, lang: window.IPHUB_LANG ? IPHUB_LANG() : 'es' } });
    QZ = { qs: d.questions, i: 0, ok: 0, diff: d.difficulty };
    document.getElementById('quiz-diff').disabled = true;
    btn.textContent = 'Quiz en curso…';
    showQuestion();
  } catch (e) {
    toast(e.message, true);
    if (/cooldown/i.test(e.message)) syncQuiz(); else { btn.disabled = false; btn.textContent = 'Iniciar quiz'; }
  }
});

function showQuestion() {
  clearInterval(QTIMER);
  const box = document.getElementById('quiz-box'); box.classList.remove('hidden');
  const q = QZ.qs[QZ.i]; let left = Q_SECONDS, answered = false;
  box.innerHTML = `<div class="quiz-card">
      <div style="display:flex;justify-content:space-between;gap:1rem" class="muted small">
        <span>Pregunta ${QZ.i + 1} de ${QZ.qs.length}</span><strong id="q-timer">⏱ ${left}s</strong></div>
      <h4 style="margin-top:.6rem" data-no-i18n>${esc(q.q)}</h4>
      <div class="quiz-opts">${q.opts.map((o, i) => `<button type="button" data-i="${i}" data-no-i18n>${esc(o)}</button>`).join('')}</div>
      <div class="quiz-feedback" id="q-fb"></div>
      <div style="margin-top:.8rem"><button type="button" class="btn btn-sm btn-primary hidden" id="q-next">${QZ.i + 1 === QZ.qs.length ? 'Ver resultado' : 'Siguiente'}</button></div>
    </div>`;
  const card = box.querySelector('.quiz-card'), btns = [...box.querySelectorAll('.quiz-opts button')], fb = box.querySelector('#q-fb'), next = box.querySelector('#q-next');
  const finish = (pick) => {
    if (answered) return; answered = true; clearInterval(QTIMER);
    btns.forEach(b => b.disabled = true);
    btns[q.c].classList.add('pick-ok');
    const good = pick === q.c;
    if (good) QZ.ok++;
    else if (pick != null) btns[pick].classList.add('pick-bad');
    card.classList.add(good ? 'ok' : 'bad');
    fb.className = 'quiz-feedback ' + (good ? 'ok' : 'bad');
    fb.textContent = good ? '¡Correcto!' : (pick == null ? '⏰ Se acabó el tiempo. Era: ' : 'Incorrecto. Era: ') + q.opts[q.c];
    next.classList.remove('hidden');
  };
  btns.forEach(b => b.addEventListener('click', () => finish(+b.dataset.i)));
  next.addEventListener('click', () => { QZ.i++; QZ.i < QZ.qs.length ? showQuestion() : endQuiz(); });
  QTIMER = setInterval(() => {
    left--; const t = box.querySelector('#q-timer'); if (t) { t.textContent = '⏱ ' + left + 's'; if (left <= 5) t.style.color = 'var(--danger)'; }
    if (left <= 0) finish(null);
  }, 1000);
}

async function endQuiz() {
  clearInterval(QTIMER);
  const res = document.getElementById('quiz-result'), box = document.getElementById('quiz-box');
  const { ok, qs, diff } = QZ;
  box.classList.add('hidden');
  try {
    const d = await api('/api/quiz/submit', { method: 'POST', body: { correct: ok, total: qs.length, difficulty: diff } });
    res.innerHTML = `<div class="muted">Resultado</div><div class="grade">${ok} / ${qs.length}</div>
      <div class="xp-line">+${d.gain} XP · Nivel ${d.level}</div>`;
    toast('¡Quiz completado! +' + d.gain + ' XP');
  } catch (e) {
    res.innerHTML = `<div class="muted">Resultado</div><div class="grade">${ok} / ${qs.length}</div><p class="muted small">${esc(e.message)}</p>`;
  }
  res.classList.remove('hidden');
  QZ = null; document.getElementById('quiz-diff').disabled = false;
  await syncQuiz();
  refreshProgress(); refreshAudit(); refreshDashboard();
}

/* Al entrar a "Aprender", refrescar cooldown real del servidor */
new MutationObserver(() => { if (document.getElementById('learn').classList.contains('active') && TOKEN) syncQuiz(); })
  .observe(document.getElementById('learn'), { attributes: true, attributeFilter: ['class'] });

/* =====================================================================
 * TICKETS DE SOPORTE (con adjuntos)
 * ===================================================================== */
let TFILES = [];
const fileInput = document.getElementById('contact-files');
function renderFiles() {
  const ul = document.getElementById('contact-files-list'); if (!ul) return;
  ul.innerHTML = TFILES.map((f, i) => `<li><span>📎 ${esc(f.name)} · ${f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB'}</span><button type="button" class="rm-file" data-i="${i}">✕</button></li>`).join('');
}
function addFiles(add) {
  const err = document.getElementById('contact-files-err'); err.classList.add('hidden');
  const total = TFILES.reduce((a, x) => a + x.size, 0) + add.reduce((a, x) => a + x.size, 0);
  let msg = '';
  if (TFILES.length + add.length > 5) msg = 'No se permiten más de 5 archivos. No se agregó ninguno de los seleccionados.';
  else if (total > 10 * 1024 * 1024) msg = 'El total supera los 10 MB permitidos. No se agregó ninguno de los seleccionados.';
  if (msg) { err.textContent = msg; err.classList.remove('hidden'); toast(msg, true); return; }
  TFILES.push(...add); renderFiles();
}
fileInput?.addEventListener('change', () => { const add = [...fileInput.files]; fileInput.value = ''; if (add.length) addFiles(add); });
(function dz() {
  const z = document.getElementById('dropzone'); if (!z) return;
  ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('over'); }));
  z.addEventListener('drop', e => { const add = [...(e.dataTransfer?.files || [])]; if (add.length) addFiles(add); });
})();
document.getElementById('contact-files-list')?.addEventListener('click', e => {
  const b = e.target.closest('.rm-file'); if (b) { TFILES.splice(+b.dataset.i, 1); renderFiles(); }
});
const toDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('No se pudo leer ' + f.name)); r.readAsDataURL(f); });

document.getElementById('contact-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    const files = await Promise.all(TFILES.map(async f => ({ name: f.name, data: await toDataUrl(f) })));
    const d = await api('/api/contact', { method: 'POST', body: { category: document.getElementById('contact-cat').value, subcategory: document.getElementById('contact-sub').value, subject: document.getElementById('contact-subject').value, message: document.getElementById('contact-message').value, files } });
    toast(d.emailed ? 'Ticket enviado y notificado por correo' : 'Ticket guardado (SMTP sin configurar: no salió el correo)', !d.emailed);
    e.target.reset(); document.getElementById('contact-cat')?.dispatchEvent(new Event('change')); TFILES = []; renderFiles(); loadTickets(); refreshAudit(); refreshDashboard();
  } catch (ex) { toast(ex.message, true); }
  finally { btn.disabled = false; }
});

async function loadTickets() {
  const box = document.getElementById('tickets-list'); if (!box) return;
  try {
    const { tickets } = await api('/api/contact');
    box.innerHTML = tickets.length ? tickets.map(t => `<div class="hist-item" data-id="${t.id}">
        <div style="flex:1;min-width:0"><strong>${esc(t.subject)}</strong>${t.category ? `<span class="badge">${esc(t.category)} › ${esc(t.subcategory || '')}</span>` : ''}${t.priority ? '<span class="badge">PRIORIDAD</span>' : ''}<span class="badge">${esc(t.status)}</span>
          <p>${esc(t.message)}</p><small>${new Date(t.ts).toLocaleString()}${t.edited ? ' · editado' : ''}${t.files && t.files.length ? ' · 📎 ' + t.files.length : ''}</small></div>
        <div class="hist-actions"><button class="btn btn-sm btn-glass" data-act="edit">Editar</button>${t.priority ? '' : '<button class="btn btn-sm btn-accent" data-act="prio">Prioridad</button>'}</div>
      </div>`).join('') : '<p class="muted small">Todavía no creaste tickets.</p>';
    box._data = tickets;
  } catch (_) {}
}
document.getElementById('tickets-list')?.addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const item = b.closest('.hist-item'), id = item.dataset.id, t = (item.parentElement._data || []).find(x => x.id === id);
  try {
    if (b.dataset.act === 'prio') { await api(`/api/contact/${id}/priority`, { method: 'POST' }); toast('Prioridad solicitada'); loadTickets(); }
    if (b.dataset.act === 'edit') {
      item.innerHTML = `<div class="hist-edit"><input type="text" value="${esc(t.subject)}"><textarea rows="3">${esc(t.message)}</textarea>
        <div><button class="btn btn-sm btn-primary" data-act="save">Guardar</button> <button class="btn btn-sm btn-glass" data-act="cancel">Cancelar</button></div></div>`;
    }
    if (b.dataset.act === 'cancel') loadTickets();
    if (b.dataset.act === 'save') {
      const [i, ta] = [item.querySelector('input'), item.querySelector('textarea')];
      await api(`/api/contact/${id}`, { method: 'PUT', body: { subject: i.value, message: ta.value } });
      toast('Ticket actualizado'); loadTickets(); refreshAudit();
    }
  } catch (ex) { toast(ex.message, true); }
});

/* =====================================================================
 * RESEÑAS / FEEDBACK
 * ===================================================================== */
let RATING = 0;
const paintStars = (el, n) => [...el.querySelectorAll('span')].forEach(s => s.classList.toggle('active', +s.dataset.v <= n));
document.getElementById('stars')?.addEventListener('click', e => {
  const s = e.target.closest('span[data-v]'); if (!s) return;
  RATING = +s.dataset.v; paintStars(e.currentTarget, RATING);
});
document.getElementById('send-feedback')?.addEventListener('click', async () => {
  try {
    const d = await api('/api/feedback', { method: 'POST', body: { rating: RATING || null, comment: document.getElementById('feedback-text').value } });
    toast(d.emailed ? 'Reseña enviada. ¡Gracias!' : 'Reseña guardada (sin correo: SMTP sin configurar)');
    document.getElementById('feedback-text').value = ''; RATING = 0; paintStars(document.getElementById('stars'), 0);
    loadReviews(); refreshAudit(); refreshDashboard();
  } catch (e) { toast(e.message, true); }
});
async function loadReviews() {
  const box = document.getElementById('reviews-list'); if (!box) return;
  try {
    const { reviews } = await api('/api/feedback'); box._data = reviews;
    box.innerHTML = reviews.length ? reviews.map(r => `<div class="hist-item" data-id="${r.id}">
        <div style="flex:1;min-width:0"><span class="stars-txt">${'★'.repeat(r.rating || 0)}${'☆'.repeat(5 - (r.rating || 0))}</span>
          <p>${esc(r.comment) || '<span class="muted">(sin comentario)</span>'}</p><small>${new Date(r.ts).toLocaleString()}${r.edited ? ' · editada' : ''}</small></div>
        <div class="hist-actions"><button class="btn btn-sm btn-glass" data-act="edit">Editar</button><button class="btn btn-sm btn-accent" data-act="del">Eliminar</button></div>
      </div>`).join('') : '<p class="muted small">Todavía no dejaste reseñas.</p>';
  } catch (_) {}
}
document.getElementById('reviews-list')?.addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const item = b.closest('.hist-item'), id = item.dataset.id, r = (item.parentElement._data || []).find(x => x.id === id);
  try {
    if (b.dataset.act === 'del') { if (!confirm('¿Eliminar esta reseña?')) return; await api('/api/feedback/' + id, { method: 'DELETE' }); toast('Reseña eliminada'); loadReviews(); refreshDashboard(); refreshAudit(); }
    if (b.dataset.act === 'edit') {
      item.innerHTML = `<div class="hist-edit"><div class="stars" data-r="${r.rating || 0}">${[1, 2, 3, 4, 5].map(n => `<span data-v="${n}" class="${n <= (r.rating || 0) ? 'active' : ''}">★</span>`).join('')}</div>
        <textarea rows="3">${esc(r.comment)}</textarea><div><button class="btn btn-sm btn-primary" data-act="save">Guardar</button> <button class="btn btn-sm btn-glass" data-act="cancel">Cancelar</button></div></div>`;
      const st = item.querySelector('.stars'); st.addEventListener('click', ev => { const s = ev.target.closest('span[data-v]'); if (s) { st.dataset.r = s.dataset.v; paintStars(st, +s.dataset.v); } });
    }
    if (b.dataset.act === 'cancel') loadReviews();
    if (b.dataset.act === 'save') {
      await api('/api/feedback/' + id, { method: 'PUT', body: { rating: +item.querySelector('.stars').dataset.r || null, comment: item.querySelector('textarea').value } });
      toast('Reseña actualizada'); loadReviews(); refreshAudit(); refreshDashboard();
    }
  } catch (ex) { toast(ex.message, true); }
});

/* =====================================================================
 * CUENTA: foto de perfil, contraseña, eliminar cuenta
 * ===================================================================== */
let AVATAR_PENDING; // undefined = sin cambios, null = quitar, string = nueva
function applyAvatar(src, previewOnly) {
  (previewOnly ? ['acc-avatar'] : ['acc-avatar', 'user-avatar']).forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    const initials = ((ME && ME.name) || '--').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    if (src) { el.classList.add('has-img'); el.style.backgroundImage = `url(${src})`; el.textContent = ''; }
    else { el.classList.remove('has-img'); el.style.backgroundImage = ''; el.textContent = initials; }
  });
}
function shrinkImage(file, max = 256) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => rej(new Error('No se pudo leer la imagen'));
    img.src = url;
  });
}
const pend = document.getElementById('avatar-pending');
document.getElementById('avatar-input')?.addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { AVATAR_PENDING = await shrinkImage(f); applyAvatar(AVATAR_PENDING, true); if (pend) { pend.textContent = 'Foto lista — guardá los cambios para aplicarla'; pend.style.display = 'block'; } document.getElementById('save-profile-btn')?.classList.add('pulse'); }
  catch (ex) { toast(ex.message, true); }
  e.target.value = '';
});
document.getElementById('avatar-remove')?.addEventListener('click', () => {
  if (!(ME && ME.avatar)) { // no hay foto guardada: no hay nada que quitar
    AVATAR_PENDING = undefined; applyAvatar(null, true);
    if (pend) { pend.textContent = 'Actualmente no hay foto de perfil existente'; pend.style.display = 'block'; }
    document.getElementById('save-profile-btn')?.classList.remove('pulse');
    return;
  }
  if (pend) pend.textContent = 'Foto lista — guardá los cambios para aplicarla';
  AVATAR_PENDING = null; applyAvatar(null, true); if (pend) pend.style.display = 'block'; document.getElementById('save-profile-btn')?.classList.add('pulse');
});
// Se suma al botón "Guardar Cambios" que ya guarda nombre/empresa
document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
  if (AVATAR_PENDING === undefined) return;
  try {
    await api('/api/account/avatar', { method: 'PUT', body: { avatar: AVATAR_PENDING } });
    if (ME) ME.avatar = AVATAR_PENDING; applyAvatar(AVATAR_PENDING);
    AVATAR_PENDING = undefined; if (pend) pend.style.display = 'none'; document.getElementById('save-profile-btn')?.classList.remove('pulse');
    toast('Foto de perfil guardada'); refreshAudit();
  } catch (e) { toast(e.message, true); }
});

document.getElementById('pw-btn')?.addEventListener('click', async () => {
  const cur = document.getElementById('pw-cur').value, n1 = document.getElementById('pw-new').value, n2 = document.getElementById('pw-new2').value;
  if (!cur || !n1) return toast('Completá todos los campos', true);
  if (n1 !== n2) return toast('Las contraseñas nuevas no coinciden', true);
  try {
    await api('/api/account/password', { method: 'POST', body: { current: cur, next: n1 } });
    ['pw-cur', 'pw-new', 'pw-new2'].forEach(id => document.getElementById(id).value = '');
    toast('Contraseña cambiada'); refreshAudit();
  } catch (e) { toast(e.message, true); }
});

let DEL_STAGE = 0;
document.getElementById('del-btn')?.addEventListener('click', async () => {
  const pw = document.getElementById('del-pw').value;
  try {
    if (DEL_STAGE === 0) {
      if (!pw) return toast('Ingresá tu contraseña', true);
      const d = await api('/api/account/delete/start', { method: 'POST', body: { password: pw } });
      DEL_STAGE = 1; document.getElementById('del-code-g').classList.remove('hidden');
      document.getElementById('del-btn').textContent = 'Confirmar eliminación definitiva';
      return toast(d.emailSent ? 'Te enviamos un código al correo' : 'SMTP sin configurar: el código está en la consola del servidor', !d.emailSent);
    }
    if (!confirm('Esto borra tu cuenta, tickets y reseñas para siempre. ¿Continuar?')) return;
    await api('/api/account', { method: 'DELETE', body: { password: pw, code: document.getElementById('del-code').value } });
    setAccs(getAccs().filter(a => !ME || a.email !== ME.email));
    TOKEN = null; localStorage.removeItem('iphub_token'); DEL_STAGE = 0;
    document.getElementById('app').classList.add('hidden'); document.getElementById('auth-screen').classList.remove('hidden');
    toast('Cuenta eliminada');
  } catch (e) { toast(e.message, true); }
});

/* =====================================================================
 * AUDITORÍA: exportar CSV / PDF
 * ===================================================================== */
document.getElementById('export-csv-btn')?.addEventListener('click', async () => {
  try {
    const r = await fetch('/api/audit/export.csv', { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (!r.ok) throw new Error('No se pudo exportar');
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: 'iphub-auditoria.csv' });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (e) { toast(e.message, true); }
});
document.getElementById('export-pdf-btn')?.addEventListener('click', () => {
  const w = window.open('', '_blank');
  if (!w) return toast('El navegador bloqueó la ventana', true);
  const type = (document.getElementById('audit-filter-type').value || '').toLowerCase();
  const rows = _AUDIT.filter(e => !type || (e.action || '').toLowerCase().includes(type) || (e.detail || '').toLowerCase().includes(type));
  w.document.write(`<!doctype html><title>IPHub · Auditoría</title><style>body{font:13px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:5px 8px;text-align:left}th{background:#eee}</style>
    <h2>IPHub — Historial de actividades</h2><p>${esc((ME && ME.email) || '')} · ${new Date().toLocaleString()}</p>
    <table><tr><th>Fecha</th><th>Mail</th><th>Acción</th><th>Detalle</th></tr>${rows.map(e => `<tr><td>${new Date(e.ts).toLocaleString()}</td><td>${esc(e.user)}</td><td>${esc(e.action)}</td><td>${esc(e.detail)}</td></tr>`).join('')}</table>
    <script>onload=()=>setTimeout(print,300)<\/script>`);
  w.document.close();
});

/* =====================================================================
 * BUSCADOR GLOBAL
 * ===================================================================== */
(function search() {
  const inp = document.getElementById('global-search'), out = document.getElementById('search-results'); if (!inp || !out) return;
  const items = [
    ['Dashboard', 'dashboard', 'inicio nivel xp actividad'], ['Topología', 'topology', 'red dispositivos descubrir lan'],
    ['Herramientas', 'tools', ''], ['IP / Geolocalización', 'tools', 'ip geo vpn proxy', 'ip'], ['Escaneo de puertos', 'tools', 'puertos scan', 'ports'],
    ['Traceroute', 'tools', 'trace ruta hops', 'trace'], ['DNS', 'tools', 'dns dominio', 'dns'], ['Calculadora de subredes', 'tools', 'cidr subred mascara', 'subnet'],
    ['ARP / MAC', 'tools', 'arp mac', 'arp'], ['Prueba de velocidad', 'tools', 'velocidad speed mbps', 'speed'],
    ['Auditoría', 'audit', 'historial csv pdf'], ['Aprender (quiz)', 'learn', 'quiz xp nivel'], ['Ranking / leaderboard', 'leaderboard', 'top niveles competir posicion'], ['Soporte / tickets', 'support', 'ticket reseña feedback'],
    ['Mi Cuenta', 'account', 'perfil foto contraseña api eliminar'], ['Legal', 'legal', 'privacidad terminos cookies'],
  ];
  const go = it => {
    showSection(it[1]);
    const rk = Object.keys(ROUTES).find(k => ROUTES[k] === it[1]); if (rk) history.pushState({}, '', '/' + rk);
    if (it[3]) document.querySelector(`.tool-tab[data-tool="${it[3]}"]`)?.click();
    out.classList.add('hidden'); inp.value = '';
  };
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase(); if (!q) return out.classList.add('hidden');
    const r = items.filter(i => (i[0] + ' ' + i[2]).toLowerCase().includes(q)).slice(0, 7);
    out.innerHTML = r.length ? r.map((i, n) => `<button class="sr-item" data-n="${items.indexOf(i)}">${esc(i[0])}</button>`).join('') : '<div class="sr-empty">Sin resultados</div>';
    out.classList.remove('hidden');
  });
  out.addEventListener('click', e => { const b = e.target.closest('.sr-item'); if (b) go(items[+b.dataset.n]); });
  document.addEventListener('click', e => { if (!out.contains(e.target) && e.target !== inp) out.classList.add('hidden'); });
})();

/* =====================================================================
 * TOPOLOGÍA (canvas): nodos arrastrables, hover y clic
 * ===================================================================== */
let TOPO_DEV = [];
async function loadTopo() {
  try {
    const snap = await api('/api/agent/snapshot');
    const fromExe = (snap.snapshot && snap.snapshot.devices) || [];
    TOPO_DEV = fromExe.length ? fromExe.map((d, i) => ({ ...d, id: d.mac || d.ip || i, alias: d.name || d.ip })) : ((await api('/api/devices')).devices || []);
    buildNodes();
  } catch (_) {}
}
const cv = document.getElementById('topo-canvas'), info = document.getElementById('topo-info');
let nodes = [], drag = null, hover = null;
function sizeCanvas() { if (!cv) return; const w = cv.clientWidth || 600; cv.width = w; cv.height = cv.clientHeight || 460; buildNodes(true); }
function kindOf(d) {
  const t = String(d.type || d.kind || '').toLowerCase();
  if (d.isGateway || t === 'router') return 'router';
  if (t === 'switch') return 'switch';
  return 'host';
}
function buildNodes(keep) {
  if (!cv) return;
  const old = new Map(nodes.map(n => [n.id, n]));
  const w = cv.width, h = cv.height;
  const routers = TOPO_DEV.filter(d => kindOf(d) === 'router');
  const switches = TOPO_DEV.filter(d => kindOf(d) === 'switch');
  const hosts = TOPO_DEV.filter(d => kindOf(d) === 'host');
  nodes = [];
  const place = (list, y, r, kind) => list.forEach((d, i) => {
    const id = d.id || d.mac || d.ip || kind + i;
    const p = old.get(id);
    const x = list.length === 1 ? w / 2 : 40 + (w - 80) * i / Math.max(1, list.length - 1);
    nodes.push({ id, label: d.alias || d.name || d.ip, x: p ? p.x : x, y: p ? p.y : y, r, d, kind });
  });
  if (!routers.length) nodes.push({ id: 'gw', label: 'Router', x: w / 2, y: 54, r: 16, kind: 'router', gw: true });
  place(routers, 54, 16, 'router');
  place(switches, h * 0.42, 14, 'switch');
  place(hosts, h * 0.78, 10, 'host');
}
function drawTopo() {
  if (!cv || !cv.offsetParent) return requestAnimationFrame(drawTopo);
  const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  const gw = nodes[0]; if (!gw) return requestAnimationFrame(drawTopo);
  g.lineWidth = 1;
  const roots = nodes.filter(n => n.kind === 'router');
  const mids = nodes.filter(n => n.kind === 'switch');
  const leaves = nodes.filter(n => n.kind === 'host');
  const parent = n => (mids[0] || roots[0]);
  g.strokeStyle = 'rgba(129,140,248,.35)';
  for (const n of mids) for (const r of roots) { g.beginPath(); g.moveTo(r.x, r.y); g.lineTo(n.x, n.y); g.stroke(); }
  for (const n of leaves) { const p = parent(n); if (!p) continue; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(n.x, n.y); g.stroke(); }
  for (const n of nodes) {
    const rad = n.r + (n === hover ? 3 : 0);
    g.fillStyle = n.kind === 'router' ? '#22d3ee' : n.kind === 'switch' ? '#a78bfa' : (!n.d || n.d.online !== false ? '#34d399' : '#f87171');
    if (n.kind === 'switch') { g.fillRect(n.x - rad, n.y - rad * 0.6, rad * 2, rad * 1.2); }
    else { g.beginPath(); g.arc(n.x, n.y, rad, 0, 7); g.fill(); }
    g.fillStyle = '#c7d2fe'; g.font = '11px system-ui'; g.textAlign = 'center'; g.fillText(n.label || '', n.x, n.y + n.r + 14);
  }
  requestAnimationFrame(drawTopo);
}
if (cv) {
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  const at = p => nodes.find(n => Math.hypot(n.x - p.x, n.y - p.y) <= n.r + 4);
  cv.addEventListener('mousedown', e => { drag = at(pos(e)); });
  addEventListener('mouseup', () => { drag = null; });
  cv.addEventListener('mousemove', e => {
    const p = pos(e); if (drag) { drag.x = p.x; drag.y = p.y; }
    hover = at(p); cv.style.cursor = hover ? 'pointer' : 'default';
    if (hover && info) info.textContent = hover.gw ? 'Tu red local' : `${hover.d.alias || hover.d.ip} · ${hover.d.ip}`;
  });
  cv.addEventListener('click', e => {
    const n = at(pos(e)); if (!n || !info) return;
    info.textContent = n.gw ? `Tu red local · ${TOPO_DEV.length} dispositivos conocidos`
      : `${n.d.alias || n.d.ip} · IP ${n.d.ip} · MAC ${n.d.mac || 'sin resolver'} · ${n.d.online ? 'en línea' : 'sin respuesta'} · RTT ${n.d.lastRttMs ?? '—'} ms${n.d.suspicious ? ' · ⚠ desconocido' : ''}`;
  });
  addEventListener('resize', sizeCanvas);
  new MutationObserver(loadTopo).observe(document.getElementById('device-list'), { childList: true });
  new MutationObserver(() => { if (document.getElementById('topology').classList.contains('active')) sizeCanvas(); }).observe(document.getElementById('topology'), { attributes: true, attributeFilter: ['class'] });
  sizeCanvas(); drawTopo();
}

/* =====================================================================
 * CHATBOT (usa /api/chat; con GROQ/OPENAI en .env responde con IA)
 * ===================================================================== */
(function chatbot() {
  const wrap = document.createElement('div'); wrap.className = 'ipbot'; wrap.id = 'ipbot';
  wrap.innerHTML = `<div class="ipbot-win hidden" id="ipbot-win"><div class="ipbot-head"><span class="ipbot-title"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>Asistente IPHub</span><div class="ipbot-ctl"><button class="ipbot-x" id="ipbot-min" title="Minimizar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg></button><button class="ipbot-x" id="ipbot-x" title="Cerrar chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div></div>
      <div class="ipbot-msgs" id="ipbot-msgs"></div>
      <input id="ipbot-in" class="global-search" placeholder="Escribí y Enter…" autocomplete="off">
      <div class="ipbot-confirm hidden" id="ipbot-confirm" role="dialog" aria-modal="true"><div class="ipbot-confirm-box"><div class="ipbot-confirm-ico">?</div><h4>¿Cerrar el chat?</h4><p>Se va a borrar la conversación. Si solo querés apartarlo, usá minimizar.</p><div class="ipbot-confirm-btns"><button type="button" class="cf-yes" id="ipbot-yes">SÍ</button><button type="button" class="cf-no" id="ipbot-no">NO</button></div></div></div></div>
    <button class="ipbot-mini hidden" id="ipbot-mini" title="Chat minimizado — tocá para abrirlo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg><i></i></button>
    <button class="ipbot-fab" id="ipbot-fab" title="Asistente IA"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg></button>`;
  document.body.appendChild(wrap);
  const win = wrap.querySelector('#ipbot-win'), msgs = wrap.querySelector('#ipbot-msgs'), inp = wrap.querySelector('#ipbot-in'), mini = wrap.querySelector('#ipbot-mini');
  let state = 'closed', hist = [], busy = false;
  const md = t => esc(t).replace(/```([\s\S]*?)```/g, '<pre>$1</pre>').replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  const add = (t, c, live) => { const d = document.createElement('div'); d.className = 'bm ' + c; if (live) d.setAttribute('data-no-i18n', ''); if (c === 'bot' && live) d.innerHTML = md(t); else d.textContent = t; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; };
  const greet = () => { msgs.innerHTML = ''; hist = []; add('¡Hola! Preguntame lo que quieras: sobre IPHub, redes o cualquier otro tema.', 'bot', false); };
  const set = st => {
    state = st; win.classList.toggle('hidden', st !== 'open'); mini.classList.toggle('hidden', st !== 'min');
    if (st === 'open') { mini.classList.remove('ping'); inp.focus(); msgs.scrollTop = msgs.scrollHeight; }
  };
  wrap.querySelector('#ipbot-fab').addEventListener('click', () => {
    if (state === 'closed') { greet(); return set('open'); }
    if (state === 'open') return set('min');
    toast('Ya tenés un chat minimizado. Abrilo con el ícono de arriba o cerralo antes de empezar otro.', true);
    mini.classList.add('shake'); setTimeout(() => mini.classList.remove('shake'), 600);
  });
  mini.addEventListener('click', () => set('open'));
  wrap.querySelector('#ipbot-min').addEventListener('click', () => { wrap.querySelector('#ipbot-confirm').classList.add('hidden'); set('min'); });
  const cf = wrap.querySelector('#ipbot-confirm');
  const askClose = () => { cf.classList.remove('hidden'); wrap.querySelector('#ipbot-no').focus(); };
  const hideAsk = () => { cf.classList.add('hidden'); if (state === 'open') inp.focus(); };
  wrap.querySelector('#ipbot-x').addEventListener('click', askClose);
  wrap.querySelector('#ipbot-yes').addEventListener('click', () => { cf.classList.add('hidden'); msgs.innerHTML = ''; hist = []; set('closed'); });
  wrap.querySelector('#ipbot-no').addEventListener('click', hideAsk);
  cf.addEventListener('click', e => { if (e.target === cf) hideAsk(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !cf.classList.contains('hidden')) hideAsk(); });
  window.__chatReset = () => { msgs.innerHTML = ''; hist = []; busy = false; wrap.querySelector('#ipbot-confirm').classList.add('hidden'); set('closed'); };
  inp.addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || !inp.value.trim() || busy) return;
    const q = inp.value.trim(); inp.value = ''; add(q, 'me', true); const w = add('…', 'bot', true); busy = true; inp.disabled = true;
    try {
      const d = await api('/api/chat', { method: 'POST', body: { message: q, history: hist.slice(-10), lang: window.IPHUB_LANG ? IPHUB_LANG() : 'es', section: document.querySelector('.section.active')?.id } });
      w.innerHTML = md(d.reply); hist.push({ role: 'user', content: q }, { role: 'assistant', content: d.reply });
    } catch (ex) { w.textContent = 'Error: ' + ex.message; }
    busy = false; inp.disabled = false; msgs.scrollTop = msgs.scrollHeight;
    if (state === 'min') mini.classList.add('ping'); else if (state === 'open') inp.focus();
  });
  const sync = () => { const off = !TOKEN || document.getElementById('app').classList.contains('hidden'); wrap.classList.toggle('hidden', off); if (off && window.__chatReset) window.__chatReset(); };
  new MutationObserver(sync).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['class'] }); sync();
})();

/* =====================================================================
 * COOKIES
 * ===================================================================== */
(function cookies() {
  const b = document.getElementById('cookie-banner'); if (!b) return;
  if (!localStorage.getItem('iphub_cookies')) b.classList.remove('hidden');
  const set = v => () => { localStorage.setItem('iphub_cookies', v); b.classList.add('hidden'); };
  document.getElementById('cookie-accept')?.addEventListener('click', set('accept'));
  document.getElementById('cookie-deny')?.addEventListener('click', set('deny'));
})();

/* =====================================================================
 * RUTAS (/home, /aprender, /privacidad…) sin recargar
 * ===================================================================== */
const ROUTES = { home: 'dashboard', topologia: 'topology', herramientas: 'tools', auditoria: 'audit', aprender: 'learn', ranking: 'leaderboard', soporte: 'support', cuenta: 'account', empresa: 'empresa', manual: 'manual', privacidad: 'legal', terminos: 'legal', cookies: 'legal' };
const TOOL_SLUGS = { ip: 'ip', puertos: 'ports', traceroute: 'trace', dns: 'dns', subredes: 'subnet', arp: 'arp', velocidad: 'speed' };
function openTool(tool) {
  window.__routing = true;
  document.querySelector(`.tool-tab[data-tool="${tool}"]`)?.click();
  window.__routing = false;
}
function applyRoute() {
  const parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const key = parts[0], sec = ROUTES[key]; if (!sec || !ME) return;
  showSection(sec);
  if (sec === 'tools') openTool(TOOL_SLUGS[parts[1]] || 'ip');
  if (sec === 'legal') document.getElementById(key)?.scrollIntoView();
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-route], a.nav-item'); if (!a) return;
  const href = a.getAttribute('href'); if (!href || !href.startsWith('/')) return;
  const key = href.replace(/^\/+/, '');
  if (!ROUTES[key] || !TOKEN) return;
  e.preventDefault(); history.pushState({}, '', href); applyRoute();
});
addEventListener('popstate', () => { try { applyRoute(); } catch (_) {} });


/* =====================================================================
 * SOPORTE: tema y subtema del ticket
 * ===================================================================== */
(function ticketCats() {
  const cat = document.getElementById('contact-cat'), sub = document.getElementById('contact-sub'); if (!cat || !sub || !window.TICKET_CATS) return;
  Object.keys(TICKET_CATS).forEach(k => cat.add(new Option(k, k)));
  cat.addEventListener('change', () => {
    const l = TICKET_CATS[cat.value] || [];
    sub.innerHTML = ''; sub.add(new Option(l.length ? 'Elegí un subtema…' : 'Primero elegí un tema', ''));
    l.forEach(x => sub.add(new Option(x, x))); sub.disabled = !l.length;
  });
})();

/* =====================================================================
 * MI CUENTA: cambiar correo (código al correo actual y luego al nuevo)
 * ===================================================================== */
(function emailChange() {
  const g = id => document.getElementById(id); if (!g('em-start')) return;
  const s1 = g('em-s1'), s2 = g('em-s2'); let newEmail = '';
  const cur = () => { if (ME && g('em-cur-v')) g('em-cur-v').textContent = ME.email; };
  const ue = g('user-email'); if (ue) new MutationObserver(cur).observe(ue, { childList: true, characterData: true, subtree: true }); cur();
  g('em-start').closest('.card')?.addEventListener('focusin', cur);
  const reset = () => { s1.classList.remove('hidden'); s2.classList.add('hidden'); g('em-code').value = ''; g('em-pw').value = ''; newEmail = ''; };
  const warn = sent => { if (!sent) toast('SMTP sin configurar: el código salió en la consola del servidor', true); };
  g('em-start').addEventListener('click', async e => {
    const ne = g('em-new').value.trim().toLowerCase(), pw = g('em-pw').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ne)) return toast('Ingresá un correo nuevo válido', true);
    if (!pw) return toast('Ingresá tu contraseña actual', true);
    e.target.disabled = true;
    try {
      const d = await api('/api/account/email/start', { method: 'POST', body: { newEmail: ne, password: pw } });
      newEmail = ne; g('em-pw').value = '';
      g('em-info').textContent = 'Paso 1 de 2 · Te enviamos un código de 6 dígitos a ' + (ME ? ME.email : 'tu correo actual') + ' para autorizar el cambio.';
      g('em-lbl').textContent = 'Código del correo actual'; g('em-code').value = '';
      s1.classList.add('hidden'); s2.classList.remove('hidden'); g('em-code').focus(); warn(d.emailSent);
    } catch (ex) { toast(ex.message, true); }
    e.target.disabled = false;
  });
  g('em-confirm').addEventListener('click', async e => {
    const code = g('em-code').value.trim();
    if (!/^\d{6}$/.test(code)) return toast('El código tiene 6 dígitos', true);
    e.target.disabled = true;
    try {
      const d = await api('/api/account/email/confirm', { method: 'POST', body: { code } });
      if (d.next === 'new') {
        g('em-info').textContent = 'Paso 2 de 2 · Ahora te enviamos otro código a ' + newEmail + ' para comprobar que el correo es tuyo.';
        g('em-lbl').textContent = 'Código del correo nuevo'; g('em-code').value = ''; g('em-code').focus(); warn(d.emailSent);
      } else if (d.done) {
        const old = ME && ME.email; Object.assign(ME, d.user);
        if (ue) ue.textContent = ME.email;
        document.querySelectorAll('#acc-email').forEach(i => { i.value = ME.email; });
        try { setAccs(getAccs().filter(x => x.email !== old)); saveAccountLocal(ME); } catch (_) {}
        cur(); reset(); g('em-new').value = ''; toast('Correo actualizado a ' + ME.email); refreshAudit();
      }
    } catch (ex) { toast(ex.message, true); }
    e.target.disabled = false;
  });
  g('em-code').addEventListener('keydown', e => { if (e.key === 'Enter') g('em-confirm').click(); });
  g('em-cancel').addEventListener('click', () => { reset(); toast('Cambio de correo cancelado'); });
})();

/* =====================================================================
 * CHAT IA: ícono movible (mantené apretado y arrastrá; imanes en las esquinas)
 * ===================================================================== */
(function chatDrag() {
  const wrap = document.getElementById('ipbot'), fab = document.getElementById('ipbot-fab'); if (!wrap || !fab) return;
  const M = 24, KEY = 'iphub_fab_pos', SNAP = 96;
  const sz = () => ({ w: fab.offsetWidth || 56, h: fab.offsetHeight || 56 });
  const clamp = (x, y) => { const s = sz(); return { x: Math.max(8, Math.min(innerWidth - s.w - 8, x)), y: Math.max(8, Math.min(innerHeight - s.h - 8, y)) }; };
  const corners = () => { const s = sz(), r = innerWidth - s.w - M, b = innerHeight - s.h - M; return { tl: { x: M, y: M }, tr: { x: r, y: M }, bl: { x: M, y: b }, br: { x: r, y: b } }; };
  const orient = p => { const s = sz(); wrap.classList.toggle('at-left', p.x + s.w / 2 < innerWidth / 2); wrap.classList.toggle('at-top', p.y + s.h / 2 < innerHeight / 2); };
  const place = (x, y, anim) => {
    const p = clamp(x, y); wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
    wrap.style.transition = anim ? 'left .55s cubic-bezier(.34,1.56,.64,1),top .55s cubic-bezier(.34,1.56,.64,1)' : 'none';
    wrap.style.left = p.x + 'px'; wrap.style.top = p.y + 'px'; orient(p); return p;
  };
  const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const restore = () => { const v = load(); if (!v) return; if (v.c && corners()[v.c]) { const c = corners()[v.c]; place(c.x, c.y); } else if (v.fx != null) place(v.fx * (innerWidth - sz().w), v.fy * (innerHeight - sz().h)); };
  restore(); addEventListener('resize', restore);

  let timer = null, drag = false, sx = 0, sy = 0, ox = 0, oy = 0, hot = null, pid = 0, targets = null, block = false;
  const mkTargets = () => {
    targets = {}; const c = corners();
    Object.keys(c).forEach(k => { const d = document.createElement('div'); d.className = 'ipbot-corner'; const s = sz(); d.style.left = c[k].x + 'px'; d.style.top = c[k].y + 'px'; d.style.width = s.w + 'px'; d.style.height = s.h + 'px'; document.body.appendChild(d); targets[k] = d; requestAnimationFrame(() => d.classList.add('show')); });
  };
  const rmTargets = () => { if (!targets) return; Object.values(targets).forEach(d => { d.classList.remove('show'); setTimeout(() => d.remove(), 250); }); targets = null; };
  const nearest = (x, y) => { const c = corners(); let best = null, bd = 1e9; for (const k in c) { const d = Math.hypot(c[k].x - x, c[k].y - y); if (d < bd) { bd = d; best = k; } } return bd <= SNAP ? best : null; };
  const pop = cls => { wrap.classList.remove(cls); void wrap.offsetWidth; wrap.classList.add(cls); setTimeout(() => wrap.classList.remove(cls), 700); };

  fab.addEventListener('pointerdown', e => {
    if (e.button > 0) return; sx = e.clientX; sy = e.clientY; const r = wrap.getBoundingClientRect(); ox = r.left; oy = r.top; pid = e.pointerId;
    clearTimeout(timer);
    timer = setTimeout(() => {
      drag = true; try { fab.setPointerCapture(pid); } catch (_) {}
      wrap.classList.add('dragging'); if (navigator.vibrate) navigator.vibrate(15); mkTargets();
    }, 260);
  });
  fab.addEventListener('pointermove', e => {
    if (!drag) { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { clearTimeout(timer); timer = null; } return; }
    const p = place(ox + e.clientX - sx, oy + e.clientY - sy, false), h = nearest(p.x, p.y);
    if (h !== hot) {
      if (hot && targets) targets[hot].classList.remove('hot');
      hot = h; if (hot && targets) { targets[hot].classList.add('hot'); pop('touch'); if (navigator.vibrate) navigator.vibrate(8); }
    }
    if (hot) { const c = corners()[hot]; place(p.x + (c.x - p.x) * .25, p.y + (c.y - p.y) * .25, false); } // imán suave
  });
  const end = () => {
    clearTimeout(timer); timer = null; if (!drag) return;
    drag = false; wrap.classList.remove('dragging'); block = true; setTimeout(() => { block = false; }, 60);
    const r = wrap.getBoundingClientRect();
    if (hot) { const c = corners()[hot]; place(c.x, c.y, true); save({ c: hot }); setTimeout(() => pop('landed'), 380); }
    else { const p = place(r.left, r.top, true); save({ fx: p.x / Math.max(1, innerWidth - sz().w), fy: p.y / Math.max(1, innerHeight - sz().h) }); pop('drop'); }
    hot = null; rmTargets();
  };
  fab.addEventListener('pointerup', end); fab.addEventListener('pointercancel', end);
  fab.addEventListener('click', e => { if (block) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  fab.addEventListener('contextmenu', e => { if (drag) e.preventDefault(); });
  fab.style.touchAction = 'none'; fab.style.userSelect = 'none';
})();
