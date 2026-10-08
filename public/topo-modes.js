/* Modos de visualización de Topología: Global Carrier Explorer (globo 3D en canvas) + IPv6 Radial Hierarchy (sunburst). Se AGREGAN al mapa existente. */
(function () {
  const sec = document.getElementById('topology'); if (!sec) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (m, e) => { try { toast(m, e); } catch (_) {} };
  const COL = { local: '#34d399', pop: '#22d3ee', ixp: '#a78bfa', carrier: '#fbbf24', device: '#f472b6', backbone: 'rgba(56,189,248,.45)' };
  const NAME = { local: 'Host local', pop: 'POP', ixp: 'IXP', carrier: 'Carrier', device: 'Dispositivo destino' };
  let LAST = null, mode = 'actual';
  // ---------- barra de modos ----------
  const bar = document.createElement('div'); bar.className = 'tm-bar';
  bar.innerHTML = '<button type="button" data-m="actual" class="on">Mapa de red</button><button type="button" data-m="globe">' + IC('globe') + ' Global Carrier Explorer</button><button type="button" data-m="radial">' + IC('target') + ' IPv6 Radial Hierarchy</button><button type="button" data-m="intercept" id="tm-int" hidden>' + IC('packet') + ' Interceptar</button>';
  const ibox = document.createElement('div'); ibox.className = 'tm-box hidden'; ibox.innerHTML = '<p class="muted small">Peticiones HTTP de esta red en vivo, con cabeceras, cuerpo y paquete crudo. Solo visible para el dueño.</p><div id="tm-int-root"></div>'; let imount = null;
  const isOwn = () => !!((typeof ME !== 'undefined' && ME) && ME.isOwner);
  const gbox = document.createElement('div'); gbox.className = 'tm-box hidden'; gbox.innerHTML = '<div class="tool-form"><input id="gl-target" value="8.8.8.8" placeholder="IP o dominio destino"><button class="btn btn-primary btn-sm" id="gl-go" type="button">Trazar en el globo</button><span class="muted small" id="gl-msg">Arrastrá para girar · rueda para zoom · el zoom revela más nodos.</span></div><div class="gl-wrap"><canvas id="gl-c"></canvas><div class="gl-leg" id="gl-leg"></div><div class="gl-info" id="gl-info"></div></div>';
  const rbox = document.createElement('div'); rbox.className = 'tm-box hidden'; rbox.innerHTML = '<div class="tool-form"><button class="btn btn-sm btn-primary" id="rd-demo" type="button">Datos de ejemplo</button><button class="btn btn-sm g" id="rd-trace" type="button">Desde mi última traza del globo</button><span class="muted small" id="rd-msg">Clic en un gajo para expandirlo · clic en el centro para volver.</span></div><div class="rd-wrap"><svg id="rd-svg" viewBox="-400 -400 800 800"></svg><div class="gl-info" id="rd-info"></div></div>';
  const hdr = sec.querySelector('.section-header'); (hdr || sec.firstChild).after(bar); bar.after(gbox, rbox, ibox); setInterval(() => { const b = bar.querySelector('#tm-int'); if (b) b.hidden = !isOwn(); }, 1500);
  const setMode = m => {
    mode = m; bar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
    [...sec.children].forEach(c => { if (c !== hdr && c !== bar && c !== gbox && c !== rbox && c !== ibox) c.classList.toggle('tm-hide', m !== 'actual'); });
    gbox.classList.toggle('hidden', m !== 'globe'); rbox.classList.toggle('hidden', m !== 'radial'); ibox.classList.toggle('hidden', m !== 'intercept');
    if (m === 'intercept') { if (!isOwn()) { T('Solo el dueño puede usar Interceptar', true); return setMode('actual'); } if (!imount && window.IPHubIntercept) imount = window.IPHubIntercept.mount(ibox.querySelector('#tm-int-root'), () => mode === 'intercept'); if (imount) imount.poll(); }
    if (m === 'globe') { sizeG(); if (!LAST) go(); } if (m === 'radial' && !RD.root) demo();
  };
  bar.onclick = e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); };

  // ---------- GLOBO ----------
  const cv = gbox.querySelector('#gl-c'), g = cv.getContext('2d');
  const CITIES = [['New York', 40.7, -74], ['Miami', 25.8, -80.2], ['Los Angeles', 34, -118.2], ['Chicago', 41.9, -87.6], ['Toronto', 43.7, -79.4], ['Mexico City', 19.4, -99.1], ['Bogotá', 4.7, -74.1], ['Lima', -12, -77], ['São Paulo', -23.5, -46.6], ['Buenos Aires', -34.6, -58.4], ['Santiago', -33.4, -70.6], ['London', 51.5, -0.1], ['Paris', 48.9, 2.3], ['Frankfurt', 50.1, 8.7], ['Amsterdam', 52.4, 4.9], ['Madrid', 40.4, -3.7], ['Stockholm', 59.3, 18.1], ['Moscow', 55.8, 37.6], ['Istanbul', 41, 29], ['Dubai', 25.2, 55.3], ['Mumbai', 19.1, 72.9], ['Singapore', 1.35, 103.8], ['Hong Kong', 22.3, 114.2], ['Tokyo', 35.7, 139.7], ['Seoul', 37.6, 127], ['Sydney', -33.9, 151.2], ['Johannesburg', -26.2, 28], ['Lagos', 6.5, 3.4], ['Cairo', 30, 31.2], ['Nairobi', -1.3, 36.8]];
  const HUBS = new Set(['New York', 'Miami', 'Los Angeles', 'São Paulo', 'London', 'Frankfurt', 'Amsterdam', 'Singapore', 'Tokyo', 'Sydney', 'Mumbai', 'Johannesburg', 'Dubai', 'Hong Kong']);
  const BACK = [['New York', 'London'], ['Miami', 'São Paulo'], ['New York', 'Miami'], ['Los Angeles', 'Tokyo'], ['Los Angeles', 'New York'], ['London', 'Frankfurt'], ['Frankfurt', 'Amsterdam'], ['Amsterdam', 'London'], ['Frankfurt', 'Dubai'], ['Dubai', 'Mumbai'], ['Mumbai', 'Singapore'], ['Singapore', 'Hong Kong'], ['Hong Kong', 'Tokyo'], ['Singapore', 'Sydney'], ['São Paulo', 'Buenos Aires'], ['São Paulo', 'Johannesburg'], ['London', 'New York'], ['Johannesburg', 'Lagos'], ['Madrid', 'São Paulo'], ['Miami', 'Mexico City'], ['Lima', 'Santiago'], ['Santiago', 'Buenos Aires'], ['Moscow', 'Frankfurt'], ['Cairo', 'Dubai'], ['Nairobi', 'Johannesburg'], ['Seoul', 'Tokyo'], ['Paris', 'London'], ['Chicago', 'New York'], ['Toronto', 'New York'], ['Bogotá', 'Miami'], ['Stockholm', 'Amsterdam'], ['Istanbul', 'Frankfurt']];
  const CM = Object.fromEntries(CITIES.map(c => [c[0], c]));
  const LAND = [[[70, -165], [60, -140], [50, -125], [32, -117], [22, -106], [16, -95], [8, -80], [20, -88], [25, -97], [30, -88], [26, -80], [35, -75], [45, -66], [52, -56], [60, -64], [70, -90], [72, -125]], [[12, -72], [5, -77], [-5, -81], [-18, -70], [-40, -73], [-55, -69], [-52, -60], [-35, -54], [-23, -41], [-8, -35], [5, -52], [11, -62]], [[36, -9], [43, -9], [48, -4], [54, 8], [60, 5], [70, 25], [65, 40], [55, 30], [45, 30], [40, 25], [38, 15], [44, 8], [36, 0]], [[35, -6], [32, 10], [31, 32], [12, 44], [-2, 41], [-15, 40], [-26, 33], [-34, 20], [-22, 14], [-5, 9], [5, -8], [14, -17], [28, -13]], [[70, 40], [72, 100], [65, 140], [55, 160], [45, 142], [30, 122], [20, 110], [8, 105], [8, 77], [24, 68], [30, 50], [38, 40], [45, 45], [55, 60]], [[-12, 131], [-12, 142], [-25, 153], [-38, 146], [-35, 117], [-22, 114]], [[60, -45], [72, -30], [82, -40], [76, -60], [65, -52]]];
  let W = 600, H = 460, dpr = 1;
  const V = { lon: -50 * Math.PI / 180, lat: 15 * Math.PI / 180, zoom: 1, drag: null, auto: true, tgt: null };
  const rad = Math.PI / 180;
  function sizeG() { const r = cv.parentElement.getBoundingClientRect(); W = Math.max(300, r.width); H = Math.max(360, Math.min(560, innerHeight * .62)); dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(dpr, 0, 0, dpr, 0, 0); }
  addEventListener('resize', () => { if (mode === 'globe') sizeG(); });
  const R = () => Math.min(W, H) * 0.42 * V.zoom;
  function P(lat, lon, k = 1) { const φ = lat * rad, λ = lon * rad - V.lon, c = Math.cos(φ), s0 = Math.sin(V.lat), c0 = Math.cos(V.lat); const x = c * Math.sin(λ), y = c0 * Math.sin(φ) - s0 * c * Math.cos(λ), z = s0 * Math.sin(φ) + c0 * c * Math.cos(λ); const r = R() * k; return { x: W / 2 + x * r, y: H / 2 - y * r, z: z * k, v: z > 0.02 }; }
  const vec = (lat, lon) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)];
  const unv = v => [Math.asin(Math.max(-1, Math.min(1, v[2]))) / rad, Math.atan2(v[1], v[0]) / rad];
  function arc(a, b, n = 28, lift = .09) { const A = vec(a[0], a[1]), B = vec(b[0], b[1]); const d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]))) || 1e-6, out = []; for (let i = 0; i <= n; i++) { const t = i / n, s1 = Math.sin((1 - t) * d) / Math.sin(d), s2 = Math.sin(t * d) / Math.sin(d); const v = [s1 * A[0] + s2 * B[0], s1 * A[1] + s2 * B[1], s1 * A[2] + s2 * B[2]]; const [la, lo] = unv(v); out.push(P(la, lo, 1 + lift * Math.sin(Math.PI * t) * Math.min(1, d / 1.2))); } return out; }
  // hosts de fondo (deterministas): se agrupan según el zoom (LOD)
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const HOSTS = []; CITIES.forEach(c => { const n = HUBS.has(c[0]) ? 26 : 12; for (let i = 0; i < n; i++) HOSTS.push({ lat: c[1] + (rnd() - .5) * 5, lon: c[2] + (rnd() - .5) * 6, city: c[0] }); });
  // clustering por celdas en pantalla: radio en px según zoom → menos nodos cuando se aleja
  function cluster(pts, cell) { const m = new Map(); for (const p of pts) { if (!p.s.v) continue; const k = Math.floor(p.s.x / cell) + ':' + Math.floor(p.s.y / cell); const c = m.get(k); if (c) { c.n++; c.x += p.s.x; c.y += p.s.y; } else m.set(k, { n: 1, x: p.s.x, y: p.s.y }); } return [...m.values()].map(c => ({ n: c.n, x: c.x / c.n, y: c.y / c.n })); }
  const pathPts = () => { if (!LAST) return []; const a = []; if (LAST.local) a.push(LAST.local); LAST.nodes.forEach(n => a.push(n)); return a; };
  let t0 = performance.now();
  function frame(now) {
    requestAnimationFrame(frame); if (mode !== 'globe') return;
    const dt = Math.min(50, now - t0) / 1000; t0 = now;
    if (V.tgt) { V.lon += (V.tgt.lon - V.lon) * Math.min(1, dt * 3); V.lat += (V.tgt.lat - V.lat) * Math.min(1, dt * 3); if (Math.abs(V.tgt.lon - V.lon) + Math.abs(V.tgt.lat - V.lat) < .002) V.tgt = null; }
    else if (V.auto && !V.drag) V.lon += dt * 0.12;
    g.clearRect(0, 0, W, H); const r = R(), cx = W / 2, cy = H / 2;
    const bg = g.createRadialGradient(cx - r * .3, cy - r * .3, r * .1, cx, cy, r * 1.1); bg.addColorStop(0, '#12304f'); bg.addColorStop(1, '#06101f');
    g.fillStyle = 'rgba(34,211,238,.06)'; g.beginPath(); g.arc(cx, cy, r * 1.08, 0, 7); g.fill();
    g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(34,211,238,.35)'; g.lineWidth = 1.2; g.stroke();
    g.strokeStyle = 'rgba(148,163,184,.12)'; g.lineWidth = .6;
    for (let la = -60; la <= 60; la += 30) { g.beginPath(); let st = false; for (let lo = -180; lo <= 180; lo += 6) { const p = P(la, lo); if (p.v) { st ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); st = true; } else st = false; } g.stroke(); }
    for (let lo = -180; lo < 180; lo += 30) { g.beginPath(); let st = false; for (let la = -85; la <= 85; la += 5) { const p = P(la, lo); if (p.v) { st ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); st = true; } else st = false; } g.stroke(); }
    g.fillStyle = 'rgba(52,211,153,.16)'; g.strokeStyle = 'rgba(52,211,153,.4)';
    for (const poly of LAND) { g.beginPath(); let any = false; poly.forEach((q, i) => { const p = P(q[0], q[1]); if (p.v) { i && any ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); any = true; } }); if (any) { g.closePath(); g.fill(); g.stroke(); } }
    // backbones (siempre) — grosor por importancia
    for (const [a, b] of BACK) { const pts = arc(CM[a], CM[b]); g.beginPath(); let s = false; pts.forEach(p => { if (p.z > 0) { s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); s = true; } else s = false; }); g.strokeStyle = COL.backbone; g.lineWidth = HUBS.has(a) && HUBS.has(b) ? 1.8 : 1; g.stroke(); }
    // LOD: lejos → ciudades hub; medio → todas; cerca → hosts (agrupados)
    const z = V.zoom, cs = CITIES.map(c => ({ c, s: P(c[1], c[2]) }));
    for (const { c, s } of cs) { if (!s.v) continue; const hub = HUBS.has(c[0]); if (z < 1.3 && !hub) continue; g.fillStyle = hub ? '#e2e8f0' : '#94a3b8'; g.beginPath(); g.arc(s.x, s.y, hub ? 3 : 2, 0, 7); g.fill(); if (z > 1.15 || hub && z > .9) { g.fillStyle = 'rgba(226,232,240,.75)'; g.font = '10px system-ui'; g.fillText(c[0], s.x + 5, s.y - 4); } }
    if (z > 1.1) { const pts = HOSTS.map(h => ({ s: P(h.lat, h.lon) })); const cell = z > 3 ? 8 : z > 2 ? 18 : 34; const cl = cluster(pts, cell); for (const c of cl) { if (c.n > 1) { g.fillStyle = 'rgba(56,189,248,.28)'; g.beginPath(); g.arc(c.x, c.y, 5 + Math.min(9, Math.log2(c.n) * 2.2), 0, 7); g.fill(); if (z > 1.4) { g.fillStyle = '#e2e8f0'; g.font = '9px system-ui'; g.textAlign = 'center'; g.fillText(c.n, c.x, c.y + 3); g.textAlign = 'start'; } } else { g.fillStyle = 'rgba(148,163,184,.8)'; g.fillRect(c.x - 1, c.y - 1, 2, 2); } } }
    // ruta real: Local → POP → IXP → Carrier → Dispositivo
    const pp = pathPts(); NODES = [];
    for (let i = 1; i < pp.length; i++) { const a = pp[i - 1], b = pp[i], pts = arc([a.lat, a.lon], [b.lat, b.lon], 36, .12), c = COL[b.stage] || '#fff'; g.beginPath(); let s = false; pts.forEach(p => { if (p.z > 0) { s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); s = true; } else s = false; }); g.strokeStyle = c; g.lineWidth = b.stage === 'carrier' ? 3 : 2.2; g.shadowColor = c; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
      for (let k = 0; k < 3; k++) { const u = ((now / 1400) + k / 3 + i * .17) % 1, p = pts[Math.floor(u * (pts.length - 1))]; if (p && p.z > 0) { g.fillStyle = '#fff'; g.shadowColor = c; g.shadowBlur = 10; g.beginPath(); g.arc(p.x, p.y, 2.4, 0, 7); g.fill(); g.shadowBlur = 0; } } }
    pp.forEach((n, i) => { const s = P(n.lat, n.lon, 1); if (!s.v) return; const c = COL[n.stage]; const pulse = 1 + .25 * Math.sin(now / 300 + i); g.fillStyle = c; g.shadowColor = c; g.shadowBlur = 14; g.beginPath(); g.arc(s.x, s.y, 5 * pulse, 0, 7); g.fill(); g.shadowBlur = 0; g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); NODES.push({ n, s }); if (z > .9) { g.fillStyle = '#fff'; g.font = 'bold 10px system-ui'; g.fillText((NAME[n.stage] || '') + (n.city ? ' · ' + n.city : ''), s.x + 8, s.y + 3); } });
    g.fillStyle = 'rgba(148,163,184,.8)'; g.font = '10px system-ui'; g.fillText('Zoom ×' + z.toFixed(1) + ' · ' + (z < 1.3 ? 'backbones y hubs' : z < 2.2 ? 'ciudades y clusters' : 'hosts individuales'), 10, H - 10);
  }
  let NODES = []; requestAnimationFrame(frame);
  cv.addEventListener('pointerdown', e => { V.drag = { x: e.clientX, y: e.clientY, lon: V.lon, lat: V.lat, moved: false }; V.tgt = null; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (!V.drag) return; const k = .005 / V.zoom; V.drag.moved = true; V.lon = V.drag.lon - (e.clientX - V.drag.x) * k; V.lat = Math.max(-1.3, Math.min(1.3, V.drag.lat + (e.clientY - V.drag.y) * k)); });
  cv.addEventListener('pointerup', e => { const d = V.drag; V.drag = null; if (d && !d.moved) { const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; const hit = NODES.find(o => Math.hypot(o.s.x - mx, o.s.y - my) < 11); if (hit) info(hit.n); } });
  cv.addEventListener('wheel', e => { e.preventDefault(); V.zoom = Math.max(.7, Math.min(6, V.zoom * (e.deltaY < 0 ? 1.12 : .89))); }, { passive: false });
  let pd = 0; cv.addEventListener('touchmove', e => { if (e.touches.length === 2) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); if (pd) V.zoom = Math.max(.7, Math.min(6, V.zoom * d / pd)); pd = d; } }, { passive: true }); cv.addEventListener('touchend', () => pd = 0);
  const info = n => { gbox.querySelector('#gl-info').innerHTML = `<b style="color:${COL[n.stage]}">${NAME[n.stage]}</b><br>${esc(n.ip || 'IP privada/oculta')}<br>${esc([n.city, n.country].filter(Boolean).join(', '))}${n.as ? '<br>' + esc(n.as) : ''}${n.org ? '<br>' + esc(n.org) : ''}${n.rtt != null ? '<br>RTT ' + n.rtt + ' ms' : ''}`; };
  gbox.querySelector('#gl-leg').innerHTML = Object.keys(NAME).map(k => `<span><i style="background:${COL[k]}"></i>${NAME[k]}</span>`).join('') + '<span><i style="background:rgba(56,189,248,.6)"></i>Backbone</span>';
  async function go() {
    const b = gbox.querySelector('#gl-go'), m = gbox.querySelector('#gl-msg'); b.disabled = true; m.textContent = 'Trazando y geolocalizando cada salto… (hasta 45 s)';
    try { const d = await api('/api/topo/globe', { method: 'POST', body: { target: gbox.querySelector('#gl-target').value.trim() } }); LAST = d; const pts = pathPts(); if (!pts.length) throw new Error('La traza no devolvió saltos públicos geolocalizables'); const mid = pts[Math.floor(pts.length / 2)]; V.tgt = { lon: mid.lon * rad, lat: mid.lat * rad }; V.auto = false; m.textContent = `${d.nodes.length} nodos públicos · ${d.tool}`; }
    catch (e) { m.textContent = e.message; T(e.message, true); }
    b.disabled = false;
  }
  gbox.querySelector('#gl-go').onclick = go; gbox.querySelector('#gl-target').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

  // ---------- IPv6 RADIAL (sunburst propio, sin dependencias) ----------
  const svg = rbox.querySelector('#rd-svg'), NS = 'http://www.w3.org/2000/svg';
  const RD = { root: null, focus: null, anim: 0 };
  const hex = n => n.toString(16);
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
  const mk = (name, prefix, kids, extra) => Object.assign({ name, prefix, children: kids }, extra || {});
  function demoData() {
    const ISPS = [['Telecom AR', 'LACNIC', '2800:'], ['Claro', 'LACNIC', '2800:'], ['Level3', 'ARIN', '2600:'], ['DT', 'RIPE', '2a02:'], ['NTT', 'APNIC', '2400:']];
    return mk('Internet', '::/0', ISPS.map((p, i) => mk(p[0], `${p[2]}${hex(0x100 + i)}::/32`, [0, 1, 2].map(s => mk(`${p[0]} · Sitio ${s + 1}`, `${p[2]}${hex(0x100 + i)}:${hex(s + 1)}::/48`, [0, 1, 2].map(n => mk(`Subred ${n}`, `${p[2]}${hex(0x100 + i)}:${hex(s + 1)}:${hex(n)}::/64`, Array.from({ length: 2 + (hash(p[0] + s + n) % 3) }, (_, h) => mk(`host-${h + 1}`, `…::${hex(1 + h)}`, null, { v: 1 })))))))));
  }
  function traceData() {
    if (!LAST || !LAST.nodes.length) return null; const byAs = {};
    LAST.nodes.forEach(n => { const k = n.as || n.org || 'AS?'; (byAs[k] = byAs[k] || []).push(n); });
    return mk('Internet', '::/0', Object.entries(byAs).map(([as, ns]) => { const asn = parseInt(String(as).replace(/\D/g, '')) || hash(as) % 65000; const cities = {}; ns.forEach(n => (cities[n.city || '?'] = cities[n.city || '?'] || []).push(n)); return mk(as.slice(0, 26), `2001:db8:${hex(asn & 0xffff)}::/32`, Object.entries(cities).map(([c, l]) => mk(c, `2001:db8:${hex(asn & 0xffff)}:${hex(hash(c) & 0xff)}::/48`, l.map(n => mk(`salto ${n.n}`, `2001:db8:${hex(asn & 0xffff)}:${hex(hash(c) & 0xff)}:${hex(n.n)}::/64`, [mk(n.ip, '…::1', null, { v: 1 })])))) ); }));
  }
  function layout(root) { // partición radial: ancho angular proporcional a hojas
    const leaves = n => n._l = n.children && n.children.length ? n.children.reduce((a, c) => a + leaves(c), 0) : 1; leaves(root);
    (function place(n, a0, a1, d) { n.a0 = a0; n.a1 = a1; n.d = d; if (n.children) { let a = a0; n.children.forEach(c => { const w = (a1 - a0) * c._l / n._l; place(c, a, a + w, d + 1); a += w; }); } })(root, 0, Math.PI * 2, 0);
  }
  const PAL = ['#22d3ee', '#a78bfa', '#fbbf24', '#34d399', '#f472b6', '#60a5fa', '#fb923c'];
  function setRoot(data) { RD.root = data; layout(data); data.children.forEach((c, i) => { const col = PAL[i % PAL.length]; (function paint(n) { n.col = col; (n.children || []).forEach(paint); })(c); }); data.col = '#0f172a'; RD.focus = data; RD.view = { a0: 0, a1: Math.PI * 2, d0: 0 }; drawR(); }
  const ringW = 74, inner = 46;
  function arcPath(r0, r1, a0, a1) { const l = a1 - a0 > Math.PI ? 1 : 0, p = (r, a) => `${r * Math.sin(a)},${-r * Math.cos(a)}`; if (a1 - a0 >= Math.PI * 2 - 1e-4) a1 = a0 + Math.PI * 2 - 1e-4; return `M${p(r0, a0)}A${r0},${r0} 0 ${l} 1 ${p(r0, a1)}L${p(r1, a1)}A${r1},${r1} 0 ${l} 0 ${p(r1, a0)}Z`; }
  function drawR() {
    const v = RD.view, span = v.a1 - v.a0; svg.innerHTML = '';
    (function walk(n) {
      const rel = n.d - v.d0; if (rel >= 0 && n.a1 > v.a0 + 1e-6 && n.a0 < v.a1 - 1e-6 && rel <= 4) {
        const a0 = Math.max(0, (n.a0 - v.a0) / span) * Math.PI * 2, a1 = Math.min(1, (n.a1 - v.a0) / span) * Math.PI * 2;
        if (rel === 0 && n === RD.focus) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('r', inner - 4); c.setAttribute('fill', '#0b1b33'); c.setAttribute('stroke', '#22d3ee'); c.setAttribute('class', 'rd-core'); c.onclick = () => zoomTo(n.parent || RD.root); svg.appendChild(c); const t = document.createElementNS(NS, 'text'); t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'rd-ctr'); t.innerHTML = `<tspan x="0" dy="-3">${esc(n.name.slice(0, 14))}</tspan><tspan x="0" dy="13" class="rd-sub">${esc(n.prefix)}</tspan>`; svg.appendChild(t); }
        else if (rel > 0) { const r0 = inner + (rel - 1) * ringW, r1 = r0 + ringW - 3, p = document.createElementNS(NS, 'path'); p.setAttribute('d', arcPath(r0, r1, a0, a1)); p.setAttribute('fill', n.col); p.setAttribute('fill-opacity', (0.95 - rel * .14).toFixed(2)); p.setAttribute('class', 'rd-seg'); p.onclick = () => n.children ? zoomTo(n) : rinfo(n); p.onmouseenter = () => rinfo(n); const ti = document.createElementNS(NS, 'title'); ti.textContent = n.name + '\n' + n.prefix; p.appendChild(ti); svg.appendChild(p);
          const am = (a0 + a1) / 2, rm = (r0 + r1) / 2; if ((a1 - a0) * rm > 34) { const t = document.createElementNS(NS, 'text'), deg = am * 180 / Math.PI - 90, flip = deg > 90; t.setAttribute('transform', `rotate(${deg}) translate(${rm},0)${flip ? ' rotate(180)' : ''}`); t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'rd-lbl'); t.textContent = n.name.length > 13 ? n.name.slice(0, 12) + '…' : n.name; t.style.pointerEvents = 'none'; svg.appendChild(t); } }
      }
      (n.children || []).forEach(c => { c.parent = n; walk(c); });
    })(RD.root);
  }
  function zoomTo(n) { const to = { a0: n.a0, a1: n.a1, d0: n.d }, from = { ...RD.view }, t0 = performance.now(); RD.focus = n; cancelAnimationFrame(RD.anim); (function step(now) { const k = Math.min(1, (now - t0) / 450), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; RD.view = { a0: from.a0 + (to.a0 - from.a0) * e, a1: from.a1 + (to.a1 - from.a1) * e, d0: to.d0 }; drawR(); if (k < 1) RD.anim = requestAnimationFrame(step); })(performance.now()); rinfo(n); }
  const LAYERS = ['Núcleo: Internet / RIR', 'Capa 1 · ISP', 'Capa 2 · Sitio (Global Routing Prefix)', 'Capa 3 · Subred (Subnet ID)', 'Borde · Host (Interface ID)'];
  const rinfo = n => { rbox.querySelector('#rd-info').innerHTML = `<b>${esc(n.name)}</b><br><span class="mono">${esc(n.prefix)}</span><br>${LAYERS[Math.min(4, n.d)]}<br>${n._l} host(s) en este gajo`; };
  function demo() { setRoot(demoData()); } rbox.querySelector('#rd-demo').onclick = demo;
  rbox.querySelector('#rd-trace').onclick = () => { const d = traceData(); if (!d) return T('Primero hacé una traza en el modo Global Carrier Explorer', true); setRoot(d); };
  window.IPHUB_topoModes = { traceToHierarchy: traceData };
})();
