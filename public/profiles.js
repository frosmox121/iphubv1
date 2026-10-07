/* Perfil: varias cuentas + switch account funcional */
(function () {
  const KEY = 'iphub_roster';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const write = list => localStorage.setItem(KEY, JSON.stringify(list));

  function remember(user, token) {
    if (!user || !user.email) return;
    const list = read().filter(a => a.email !== user.email);
    list.unshift({
      email: user.email,
      name: user.name || user.email,
      token: token || localStorage.getItem('iphub_token') || null,
      profileId: user.profileId || null,
      isAdmin: !!user.isAdmin,
      isOwner: !!user.isOwner,
    });
    write(list.slice(0, 12));
  }

  function initials(name, email) {
    const n = String(name || email || '?').trim();
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }

  function paint() {
    const boxes = document.querySelectorAll('#profile-box, .profile-box');
    if (!boxes.length || !window.ME) return;
    const list = read();
    // Always include current user
    if (!list.find(a => a.email === ME.email)) remember(ME, localStorage.getItem('iphub_token'));
    const all = read();
    const html = `<strong>${ME.isBusiness ? (ME.companyName || 'Empresa') : 'Cuentas'}</strong>
      <div class="pf-list">${all.map(a => {
        const on = a.email === ME.email;
        return `<button type="button" class="pf-acc ${on ? 'on' : ''}" data-email="${a.email}" title="${a.email}">
          <span class="pf-av">${initials(a.name, a.email)}</span>
          <span class="pf-meta"><b>${a.name || a.email}</b><small>${a.email}</small>
          <small class="${a.token || on ? 'ok' : ''}">${on ? 'Activa ahora' : (a.token ? 'Sesión guardada — clic para cambiar' : 'Sesión cerrada')}</small></span>
        </button>`;
      }).join('')}</div>
      <button type="button" class="btn btn-sm btn-glass" id="pf-add">+ Agregar cuenta</button>
      ${ME.isAdmin ? '<button type="button" class="btn btn-sm btn-glass" id="pf-staff">Gestionar perfil</button>' : ''}`;
    boxes.forEach(box => {
      box.innerHTML = html;
      box.querySelectorAll('.pf-acc').forEach(b => {
        b.onclick = () => openAccount(b.dataset.email);
      });
      const add = box.querySelector('#pf-add');
      if (add) add.onclick = addAccount;
      const staff = box.querySelector('#pf-staff');
      if (staff) staff.onclick = manage;
    });
  }

  async function openAccount(email) {
    if (!email || (window.ME && ME.email === email)) return;
    const row = read().find(a => a.email === email);
    if (row && row.token) {
      localStorage.setItem('iphub_token', row.token);
      location.reload();
      return;
    }
    // Session closed → go to login with email filled
    document.getElementById('auth-screen')?.classList.remove('hidden');
    document.getElementById('app')?.classList.add('hidden');
    const mail = document.getElementById('login-email');
    if (mail) mail.value = email;
    if (typeof refreshCaptcha === 'function') refreshCaptcha('login');
    if (typeof toast === 'function') toast('Ingresá la contraseña de ' + email);
    else alert('Sesión cerrada. Ingresá la contraseña de ' + email);
  }

  async function addAccount() {
    const name = prompt('Nombre de la cuenta nueva'); if (!name) return;
    const email = prompt('Correo de la cuenta nueva'); if (!email) return;
    const password = prompt('Contraseña (mínimo 8)'); if (!password) return;
    try {
      if (typeof api === 'function') {
        await api('/api/profile/accounts', { method: 'POST', body: { name, email, password } });
      }
      const list = read();
      list.push({ email, name, token: null, profileId: ME && ME.profileId, isAdmin: false });
      write(list);
      paint();
      if (typeof toast === 'function') toast('Cuenta agregada. Iniciá sesión con ella para guardarla.');
    } catch (e) { alert(e.message); }
  }

  async function manage() {
    try {
      const d = await api('/api/profile/accounts');
      const pick = prompt('Cuentas del perfil:\n' + d.accounts.map(a => a.email + (a.isAdmin ? ' (admin)' : '')).join('\n') + '\n\nCorreo a desvincular (vacío = cancelar)');
      if (!pick) return;
      const acc = d.accounts.find(a => a.email === pick.trim().toLowerCase());
      if (!acc) return alert('No está en este perfil');
      await api('/api/profile/accounts/' + acc.id, { method: 'DELETE' });
      write(read().filter(a => a.email !== acc.email));
      paint();
    } catch (e) { alert(e.message); }
  }

  // Remember on login; paint when ME exists (no aggressive interval)
  const _origEnter = window.enterApp;
  // Hook after ME is set
  let painted = false;
  const tick = setInterval(() => {
    if (window.ME) {
      remember(ME, localStorage.getItem('iphub_token'));
      if (!painted) { paint(); painted = true; }
      // soft refresh every 8s only if roster changed
    }
  }, 800);
  setTimeout(() => clearInterval(tick), 15000);
  // Re-paint when user opens account section
  document.addEventListener('click', e => {
    const nav = e.target.closest && e.target.closest('[data-section="account"]');
    if (nav && window.ME) { remember(ME, localStorage.getItem('iphub_token')); paint(); }
    if (e.target && e.target.id === 'logout-btn') {
      const list = read();
      const cur = list.find(a => a.email === (window.ME && ME.email));
      if (cur) cur.token = null;
      write(list);
    }
  });
  window.iphubRememberAccount = remember;
  window.iphubPaintProfiles = paint;
})();
