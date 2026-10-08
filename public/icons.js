/* IPHub — set de iconos propio (SVG de trazo). Sustituye emojis y símbolos pictográficos en toda la interfaz. */
(function () {
  const P = {
    x: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M4 12.5l5 5L20 6.5"/>',
    warn: '<path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17.5h.01"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" fill="currentColor"/>',
    starO: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', clip: '<path d="M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L14 7"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>', pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z"/>', refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>', ext: '<path d="M8 16L18 6M9 6h9v9"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/>', dot: '<circle cx="12" cy="12" r="5" fill="currentColor"/>', dotO: '<circle cx="12" cy="12" r="5"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>', m1: '<circle cx="12" cy="9" r="6"/><path d="M9 14l-2 7 5-3 5 3-2-7"/>',
    router: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    switch: '<path d="M4 6h12M12 2l4 4-4 4M20 18H8M12 14l-4 4 4 4"/>',
    server: '<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 7h.01M6 18h.01"/>',
    pc: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>', phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/>',
    tv: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="M17 2l-5 5-5-5"/>',
    printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
    iot: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 006 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>',
    console: '<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/>',
    speaker: '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><path d="M12 6h.01"/>',
    nas: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>',
    chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M19 9h3M19 14h3M2 9h3M2 14h3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01"/>',
    home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>', topo: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5l-6 5.5M12 11.5l6 5.5"/>',
    work: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    track: '<path d="M12 22s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    tools: '<path d="M14.7 6.3a4 4 0 005 5L21 17l-4 4-5.7-1.3-8-8L3 3l8.3 1.7z"/>', code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
    audit: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>', learn: '<path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5"/>',
    rank: '<path d="M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M9 21h6M12 14v7"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>', company: '<path d="M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20"/>',
    book: '<path d="M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7z"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    packet: '<path d="M12 2l9 5v10l-9 5-9-5V7l9-5zM3 7l9 5 9-5M12 12v10"/>', play: '<path d="M7 4l13 8-13 8V4z" fill="currentColor"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>', pause: '<path d="M8 5v14M16 5v14"/>'
  };
  const ic = (n, s) => '<svg class="ic" viewBox="0 0 24 24" width="' + (s || 16) + '" height="' + (s || 16) + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[n] || P.help) + '</svg>';
  window.IC = ic; window.IC_PATHS = P;
  const MAP = { '✕': 'x', '✖': 'x', '✓': 'check', '✔': 'check', '⚠': 'warn', '★': 'star', '☆': 'starO', '⏱': 'clock', '⏰': 'clock', '📎': 'clip', '🔒': 'lock', '🔍': 'search', '🌐': 'globe', '◎': 'target', '⇄': 'swap', '⌁': 'pulse', '✦': 'spark', '↻': 'refresh', '☰': 'menu', '⛶': 'expand', '⇪': 'upload', '↗': 'ext', '👑': 'crown', '●': 'dot', '○': 'dotO', '↑': 'up', '↓': 'down', '🥇': 'm1', '🥈': 'm1', '🥉': 'm1', '💠': 'chip', '❔': 'help', '🧩': 'chip', '📡': 'iot', '🔀': 'switch' };
  const RX = new RegExp('[' + Object.keys(MAP).join('') + ']', 'g'), STRIP = /[\uFE0F\u200D]/g, ANY = /[\u2190-\u21FF\u23F0-\u23F3\u25CB\u25CF\u2605\u2606\u2610-\u2764\u2B00-\u2BFF\uFE0F\u{1F000}-\u{1FAFF}]/u;
  const SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|CANVAS|SVG|NOSCRIPT|OPTION|CODE|PRE)$/;
  function fix(t) {
    const s = t.nodeValue; if (!s || !ANY.test(s)) return;
    const p = t.parentNode; if (!p || SKIP.test(p.nodeName.toUpperCase()) || p.closest && p.closest('svg')) return;
    const clean = s.replace(STRIP, ''); if (!RX.test(clean)) { RX.lastIndex = 0; if (clean !== s) t.nodeValue = clean; return; } RX.lastIndex = 0;
    const f = document.createDocumentFragment(); let last = 0, m;
    while ((m = RX.exec(clean))) { if (m.index > last) f.appendChild(document.createTextNode(clean.slice(last, m.index))); const sp = document.createElement('span'); sp.className = 'ic-i'; sp.innerHTML = ic(MAP[m[0]], m[0] === '●' || m[0] === '○' ? 10 : 14); f.appendChild(sp); last = m.index + 1; }
    if (last < clean.length) f.appendChild(document.createTextNode(clean.slice(last))); p.replaceChild(f, t);
  }
  function walk(n) { if (n.nodeType === 3) return fix(n); if (n.nodeType !== 1 || SKIP.test(n.nodeName.toUpperCase())) return; if (n.placeholder && ANY.test(n.placeholder)) n.placeholder = n.placeholder.replace(RX, '').replace(STRIP, '').trim(); if (n.title && ANY.test(n.title)) n.title = n.title.replace(RX, '').replace(STRIP, '').trim(); for (const c of [...n.childNodes]) walk(c); }
  const NAV = { dashboard: 'home', topology: 'topo', workspace: 'work', tracking: 'track', tools: 'tools', intercept: 'packet', code: 'code', audit: 'audit', learn: 'learn', leaderboard: 'rank', support: 'mail', empresa: 'company', manual: 'book', account: 'user' };
  function nav(root) { (root || document).querySelectorAll('.nav-item[data-section] .nav-icon').forEach(e => { if (e.dataset.done) return; e.dataset.done = 1; e.innerHTML = ic(NAV[e.parentNode.dataset.section] || 'help', 18); }); }
  const css = document.createElement('style'); css.textContent = '.ic{display:inline-block;vertical-align:-.2em;flex:none}.ic-i{display:inline-flex;align-items:center}.nav-icon .ic{display:block}'; document.head.appendChild(css);
  let q = false; const mo = new MutationObserver(ms => { if (q) return; q = true; requestAnimationFrame(() => { q = false; ms.forEach(m => { m.addedNodes.forEach(walk); if (m.type === 'characterData') fix(m.target); }); nav(); }); });
  function start() { walk(document.body); nav(); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  /* iconos para canvas: se pre-renderizan a imagen */
  const cache = {}; let pend = 0;
  window.icoImg = function (kind, color) { const k = kind + color; if (cache[k]) return cache[k]; const im = new Image(); pend++; im.onload = () => { if (--pend === 0) try { dispatchEvent(new Event('resize')); } catch (_) {} }; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (P[kind] || P.help) + '</svg>'); return (cache[k] = im); };
  window.icoDraw = function (g, kind, x, y, s, color) { const im = window.icoImg(kind, color || '#ffffff'); if (im.complete && im.naturalWidth) g.drawImage(im, x - s / 2, y - s / 2, s, s); };
})();
