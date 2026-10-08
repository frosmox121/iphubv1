/* Herramientas INNOVADORAS */
(function () {
  const root = document.getElementById('tool-innov'); if (!root) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = s => root.querySelector(s);
  const T = (m, e) => { try { toast(m, e); } catch (_) {} };
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const hopsOf = d => (d.hops || parseTraceRows(d.raw || '')).map(h => { const r = (h.rtts || []).map(num).filter(x => x != null); return { hop: +h.hop, host: h.host, rtt: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null }; });
  const trace = t => api('/api/tools/tracepacket', { method: 'POST', body: { target: t } });
  const busy = (b, on, txt) => { b.disabled = on; if (txt) b.dataset.t = b.dataset.t || b.textContent, b.textContent = on ? txt : b.dataset.t; };

  root.innerHTML = `
  <div class="innov-grid">
   <div class="card glass innov-card" id="iv-route"><h3><span class="iv-ico">◎</span> Analizador de ruta</h3><p class="muted small">Traza la ruta con 3 paquetes por salto, dibuja el RTT de cada salto y detecta saltos lentos y timeouts.</p>
    <div class="tool-form"><input class="in" value="8.8.8.8"><button class="btn btn-primary go" type="button">Analizar</button></div><div class="out"></div></div>
   <div class="card glass innov-card" id="iv-cmp"><h3><span class="iv-ico">⇄</span> Comparador de rutas</h3><p class="muted small">Traza dos destinos y muestra en qué salto sus caminos se separan.</p>
    <div class="tool-form"><input class="in a" value="8.8.8.8"><input class="in b" value="1.1.1.1"><button class="btn btn-primary go" type="button">Comparar</button></div><div class="out"></div></div>
   <div class="card glass innov-card" id="iv-mp"><h3><span class="iv-ico">≋</span> Multiping TCP</h3><p class="muted small">Latencia, jitter y pérdida a varios destinos a la vez (conexión TCP, puerto 443). Separá con comas.</p>
    <div class="tool-form"><input class="in" value="1.1.1.1, 8.8.8.8, google.com"><button class="btn btn-primary go" type="button">Medir</button></div><div class="out"></div></div>
   <div class="card glass innov-card" id="iv-http"><h3><span class="iv-ico">⌁</span> HTTP Check</h3><p class="muted small">Tiempos DNS/TTFB/total, certificado TLS y puntaje de cabeceras de seguridad.</p>
    <div class="tool-form"><input class="in" value="https://example.com"><button class="btn btn-primary go" type="button">Revisar</button></div><div class="out"></div></div>
   <div class="card glass innov-card" id="iv-vlsm"><h3><span class="iv-ico">▦</span> Planificador VLSM</h3><p class="muted small">Dividí una red en subredes según los hosts que necesita cada área (una por línea: nombre, hosts).</p>
    <div class="tool-form"><input class="in" value="192.168.10.0/24"></div><textarea class="req" rows="4">Ventas, 60&#10;Sistemas, 25&#10;Gerencia, 10&#10;Enlace WAN, 2</textarea><button class="btn btn-primary go" type="button" style="margin-top:.5rem">Calcular</button><div class="out"></div></div>
   <div class="card glass innov-card" id="iv-conv"><h3><span class="iv-ico">01</span> Conversor de IP</h3><p class="muted small">Binario, hexadecimal, entero, clase, tipo (privada/pública) y nombre PTR inverso.</p>
    <div class="tool-form"><input class="in" value="192.168.1.10"><button class="btn btn-primary go" type="button">Convertir</button></div><div class="out"></div></div>
  </div>`;
  const on = (id, fn) => { const c = $('#' + id), b = c.querySelector('.go'), o = c.querySelector('.out'); const run = async () => { busy(b, true, '…'); o.innerHTML = '<p class="muted small">Procesando…</p>'; try { o.innerHTML = await fn(c); } catch (e) { o.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; } busy(b, false); }; b.onclick = run; c.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) run(); }); };

  on('iv-route', async c => {
    const d = await trace(c.querySelector('.in').value.trim()); const h = hopsOf(d); if (!h.length) throw new Error('Sin saltos para analizar');
    const max = Math.max(...h.map(x => x.rtt || 0), 1); let worst = null, prev = 0;
    h.forEach(x => { if (x.rtt != null) { x.delta = x.rtt - prev; if (!worst || x.delta > worst.delta) worst = x; prev = x.rtt; } });
    const lost = h.filter(x => x.rtt == null).length, last = h[h.length - 1];
    const notes = []; if (worst && worst.delta > 40) notes.push(`Mayor salto de latencia: +${worst.delta.toFixed(0)} ms en el salto ${worst.hop} (${esc(worst.host)}). Suele indicar un enlace de larga distancia o congestión.`);
    if (lost) notes.push(`${lost} salto(s) sin respuesta: puede ser un router que filtra ICMP (normal) o pérdida real si los siguientes tampoco responden.`);
    notes.push(last.rtt != null ? `El destino respondió en ${last.rtt.toFixed(0)} ms tras ${h.length} saltos.` : 'El último salto no respondió: el destino puede bloquear ICMP.');
    return `<div class="iv-bars">${h.map(x => `<div class="iv-bar${worst && x === worst && worst.delta > 40 ? ' warn' : ''}${x.rtt == null ? ' lost' : ''}"><span>${x.hop}</span><i style="width:${x.rtt == null ? 2 : Math.max(2, 100 * x.rtt / max)}%"></i><em>${x.rtt == null ? '*' : x.rtt.toFixed(0) + ' ms'}</em><small>${esc(x.host)}</small></div>`).join('')}</div><ul class="iv-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>`;
  });
  on('iv-cmp', async c => {
    const [a, b] = await Promise.all([trace(c.querySelector('.a').value.trim()), trace(c.querySelector('.b').value.trim())]);
    const A = hopsOf(a), B = hopsOf(b); let i = 0; while (i < A.length && i < B.length && A[i].host === B[i].host && A[i].host !== '*') i++;
    const col = (L, n) => `<div><strong>${esc(n)}</strong><ol>${L.map((x, k) => `<li class="${k < i ? 'same' : 'diff'}" value="${x.hop}">${esc(x.host)} <small>${x.rtt == null ? '*' : x.rtt.toFixed(0) + ' ms'}</small></li>`).join('')}</ol></div>`;
    return `<p class="iv-sum">${i ? `Comparten <b>${i}</b> salto(s) y divergen en el salto <b>${i + 1}</b>.` : 'Los caminos divergen desde el primer salto.'}</p><div class="iv-cols">${col(A, c.querySelector('.a').value)}${col(B, c.querySelector('.b').value)}</div>`;
  });
  on('iv-mp', async c => {
    const targets = c.querySelector('.in').value.split(/[,\s]+/).filter(Boolean);
    const d = await api('/api/tools/innov/multiping', { method: 'POST', body: { targets, count: 6, port: 443 } });
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Destino</th><th>Min</th><th>Prom</th><th>Máx</th><th>Jitter</th><th>Pérdida</th></tr></thead><tbody>${d.results.map(r => `<tr><td>${esc(r.host)}</td><td>${r.min ?? '—'}</td><td><b>${r.avg ?? '—'}</b></td><td>${r.max ?? '—'}</td><td>${r.jitter ?? '—'}</td><td class="${r.loss ? 'iv-bad' : ''}">${r.loss}%</td></tr>`).join('')}</tbody></table></div><p class="muted small">Valores en ms · ${d.results[0].sent} intentos por destino.</p>`;
  });
  on('iv-http', async c => {
    const d = await api('/api/tools/innov/httpcheck', { method: 'POST', body: { url: c.querySelector('.in').value.trim() } });
    const kv = (k, v) => `<div class="result-item"><label>${k}</label><strong>${esc(v ?? '—')}</strong></div>`;
    return `<div class="results-grid">${kv('Estado', d.status + ' · HTTP/' + d.httpVersion)}${kv('IP', d.ip)}${kv('DNS', d.dnsMs + ' ms')}${kv('TTFB', d.ttfbMs + ' ms')}${kv('Total', d.totalMs + ' ms')}${kv('Servidor', d.server)}${kv('Tamaño leído', d.bytes + ' B')}${d.tls ? kv('TLS', (d.tls.protocol || '') + ' · ' + (d.tls.issuer || '') + ' · vence ' + d.tls.validTo) : ''}${d.location ? kv('Redirige a', d.location) : ''}</div><div class="iv-score"><b>${d.score}/100</b> cabeceras de seguridad</div><div class="iv-chips">${d.security.map(s => `<span class="iv-chip ${s.present ? 'ok' : 'no'}">${s.present ? '✓' : '✕'} ${esc(s.name)}</span>`).join('')}</div>`;
  });
  const ip2int = s => { const p = s.split('.').map(Number); if (p.length !== 4 || p.some(x => !(x >= 0 && x <= 255) || !Number.isInteger(x))) throw new Error('IPv4 inválida: ' + s); return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; };
  const int2ip = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  on('iv-vlsm', async c => {
    const [base, pre] = c.querySelector('.in').value.trim().split('/'); const bp = +pre; if (!(bp >= 8 && bp <= 30)) throw new Error('Prefijo inválido (8–30)');
    const start = (ip2int(base) & (bp === 0 ? 0 : (0xFFFFFFFF << (32 - bp)) >>> 0)) >>> 0, end = start + Math.pow(2, 32 - bp);
    const reqs = c.querySelector('.req').value.split('\n').map(l => l.split(',')).filter(a => a.length >= 2).map(a => ({ n: a[0].trim(), h: parseInt(a[1], 10) })).filter(r => r.h > 0).sort((a, b) => b.h - a.h);
    if (!reqs.length) throw new Error('Cargá al menos un área con hosts');
    let cur = start; const rows = [];
    for (const r of reqs) { let bits = 2; while (Math.pow(2, bits) - 2 < r.h) bits++; const size = Math.pow(2, bits), p = 32 - bits; cur = Math.ceil(cur / size) * size; if (cur + size > end) throw new Error(`No entra "${r.n}" en ${base}/${bp}`); rows.push({ ...r, net: cur, p, size }); cur += size; }
    const used = rows.reduce((a, r) => a + r.size, 0);
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Área</th><th>Pedidos</th><th>Red</th><th>Rango útil</th><th>Broadcast</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.n)}</td><td>${r.h}</td><td><b>${int2ip(r.net)}/${r.p}</b></td><td>${int2ip(r.net + 1)} – ${int2ip(r.net + r.size - 2)}</td><td>${int2ip(r.net + r.size - 1)}</td></tr>`).join('')}</tbody></table></div><p class="muted small">Uso del bloque: ${used} de ${end - start} direcciones (${Math.round(100 * used / (end - start))}%).</p>`;
  });
  on('iv-conv', async c => {
    const s = c.querySelector('.in').value.trim(), n = ip2int(s), o = s.split('.').map(Number);
    const cls = o[0] < 128 ? 'A' : o[0] < 192 ? 'B' : o[0] < 224 ? 'C' : o[0] < 240 ? 'D (multicast)' : 'E (reservada)';
    const priv = o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168), spec = o[0] === 127 ? 'Loopback' : (o[0] === 169 && o[1] === 254) ? 'Link-local (APIPA)' : o[0] === 100 && o[1] >= 64 && o[1] <= 127 ? 'CGNAT' : priv ? 'Privada (RFC 1918)' : 'Pública';
    const kv = (k, v) => `<div class="result-item"><label>${k}</label><strong style="font-family:var(--mono)">${esc(v)}</strong></div>`;
    return `<div class="results-grid">${kv('Binario', o.map(x => x.toString(2).padStart(8, '0')).join('.'))}${kv('Hexadecimal', '0x' + n.toString(16).toUpperCase().padStart(8, '0'))}${kv('Entero', String(n))}${kv('Clase', cls)}${kv('Tipo', spec)}${kv('PTR inverso', o.slice().reverse().join('.') + '.in-addr.arpa')}</div>`;
  });
})();
