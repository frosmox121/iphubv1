/* IPHub v1 · micro-interacciones profesionales */
(function () {
  const bar = document.createElement('div'); bar.id = 'pro-progress'; bar.setAttribute('data-no-i18n', ''); document.body.appendChild(bar);
  const sc = () => { const el = document.querySelector('.main') || document.documentElement; const max = el.scrollHeight - el.clientHeight; bar.style.width = (max > 0 ? el.scrollTop / max * 100 : 0) + '%'; };
  document.addEventListener('scroll', sc, true); window.addEventListener('resize', sc);
  // Ripple en botones
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest('.btn'); if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2, i = document.createElement('i');
    i.className = 'rip'; i.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`; b.appendChild(i); setTimeout(() => i.remove(), 650);
  }, true);
  // Revelado escalonado de tarjetas al entrar en pantalla
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: .08 }) : null;
  const tag = root => (root.querySelectorAll ? root.querySelectorAll('.card:not(.rv),.stat-card:not(.rv)') : []).forEach((el, i) => { if (!io) return; el.classList.add('rv'); el.style.transitionDelay = Math.min(i % 8, 7) * 55 + 'ms'; io.observe(el); });
  tag(document);
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches && n.matches('.card,.stat-card') && !n.classList.contains('rv') && io) { n.classList.add('rv'); io.observe(n); } tag(n); } }).observe(document.body, { childList: true, subtree: true });
  // Contadores animados en estadísticas numéricas
  window.IPHUB_countUp = (el, to) => { const t0 = performance.now(), from = +el.textContent || 0; const f = now => { const p = Math.min(1, (now - t0) / 700); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); };
  // Efecto 3D sutil en el login
  const card = document.querySelector('.auth-card');
  if (card && matchMedia('(hover:hover)').matches) { card.addEventListener('pointermove', e => { const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; card.style.transform = `perspective(900px) rotateY(${x * 3}deg) rotateX(${-y * 3}deg)`; }); card.addEventListener('pointerleave', () => { card.style.transform = ''; }); }
})();
