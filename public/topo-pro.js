/* IPHub · Mapa de red profesional (zoom, pan, arrastre, pantalla completa). Mismo estilo que el mapa del exe. */
(function () {
  const box = document.getElementById('tmap'); if (!box) return;
  const cv = box.querySelector('canvas'), tip = box.querySelector('.tmap-tip'), cnt = box.querySelector('.tmap-count');
  const g = cv.getContext('2d');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const M = { nodes: [], cam: { x: 0, y: 0, k: 1 }, w: 0, h: 0, dpr: 1, drag: null, pan: null, hover: null, sel: null, moved: 0, fitted: false, raf: 0, sig: '' };
  const ICON = { router: '🌐', gateway: '🌐', switch: '🔀', server: '🖥️', pc: '💻', laptop: '💻', computer: '💻', phone: '📱', mobile: '📱', printer: '🖨️', tv: '📺', camera: '📷', iot: '📡', nas: '🗄️' };
  const iconOf = d => { if (d.isGateway || d.gw) return '🌐'; const t = String(d.type || d.kind || '').toLowerCase(); for (const k in ICON) if (t.includes(k)) return ICON[k]; return '💠'; };
  const colOf = d => d.gw || d.isGateway ? '#22d3ee' : d.suspicious ? '#f472b6' : d.online === false ? '#64748b' : '#34d399';
  const nameOf = d => d.alias || d.name || d.hostname || d.vendor || d.ip || 'Equipo';

  function layout(list) {
    const prev = new Map(M.nodes.map(n => [n.key, n]));
    let hubD = list.find(d => d.isGateway) || list.find(d => /router|gateway/i.test(d.type || ''));
    const hub = { key: '__hub', hub: true, d: hubD ? { ...hubD, gw: true } : { gw: true, alias: 'Tu red', ip: '', online: true }, r: 30, x: 0, y: 0 };
    const rest = list.filter(d => d !== hubD).sort((a, b) => String(a.type || '').localeCompare(String(b.type || '')) || String(a.ip).localeCompare(String(b.ip), undefined, { numeric: true }));
    const out = [hub], PER = [8, 14, 22, 30];
    let i = 0, ring = 0;
    while (i < rest.length) {
      const cap = PER[Math.min(ring, PER.length - 1)], n = Math.min(cap, rest.length - i), R = 190 + ring * 150;
      for (let j = 0; j < n; j++, i++) {
        const d = rest[i], key = String(d.mac || d.ip || i), a = (Math.PI * 2 * j) / n - Math.PI / 2 + ring * .35, p = prev.get(key);
        out.push({ key, d, r: 21, x: p ? p.x : Math.cos(a) * R, y: p ? p.y : Math.sin(a) * R, bx: 0, by: 0 });
      }
      ring++;
    }
    const ph = prev.get('__hub'); if (ph) { hub.x = ph.x; hub.y = ph.y; }
    M.nodes = out; M.sig = list.map(d => d.ip + (d.online ? 1 : 0)).join('|');
    if (cnt) { const on = list.filter(d => d.online !== false).length; cnt.innerHTML = `<b>${list.length}</b> equipos · <span style="color:#34d399">${on} en línea</span> · <span style="color:#94a3b8">${list.length - on} fuera</span>`; }
    if (!M.fitted) fit();
  }
  function fit() {
    if (!M.w || !M.nodes.length) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const n of M.nodes) { x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r + 30); }
    const pad = 50, k = Math.max(.2, Math.min(1.3, (M.w - pad * 2) / Math.max(1, x1 - x0), (M.h - pad * 2) / Math.max(1, y1 - y0)));
    M.cam = { k, x: M.w / 2 - k * (x0 + x1) / 2, y: M.h / 2 - k * (y0 + y1) / 2 }; M.fitted = true;
  }
  function resize() {
    const w = box.clientWidth, h = box.clientHeight; if (!w || !h) return;
    M.dpr = window.devicePixelRatio || 1; M.w = w; M.h = h; cv.width = Math.round(w * M.dpr); cv.height = Math.round(h * M.dpr);
    if (!M.fitted) fit();
  }
  const zoomAt = (px, py, f) => { const k0 = M.cam.k, k1 = Math.max(.2, Math.min(3.5, k0 * f)); M.cam.x = px - (px - M.cam.x) * k1 / k0; M.cam.y = py - (py - M.cam.y) * k1 / k0; M.cam.k = k1; };

  function draw(now) {
    if (!box.offsetParent) { M.raf = 0; return; }
    M.raf = requestAnimationFrame(draw);
    if (!M.w) return resize();
    g.setTransform(M.dpr, 0, 0, M.dpr, 0, 0); g.clearRect(0, 0, M.w, M.h);
    const { x, y, k } = M.cam;
    // fondo: grilla suave que acompaña el zoom
    const gs = 40 * k; if (gs > 8) { g.strokeStyle = 'rgba(148,163,184,.06)'; g.lineWidth = 1; g.beginPath(); for (let gx = ((x % gs) + gs) % gs; gx < M.w; gx += gs) { g.moveTo(gx, 0); g.lineTo(gx, M.h); } for (let gy = ((y % gs) + gs) % gs; gy < M.h; gy += gs) { g.moveTo(0, gy); g.lineTo(M.w, gy); } g.stroke(); }
    g.save(); g.translate(x, y); g.scale(k, k);
    const hub = M.nodes[0]; if (!hub) { g.restore(); return; }
    const act = M.drag ? M.drag.n : M.hover;
    for (const n of M.nodes) {
      if (n === hub) continue; const on = n.d.online !== false, hl = act === n || M.sel === n, c = colOf(n.d);
      g.beginPath(); g.moveTo(hub.x, hub.y); g.lineTo(n.x, n.y); g.lineWidth = hl ? 2.6 : 1.4; g.setLineDash(on ? [5, 9] : [2, 8]); g.lineDashOffset = on ? -(now / 45) % 14 : 0;
      g.strokeStyle = hl ? c : on ? c + '77' : 'rgba(100,116,139,.3)'; g.stroke();
    }
    g.setLineDash([]);
    for (const n of M.nodes) {
      const d = n.d, on = d.online !== false, c = n.hub ? '#22d3ee' : colOf(d), ph = ((now / 1400) + n.x * .01) % 1, yy = n.y + Math.sin(now / 1500 + n.x) * 1.5, r = n.r, hl = act === n || M.sel === n;
      if (on) { g.beginPath(); g.arc(n.x, yy, r + 3 + ph * 14, 0, 7); g.strokeStyle = c + Math.round((1 - ph) * 80).toString(16).padStart(2, '0'); g.lineWidth = 1.6; g.stroke(); }
      g.save(); g.shadowColor = c; g.shadowBlur = hl ? 30 : on ? 16 : 0;
      const gr = g.createRadialGradient(n.x - r * .3, yy - r * .4, r * .2, n.x, yy, r); gr.addColorStop(0, '#1e293b'); gr.addColorStop(1, '#0b1220');
      g.beginPath(); g.arc(n.x, yy, r, 0, 7); g.fillStyle = gr; g.fill(); g.lineWidth = n.hub ? 3.2 : 2.4; g.strokeStyle = c; g.stroke(); g.restore();
      if (M.sel === n) { g.beginPath(); g.arc(n.x, yy, r + 7, 0, 7); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.setLineDash([4, 4]); g.stroke(); g.setLineDash([]); }
      g.globalAlpha = on ? 1 : .55; g.font = Math.round(r * 1.0) + 'px "Segoe UI Emoji","Apple Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(iconOf(d), n.x, yy + 1);
      if (k > .5 || hl) {
        g.textBaseline = 'alphabetic'; g.font = '600 12px "Segoe UI",system-ui,sans-serif'; g.fillStyle = '#e2e8f0'; g.fillText(nameOf(d), n.x, yy + r + 16);
        if (k > .8 && d.ip) { g.font = '10.5px ui-monospace,Consolas,monospace'; g.fillStyle = '#94a3b8'; g.fillText(d.ip, n.x, yy + r + 30); }
      }
      g.globalAlpha = 1;
    }
    g.restore();
  }

  const pos = e => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const world = p => ({ x: (p.x - M.cam.x) / M.cam.k, y: (p.y - M.cam.y) / M.cam.k });
  const hit = p => { const w = world(p); let f = null; for (const n of M.nodes) if (Math.hypot(n.x - w.x, n.y - w.y) <= n.r + 6) f = n; return f; };
  const pts = new Map(); let pinch = 0;
  function detail(n) {
    const d = n.d, el = document.getElementById('lab-props-body'), info = document.getElementById('topo-info');
    const rows = [['IP', d.ip], ['MAC', d.mac], ['Fabricante', d.vendor], ['Tipo', d.type], ['Estado', d.online === false ? 'Sin respuesta' : 'En línea'], ['RTT', d.rtt != null ? d.rtt + ' ms' : d.lastRttMs != null ? d.lastRttMs + ' ms' : ''], ['Puertos', (d.ports || []).map(p => p.port || p).join(', ')]].filter(r => r[1]);
    if (el) el.innerHTML = `<div class="tp-card"><div class="tp-ic" style="border-color:${colOf(d)}">${iconOf(d)}</div><strong>${esc(nameOf(d))}</strong>${d.suspicious ? '<span class="tp-bad">⚠ desconocido</span>' : ''}</div><dl class="tp-dl">${rows.map(r => `<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>`;
    if (info) info.textContent = `${nameOf(d)} · ${d.ip || ''} · ${d.online === false ? 'sin respuesta' : 'en línea'}`;
  }
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); const p = pos(e); pts.set(e.pointerId, p);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); M.drag = M.pan = null; return; }
    M.moved = 0; tip.style.display = 'none'; const n = hit(p);
    if (n) M.drag = { n, lx: p.x, ly: p.y }; else M.pan = { lx: p.x, ly: p.y }; cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('pointermove', e => {
    const p = pos(e); if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
    if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch); pinch = d; return; }
    if (M.drag) { const n = M.drag.n; M.moved += Math.abs(p.x - M.drag.lx) + Math.abs(p.y - M.drag.ly); M.drag.lx = p.x; M.drag.ly = p.y; if (M.moved > 4) { const w = world(p); n.x = w.x; n.y = w.y; } return; }
    if (M.pan) { M.cam.x += p.x - M.pan.lx; M.cam.y += p.y - M.pan.ly; M.moved += Math.abs(p.x - M.pan.lx) + Math.abs(p.y - M.pan.ly); M.pan.lx = p.x; M.pan.ly = p.y; return; }
    const n = hit(p); M.hover = n; cv.style.cursor = n ? 'pointer' : 'grab';
    if (!n) { tip.style.display = 'none'; return; }
    const d = n.d; tip.innerHTML = `<b>${esc(nameOf(d))}</b><br><span class="mono">${esc(d.ip || '')}</span>${d.mac ? ' · <span class="mono">' + esc(d.mac) + '</span>' : ''}<br>${esc(d.type || '')}${d.vendor ? ' · ' + esc(d.vendor) : ''}<br><span style="color:${colOf(d)}">●</span> ${d.online === false ? 'Fuera de línea' : 'En línea'}`;
    tip.style.display = 'block'; tip.style.left = Math.min(p.x + 16, M.w - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(p.y + 16, M.h - tip.offsetHeight - 8) + 'px';
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; const n = M.drag && M.drag.n; if (n && M.moved < 5) { M.sel = n; detail(n); } else if (!n && M.pan && M.moved < 5) M.sel = null; M.drag = M.pan = null; cv.style.cursor = 'grab'; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { M.hover = null; tip.style.display = 'none'; });
  // Rueda: zoom con Ctrl (o en pantalla completa). Sin Ctrl la página sigue scrolleando normal.
  cv.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey || box.classList.contains('full'))) return; e.preventDefault(); const p = pos(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  cv.addEventListener('dblclick', e => { if (!hit(pos(e))) { M.fitted = false; fit(); } });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-tz]'); if (!b) return; const a = b.dataset.tz;
    if (a === 'fit') { M.fitted = false; return fit(); }
    if (a === 'full') { box.classList.toggle('full'); document.body.classList.toggle('tmap-lock', box.classList.contains('full')); b.textContent = box.classList.contains('full') ? '✕' : '⛶'; setTimeout(() => { resize(); M.fitted = false; fit(); }, 60); return; }
    zoomAt(M.w / 2, M.h / 2, a === 'in' ? 1.25 : .8);
  });
  setInterval(() => { const sec = document.getElementById('topology'); if (box.classList.contains('full') && sec && !sec.classList.contains('active')) { box.classList.remove('full'); document.body.classList.remove('tmap-lock'); } }, 500);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('full')) box.querySelector('[data-tz=full]').click(); });
  if (window.ResizeObserver) new ResizeObserver(resize).observe(box); window.addEventListener('resize', resize);

  async function load() {
    const sec = document.getElementById('topology'); if (!sec || !sec.classList.contains('active')) return;
    let list = [];
    try { const s = await api('/api/agent/snapshot'); list = (s.snapshot && s.snapshot.devices) || []; } catch (_) {}
    if (!list.length) { try { list = ((await api('/api/devices')).devices) || []; } catch (_) {} }
    box.classList.toggle('empty', !list.length);
    const sig = list.map(d => d.ip + (d.online ? 1 : 0)).join('|'); if (sig !== M.sig || !M.nodes.length) layout(list);
    if (!M.raf) M.raf = requestAnimationFrame(draw);
  }
  window.IPHUB_topoLoad = load;
  new MutationObserver(() => { const s = document.getElementById('topology'); if (s && s.classList.contains('active')) { resize(); load(); } }).observe(document.getElementById('topology'), { attributes: true, attributeFilter: ['class'] });
  const dl = document.getElementById('device-list'); if (dl) new MutationObserver(load).observe(dl, { childList: true });
  setInterval(load, 8000); setTimeout(() => { resize(); load(); }, 400);
  M.draw = draw; window.__tmap = M; // para pruebas
})();
