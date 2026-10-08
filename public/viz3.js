/* IPHub Viz: Radial + Globo con TODOS los hosts. Compartido por la web y el exe. Sin dependencias. */
(function (root) {
  const LAND = [[[70, -165], [60, -140], [50, -125], [32, -117], [22, -106], [16, -95], [8, -80], [20, -88], [25, -97], [30, -88], [26, -80], [35, -75], [45, -66], [52, -56], [60, -64], [70, -90], [72, -125]], [[12, -72], [5, -77], [-5, -81], [-18, -70], [-40, -73], [-55, -69], [-52, -60], [-35, -54], [-23, -41], [-8, -35], [5, -52], [11, -62]], [[36, -9], [43, -9], [48, -4], [54, 8], [60, 5], [70, 25], [65, 40], [55, 30], [45, 30], [40, 25], [38, 15], [44, 8], [36, 0]], [[35, -6], [32, 10], [31, 32], [12, 44], [-2, 41], [-15, 40], [-26, 33], [-34, 20], [-22, 14], [-5, 9], [5, -8], [14, -17], [28, -13]], [[70, 40], [72, 100], [65, 140], [55, 160], [45, 142], [30, 122], [20, 110], [8, 105], [8, 77], [24, 68], [30, 50], [38, 40], [45, 45], [55, 60]], [[-12, 131], [-12, 142], [-25, 153], [-38, 146], [-35, 117], [-22, 114]], [[60, -45], [72, -30], [82, -40], [76, -60], [65, -52]]];
  const rad = Math.PI / 180, esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPE = { router: 'Router', pc: 'PC', phone: 'Celular', tv: 'TV', printer: 'Impresora', nas: 'NAS', camera: 'Cámara', iot: 'IoT', console: 'Consola', speaker: 'Parlante', server: 'Servidor', vm: 'VM', unknown: 'Desconocido' };
  const col = d => !d.online ? '#64748b' : d.trusted ? '#10b981' : (d.risk || 0) >= 60 ? '#ef4444' : (d.risk || 0) >= 30 ? '#f59e0b' : '#06b6d4';
  const EMO = { router: '⌁', pc: '▭', phone: '▯', tv: '▣', printer: '⎙', nas: '▤', camera: '◉', iot: '✦', console: '◈', speaker: '♪', server: '▦', vm: '◇', unknown: '?' };
  const nm = d => d.name || d.vendor || d.model || d.ip || '—';
  function mount(rootEl, opts) {
    opts = opts || {};
    rootEl.innerHTML = '<div class="ivz"><div class="ivz-stage"><canvas class="ivz-c"></canvas><div class="ivz-hint"></div><div class="ivz-ctl"><button data-z="in">+</button><button data-z="out">−</button><button data-z="fit">⤢</button></div></div><aside class="ivz-side"><div class="ivz-info"><b>Seleccioná un host</b><br><span>Tocá un nodo para ver sus datos.</span></div><div class="ivz-leg"></div></aside></div>';
    const $ = s => rootEl.querySelector(s), cv = $('.ivz-c'), g = cv.getContext('2d'), stage = $('.ivz-stage');
    let mode = 'radial', W = 600, H = 420, dpr = 1, raf = 0, sel = null, hover = null, hit = [];
    const R = { cam: { x: 0, y: 0, k: 1 }, drag: null, nodes: [] };
    const G = { lon: -58 * rad, lat: 10 * rad, zoom: 1, drag: null, auto: true, tgt: null };
    const devs = () => (opts.getDevices ? opts.getDevices() : []) || [];
    const geo = () => (opts.getGeo && opts.getGeo()) || { lat: -34.6, lon: -58.4, city: 'Ubicación estimada' };
    function size() { const r = stage.getBoundingClientRect(); W = Math.max(300, r.width); H = Math.max(360, Math.min(640, innerHeight * .68)); dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    /* ---------- RADIAL ---------- */
    function layoutRadial() {
      const all = devs().filter(d => !d.deleted && !d.ignored);
      const hub = all.find(d => d.isGateway) || all.find(d => d.me) || null;
      const rest = all.filter(d => d !== hub).sort((a, b) => (a.type || 'z').localeCompare(b.type || 'z') || String(a.ip).localeCompare(String(b.ip), undefined, { numeric: true }));
      const nodes = []; if (hub) nodes.push({ d: hub, x: 0, y: 0, r: 26, hub: true });
      let i = 0, ring = 1, rr = 105;
      while (i < rest.length) {
        const cap = Math.max(6, Math.floor(2 * Math.PI * rr / 50)), n = Math.min(cap, rest.length - i), off = ring * .5;
        for (let j = 0; j < n; j++) { const a = j / n * Math.PI * 2 - Math.PI / 2 + off, d = rest[i + j]; nodes.push({ d, x: Math.cos(a) * rr, y: Math.sin(a) * rr, r: d.me ? 17 : 14, ring, a }); }
        i += n; ring++; rr += 66;
      }
      R.nodes = nodes; R.rings = ring - 1; R.maxR = rr; fitRadial();
    }
    function fitRadial() { const m = (R.maxR || 120) + 50, k = Math.min(W, H) / 2 / m; R.cam = { k: Math.min(1.6, k), x: W / 2, y: H / 2 }; }
    function drawRadial(now) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const bg = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, Math.max(W, H) * .7); bg.addColorStop(0, 'rgba(34,211,238,.07)'); bg.addColorStop(1, 'rgba(10,22,40,0)'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const c = R.cam; g.setTransform(dpr * c.k, 0, 0, dpr * c.k, dpr * c.x, dpr * c.y);
      for (let i = 1; i <= (R.rings || 0); i++) { g.beginPath(); g.arc(0, 0, 105 + (i - 1) * 66, 0, 7); g.strokeStyle = 'rgba(148,163,184,.10)'; g.lineWidth = 1 / c.k; g.stroke(); }
      const hub = R.nodes.find(n => n.hub); hit = [];
      for (const n of R.nodes) { if (n.hub) continue; const on = n.d.online, hl = hover === n || sel === n.d.key; g.beginPath(); g.moveTo(hub ? 0 : n.x, hub ? 0 : n.y); g.lineTo(n.x, n.y); g.strokeStyle = hl ? col(n.d) : on ? col(n.d) + '33' : 'rgba(100,116,139,.12)'; g.lineWidth = (hl ? 2 : 1) / c.k; g.stroke(); }
      for (const n of R.nodes) {
        const d = n.d, cc = n.hub ? '#06b6d4' : col(d), ph = (now / 1400 + n.x * .01) % 1;
        if (d.online) { g.beginPath(); g.arc(n.x, n.y, n.r + 3 + ph * 10, 0, 7); g.strokeStyle = cc + Math.round((1 - ph) * 70).toString(16).padStart(2, '0'); g.lineWidth = 1.4 / c.k; g.stroke(); }
        g.save(); g.shadowColor = cc; g.shadowBlur = (hover === n || sel === d.key) ? 24 : d.online ? 12 : 0;
        const gr = g.createRadialGradient(n.x - n.r * .3, n.y - n.r * .4, 2, n.x, n.y, n.r); gr.addColorStop(0, '#1e3a5f'); gr.addColorStop(1, '#0b1220');
        g.beginPath(); g.arc(n.x, n.y, n.r, 0, 7); g.fillStyle = gr; g.fill(); g.lineWidth = d.me ? 3 : 2; g.strokeStyle = d.me ? '#a78bfa' : cc; g.stroke(); g.restore();
        if (window.icoDraw) window.icoDraw(g, d.isGateway ? 'router' : (d.type || 'help'), n.x, n.y + 1, n.r * 1.05, '#fff'); else { g.font = Math.round(n.r) + 'px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(EMO[d.isGateway ? 'router' : d.type] || '•', n.x, n.y + 1); g.textBaseline = 'alphabetic'; }
        if (c.k > .6 || hover === n || sel === d.key) { g.fillStyle = '#e2e8f0'; g.font = '600 ' + Math.round(11) + 'px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText(nm(d).slice(0, 18), n.x, n.y + n.r + 14); }
        hit.push({ x: n.x * c.k + c.x, y: n.y * c.k + c.y, r: n.r * c.k + 4, d });
      }
    }
    /* ---------- GLOBO ---------- */
    function P(lat, lon) { const φ = lat * rad, λ = lon * rad - G.lon, cp = Math.cos(φ), s0 = Math.sin(G.lat), c0 = Math.cos(G.lat); const x = cp * Math.sin(λ), y = c0 * Math.sin(φ) - s0 * cp * Math.cos(λ), z = s0 * Math.sin(φ) + c0 * cp * Math.cos(λ), r = Math.min(W, H) * .42 * G.zoom; return { x: W / 2 + x * r, y: H / 2 - y * r, z, v: z > 0 }; }
    function placeHosts() { // todos los hosts alrededor del sitio local (espiral de girasol: ninguno se superpone)
      const a = geo(), all = devs().filter(d => !d.deleted && !d.ignored), hub = all.find(d => d.isGateway) || all.find(d => d.me);
      const out = []; let i = 0;
      for (const d of all) { if (d === hub) { out.push({ d, lat: a.lat, lon: a.lon, hub: true }); continue; } i++; const rr = .35 * Math.sqrt(i) , t = i * 2.39996; out.push({ d, lat: a.lat + Math.sin(t) * rr, lon: a.lon + Math.cos(t) * rr / Math.max(.3, Math.cos(a.lat * rad)) }); }
      return out;
    }
    function arcPts(a, b, n) { const v = (la, lo) => [Math.cos(la * rad) * Math.cos(lo * rad), Math.cos(la * rad) * Math.sin(lo * rad), Math.sin(la * rad)], A = v(a.lat, a.lon), B = v(b.lat, b.lon), om = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]))) || 1e-6, out = []; for (let i = 0; i <= n; i++) { const t = i / n, s1 = Math.sin((1 - t) * om) / Math.sin(om), s2 = Math.sin(t * om) / Math.sin(om), p = [A[0] * s1 + B[0] * s2, A[1] * s1 + B[1] * s2, A[2] * s1 + B[2] * s2], l = 1 + .12 * Math.sin(Math.PI * t), la = Math.asin(Math.max(-1, Math.min(1, p[2]))) / rad, lo = Math.atan2(p[1], p[0]) / rad, q = P(la, lo); const rr = Math.min(W, H) * .42 * G.zoom; q.x = W / 2 + (q.x - W / 2) * l; q.y = H / 2 + (q.y - H / 2) * l; out.push(q); } return out; }
    function drawGlobe(now, dt) {
      if (G.tgt) { G.lon += (G.tgt.lon - G.lon) * Math.min(1, dt * 3); G.lat += (G.tgt.lat - G.lat) * Math.min(1, dt * 3); if (Math.abs(G.tgt.lon - G.lon) + Math.abs(G.tgt.lat - G.lat) < .002) G.tgt = null; } else if (G.auto && !G.drag && G.zoom < 2) G.lon += dt * .1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); const r = Math.min(W, H) * .42 * G.zoom, cx = W / 2, cy = H / 2;
      g.fillStyle = 'rgba(34,211,238,.06)'; g.beginPath(); g.arc(cx, cy, r * 1.07, 0, 7); g.fill();
      const bg = g.createRadialGradient(cx - r * .3, cy - r * .3, r * .1, cx, cy, r * 1.1); bg.addColorStop(0, '#12304f'); bg.addColorStop(1, '#06101f'); g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(34,211,238,.4)'; g.lineWidth = 1.2; g.stroke();
      g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip();
      g.strokeStyle = 'rgba(148,163,184,.12)'; g.lineWidth = .6;
      for (let la = -60; la <= 60; la += 30) { g.beginPath(); let s = false; for (let lo = -180; lo <= 180; lo += 6) { const p = P(la, lo); if (p.v) { s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); s = true; } else s = false; } g.stroke(); }
      for (let lo = -180; lo < 180; lo += 30) { g.beginPath(); let s = false; for (let la = -85; la <= 85; la += 5) { const p = P(la, lo); if (p.v) { s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); s = true; } else s = false; } g.stroke(); }
      g.fillStyle = 'rgba(52,211,153,.18)'; g.strokeStyle = 'rgba(52,211,153,.45)';
      for (const poly of LAND) { g.beginPath(); let any = false; poly.forEach((q, i) => { const p = P(q[0], q[1]); if (p.v) { i && any ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); any = true; } }); if (any) { g.closePath(); g.fill(); g.stroke(); } }
      g.restore();
      const a = geo(), hosts = placeHosts(), remote = (opts.getRemote && opts.getRemote()) || []; hit = [];
      for (const h of remote) { if (h.lat == null) continue; const pts = arcPts(a, h, 32); g.beginPath(); let s = false; pts.forEach(p => { if (p.z > 0) { s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); s = true; } else s = false; }); g.strokeStyle = 'rgba(167,139,250,.55)'; g.lineWidth = 1.3; g.stroke(); const q = P(h.lat, h.lon); if (q.v) { g.fillStyle = '#a78bfa'; g.beginPath(); g.arc(q.x, q.y, 3.5, 0, 7); g.fill(); hit.push({ x: q.x, y: q.y, r: 9, d: { name: h.label || h.ip, ip: h.ip, vendor: [h.city, h.country].filter(Boolean).join(', '), online: true, type: 'server' } }); } }
      const hubS = P(a.lat, a.lon);
      hosts.forEach((h, i) => { const s = P(h.lat, h.lon); if (!s.v) return; const c = h.hub ? '#06b6d4' : col(h.d), on = h.d.online, big = h.hub ? 6 : Math.max(2.2, Math.min(5, 1.6 + G.zoom * .5));
        if (!h.hub && hubS.v && G.zoom > 3) { g.beginPath(); g.moveTo(hubS.x, hubS.y); g.lineTo(s.x, s.y); g.strokeStyle = c + '30'; g.lineWidth = .7; g.stroke(); }
        const pulse = on ? 1 + .25 * Math.sin(now / 300 + i) : 1; g.save(); g.shadowColor = c; g.shadowBlur = on ? 10 : 0; g.fillStyle = c; g.beginPath(); g.arc(s.x, s.y, big * pulse, 0, 7); g.fill(); g.restore();
        if (sel === h.d.key) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(s.x, s.y, big + 5, 0, 7); g.stroke(); }
        if (G.zoom > 6 || hover && hover.d === h.d || sel === h.d.key) { g.fillStyle = '#e2e8f0'; g.font = '600 10px system-ui'; g.textAlign = 'center'; g.fillText(nm(h.d).slice(0, 16), s.x, s.y - big - 5); }
        hit.push({ x: s.x, y: s.y, r: Math.max(8, big + 4), d: h.d, lat: h.lat, lon: h.lon }); });
      g.fillStyle = 'rgba(148,163,184,.85)'; g.font = '10px system-ui'; g.textAlign = 'left'; g.fillText(hosts.length + ' hosts · ' + (a.city || '') + ' · zoom ×' + G.zoom.toFixed(1) + ' (acercá para separarlos)', 10, H - 10);
    }
    /* ---------- loop / interacción ---------- */
    let t0 = performance.now();
    function frame(now) { raf = requestAnimationFrame(frame); if (!rootEl.offsetParent) return; const dt = Math.min(50, now - t0) / 1000; t0 = now; if (!cv.width) size(); mode === 'radial' ? drawRadial(now) : drawGlobe(now, dt); }
    function info(d) { sel = d.key || d.ip; const rows = [['IP', d.ip], ['MAC', d.mac], ['Fabricante', d.vendor], ['Tipo', TYPE[d.type] || d.type], ['Estado', d.online ? 'En línea' : 'Sin conexión'], ['Riesgo', d.risk != null ? d.risk : ''], ['SO', d.os && (d.os.name || d.os)], ['Puertos', (d.ports || []).map(p => p.port).join(', ')]].filter(r => r[1] !== '' && r[1] != null);
      $('.ivz-info').innerHTML = '<b style="color:' + col(d) + '">' + esc(nm(d)) + '</b>' + rows.map(r => '<div><span>' + r[0] + '</span> ' + esc(r[1]) + '</div>').join(''); }
    function legend() { const all = devs().filter(d => !d.deleted && !d.ignored), cnt = {}; all.forEach(d => { const t = d.type || 'unknown'; cnt[t] = (cnt[t] || 0) + 1; });
      $('.ivz-leg').innerHTML = '<div class="ivz-tot">' + all.length + ' hosts · ' + all.filter(d => d.online).length + ' en línea</div>' + [['#10b981', 'Confiable'], ['#06b6d4', 'Riesgo bajo'], ['#f59e0b', 'Medio'], ['#ef4444', 'Alto'], ['#64748b', 'Offline']].map(c => '<span><i style="background:' + c[0] + '"></i>' + c[1] + '</span>').join('') + '<hr>' + Object.keys(cnt).sort().map(t => '<span>' + esc(TYPE[t] || t) + ' <b>' + cnt[t] + '</b></span>').join(''); }
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pick = p => hit.slice().reverse().find(h => Math.hypot(h.x - p.x, h.y - p.y) <= h.r);
    cv.addEventListener('pointerdown', e => { const p = pos(e); cv.setPointerCapture(e.pointerId); if (mode === 'radial') R.drag = { x: p.x, y: p.y, cx: R.cam.x, cy: R.cam.y, m: 0 }; else { G.drag = { x: p.x, y: p.y, lon: G.lon, lat: G.lat, m: 0 }; G.tgt = null; } });
    cv.addEventListener('pointermove', e => { const p = pos(e), dr = mode === 'radial' ? R.drag : G.drag;
      if (dr) { const dx = p.x - dr.x, dy = p.y - dr.y; dr.m = Math.max(dr.m, Math.abs(dx) + Math.abs(dy)); if (mode === 'radial') { R.cam.x = dr.cx + dx; R.cam.y = dr.cy + dy; } else { const k = .005 / G.zoom; G.lon = dr.lon - dx * k; G.lat = Math.max(-1.4, Math.min(1.4, dr.lat + dy * k)); } return; }
      const h = pick(p); hover = h ? (mode === 'radial' ? R.nodes.find(n => n.d === h.d) : h) : null; cv.style.cursor = h ? 'pointer' : 'grab'; });
    cv.addEventListener('pointerup', e => { const dr = mode === 'radial' ? R.drag : G.drag; R.drag = G.drag = null; if (dr && dr.m < 5) { const h = pick(pos(e)); if (h) { info(h.d); if (mode === 'globe' && h.lat != null) G.tgt = { lon: h.lon * rad, lat: h.lat * rad }; } } });
    cv.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const f = e.deltaY < 0 ? 1.15 : .87; if (mode === 'radial') { const p = pos(e), c = R.cam, k = Math.max(.25, Math.min(4, c.k * f)); c.x = p.x - (p.x - c.x) * k / c.k; c.y = p.y - (p.y - c.y) * k / c.k; c.k = k; } else G.zoom = Math.max(.7, Math.min(60, G.zoom * f)); }, { passive: false });
    rootEl.querySelector('.ivz-ctl').onclick = e => { const z = e.target.dataset.z; if (!z) return; if (mode === 'radial') { if (z === 'fit') fitRadial(); else { R.cam.k = Math.max(.25, Math.min(4, R.cam.k * (z === 'in' ? 1.25 : .8))); } } else { if (z === 'fit') { G.zoom = 1; G.tgt = { lon: geo().lon * rad, lat: geo().lat * rad }; } else G.zoom = Math.max(.7, Math.min(60, G.zoom * (z === 'in' ? 1.4 : .7))); } };
    addEventListener('resize', () => { size(); if (mode === 'radial') fitRadial(); });
    function show(m) { mode = m; sel = null; hover = null; size(); legend(); if (m === 'radial') layoutRadial(); else G.tgt = { lon: geo().lon * rad, lat: geo().lat * rad }; $('.ivz-hint').textContent = m === 'radial' ? 'Arrastrá para mover · rueda para zoom · tocá un host' : 'Arrastrá para girar · rueda para acercar: todos los hosts del sitio se separan'; if (!raf) raf = requestAnimationFrame(frame); }
    return { show, refresh() { legend(); if (mode === 'radial') layoutRadial(); } };
  }
  root.IPHubViz = { mount };
})(window);
