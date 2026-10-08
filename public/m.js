/* IPHub móvil: barra inferior, hoja "Más" y tablas en tarjetas */
(function () {
  const mq = matchMedia('(max-width:820px)');
  const bar = document.createElement('nav'), bg = document.createElement('div'), sh = document.createElement('div');
  bar.className = 'mtab'; bg.className = 'msheet-bg'; sh.className = 'msheet';
  const TABS = [['dashboard', 'home', 'Inicio'], ['topology', 'topo', 'Topología'], ['tools', 'tools', 'Herramientas'], ['intercept', 'packet', 'Interceptar'], ['more', 'menu', 'Más']];
  bar.innerHTML = TABS.map(t => '<button type="button" data-s="' + t[0] + '"' + (t[0] === 'intercept' ? ' hidden' : '') + '>' + IC(t[1], 22) + '<span>' + t[2] + '</span></button>').join('');
  document.body.append(bar, bg, sh);
  const nav = s => document.querySelector('.nav-item[data-section="' + s + '"]');
  const cur = () => { const a = document.querySelector('.nav-item.active'); return a ? a.dataset.section : 'dashboard'; };
  function closeSheet() { sh.classList.remove('open'); bg.classList.remove('open'); }
  function openSheet() {
    const ico = { dashboard: 'home', topology: 'topo', workspace: 'work', tracking: 'track', tools: 'tools', intercept: 'packet', code: 'code', audit: 'audit', learn: 'learn', leaderboard: 'rank', support: 'mail', empresa: 'company', manual: 'book', account: 'user' };
    const items = [...document.querySelectorAll('.nav-item[data-section]')].filter(a => !a.hidden).map(a => '<a href="' + a.getAttribute('href') + '" data-s="' + a.dataset.section + '" class="' + (a.dataset.section === cur() ? 'on' : '') + '">' + IC(ico[a.dataset.section] || 'help', 24) + '<span>' + a.textContent.trim() + '</span></a>').join('');
    const dl = document.querySelector('.dl-btn');
    sh.innerHTML = '<div class="grab"></div><div class="mgrid">' + items + '</div>' + (dl ? '<div class="mfoot"><a class="btn btn-accent btn-full" href="' + dl.getAttribute('href') + '">Descargar para Windows</a></div>' : '');
    sh.classList.add('open'); bg.classList.add('open');
  }
  bar.onclick = e => { const b = e.target.closest('button'); if (!b) return; const s = b.dataset.s; if (s === 'more') return openSheet(); const n = nav(s); if (n) n.click(); closeSheet(); scrollTo(0, 0); };
  sh.onclick = e => { const a = e.target.closest('a[data-s]'); if (!a) return; e.preventDefault(); const n = nav(a.dataset.s); if (n) n.click(); closeSheet(); scrollTo(0, 0); };
  bg.onclick = closeSheet;
  let sy = 0; sh.addEventListener('touchstart', e => { sy = e.touches[0].clientY; }, { passive: true }); sh.addEventListener('touchend', e => { if (e.changedTouches[0].clientY - sy > 70 && sh.scrollTop <= 0) closeSheet(); }, { passive: true });
  function sync() {
    const c = cur(), own = !!(nav('intercept') && !nav('intercept').hidden);
    bar.querySelector('[data-s="intercept"]').hidden = !own;
    bar.style.gridTemplateColumns = 'repeat(' + (own ? 5 : 4) + ',1fr)';
    bar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === c || (b.dataset.s === 'more' && !TABS.some(t => t[0] === c))));
  }
  function cards() { document.querySelectorAll('table.data-table:not(.mcards),.table-wrap table:not(.mcards)').forEach(t => { const h = [...t.querySelectorAll('thead th')].map(x => x.textContent.trim()); if (!h.length) return; t.classList.add('mcards'); t.querySelectorAll('tbody tr').forEach(r => [...r.children].forEach((c, i) => { if (h[i]) c.setAttribute('data-l', h[i]); })); }); document.querySelectorAll('table.mcards tbody tr').forEach(r => { const t = r.closest('table'), h = [...t.querySelectorAll('thead th')].map(x => x.textContent.trim()); [...r.children].forEach((c, i) => { if (h[i] && !c.dataset.l) c.setAttribute('data-l', h[i]); }); }); }
  let q = 0; const later = () => { if (q) return; q = setTimeout(() => { q = 0; if (document.body.classList.contains('mob')) { sync(); cards(); } }, 250); };
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  const apply = () => { document.body.classList.toggle('mob', mq.matches); if (!mq.matches) closeSheet(); later(); };
  (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply)); apply();
})();
