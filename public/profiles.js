/* Perfil tipo selector: varias cuentas, sesión abierta o cerrada. */
(function () {
  const KEY = 'iphub_roster';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const write = list => localStorage.setItem(KEY, JSON.stringify(list));
  function remember(user, token) {
    if (!user) return;
    const list = read().filter(a => a.email !== user.email);
    list.unshift({ email: user.email, name: user.name, token: token || null, profileId: user.profileId || null, isAdmin: !!user.isAdmin });
    write(list.slice(0, 12));
  }
  function paint() {
    const box = document.getElementById('profile-box');
    if (!box || !window.ME) return;
    const list = read().filter(a => !ME.profileId || a.profileId === ME.profileId);
    box.innerHTML = `<strong>${ME.isBusiness ? (ME.companyName || 'Empresa') : 'Mi perfil'}</strong>
      ${list.map(a => `<button type="button" class="pf-acc ${a.token ? 'on' : ''}" data-email="${a.email}">${a.name || a.email}<small>${a.token ? 'Sesión iniciada' : 'Sesión cerrada'}</small></button>`).join('')}
      <button type="button" class="btn btn-sm btn-glass" id="pf-add">Agregar cuenta</button>
      ${ME.isAdmin ? '<button type="button" class="btn btn-sm btn-glass" id="pf-staff">Cuentas del perfil</button>' : ''}`;
    box.querySelectorAll('.pf-acc').forEach(b => b.onclick = () => openAccount(b.dataset.email));
    const add = document.getElementById('pf-add');
    if (add) add.onclick = addAccount;
    const staff = document.getElementById('pf-staff');
    if (staff) staff.onclick = manage;
  }
  async function openAccount(email) {
    const row = read().find(a => a.email === email);
    if (row && row.token) { localStorage.setItem('iphub_token', row.token); location.reload(); return; }
    document.getElementById('auth-screen')?.classList.remove('hidden');
    document.getElementById('app')?.classList.add('hidden');
    const mail = document.getElementById('login-email'); if (mail) mail.value = email;
    if (typeof refreshCaptcha === 'function') refreshCaptcha('login');
    alert('Esta cuenta tiene la sesión cerrada. Ingresá la contraseña y el captcha.');
  }
  async function addAccount() {
    const name = prompt('Nombre de la cuenta nueva'); if (!name) return;
    const email = prompt('Correo de la cuenta nueva'); if (!email) return;
    const password = prompt('Contraseña (mínimo 8)'); if (!password) return;
    try {
      await api('/api/profile/accounts', { method: 'POST', body: { name, email, password } });
      const list = read(); list.push({ email, name, token: null, profileId: ME.profileId, isAdmin: false }); write(list);
      paint(); if (typeof toast === 'function') toast('Cuenta agregada a este perfil');
    } catch (e) { alert(e.message); }
  }
  async function manage() {
    const d = await api('/api/profile/accounts');
    const pick = prompt('Cuentas:\\n' + d.accounts.map(a => `${a.email} ${a.isAdmin ? '(admin)' : ''}`).join('\\n') + '\\n\\nCorreo a desvincular, o vacío para cancelar');
    if (!pick) return;
    const acc = d.accounts.find(a => a.email === pick.trim().toLowerCase());
    if (!acc) return alert('No está en este perfil');
    await api('/api/profile/accounts/' + acc.id, { method: 'DELETE' });
    write(read().filter(a => a.email !== acc.email)); paint();
  }
  const orig = window.showSection;
  setInterval(() => { if (window.ME) { remember(ME, localStorage.getItem('iphub_token')); paint(); } }, 1200);
  document.addEventListener('click', e => {
    if (e.target && e.target.id === 'logout-btn') {
      const list = read(); const cur = list.find(a => a.email === (window.ME && ME.email));
      if (cur) cur.token = null; write(list);
    }
  });
})();
