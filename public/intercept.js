/* Interceptar — solo dueño: todas las peticiones HTTP que llegan a la plataforma */
(function () {
  function mount(root, vis) {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let items = [], last = 0, paused = false, timer = null, sel = null, f = { q: '', m: '', s: '' };
  const owner = () => !!((typeof ME !== 'undefined' && ME) && ME.isOwner);
  root.innerHTML = `<div class="tool-form int-bar"><input id="int-q" placeholder="Filtrar por URL, IP o cuerpo…" style="min-width:220px"><select id="int-m"><option value="">Todos los métodos</option><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option></select><select id="int-s"><option value="">Todos los estados</option><option value="2">2xx</option><option value="3">3xx</option><option value="4">4xx</option><option value="5">5xx</option></select><button class="btn btn-sm btn-primary" id="int-pause" type="button">Pausar</button><button class="btn btn-sm g" id="int-clear" type="button">Limpiar</button><span class="muted small" id="int-count"></span></div>
  <div class="int-wrap"><div class="table-wrap int-list"><table class="data-table"><thead><tr><th>Hora</th><th>Método</th><th>URL</th><th>Origen</th><th>Estado</th><th>ms</th><th>Bytes</th></tr></thead><tbody id="int-body"></tbody></table></div><div class="int-detail" id="int-detail"><p class="muted small">Elegí una petición para ver cabeceras y cuerpo.</p></div></div>
  <p class="muted small">Se registran todas las peticiones (últimas 1000). Contraseñas y tokens se muestran como ***; Authorization y Cookie van recortadas. Para ver tráfico real de otros equipos de la red usá el proxy y el Analizador de protocolos del exe (cuenta dueño).</p>`;
  const q = s => root.querySelector(s);
  const col = s => s >= 500 ? 'int-5' : s >= 400 ? 'int-4' : s >= 300 ? 'int-3' : 'int-2';
  const pass = e => (!f.m || e.method === f.m) && (!f.s || String(e.status)[0] === f.s) && (!f.q || (e.url + ' ' + e.ip + ' ' + JSON.stringify(e.reqBody || '')).toLowerCase().includes(f.q));
  function paint() {
    const l = items.filter(pass).slice(-250).reverse();
    q('#int-body').innerHTML = l.map(e => `<tr class="${sel === e.id ? 'sel' : ''}" data-id="${e.id}"><td>${new Date(e.t).toLocaleTimeString()}</td><td><b class="int-m int-${e.method}">${e.method}</b></td><td class="mono int-url">${esc(e.url)}</td><td class="mono">${esc(e.ip)}</td><td><span class="int-st ${col(e.status)}">${e.status}</span></td><td>${e.ms}</td><td>${e.resBytes || '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin peticiones todavía.</td></tr>';
    q('#int-count').textContent = items.length + ' en memoria · ' + l.length + ' mostradas';
  }
  const kv = o => o && Object.keys(o).length ? `<table class="int-kv">${Object.entries(o).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="mono">${esc(Array.isArray(v) ? v.join(', ') : v)}</td></tr>`).join('')}</table>` : '<p class="muted small">—</p>';
  const raw = e => { const h = o => Object.entries(o || {}).map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join('\n'); return e.method + ' ' + e.url + ' HTTP/' + (e.httpVersion || '1.1') + '\n' + h(e.reqHeaders) + '\n\n' + (e.reqBody ? JSON.stringify(e.reqBody, null, 2) : '') + '\n\n---- respuesta ----\nHTTP/' + (e.httpVersion || '1.1') + ' ' + e.status + '\n' + h(e.resHeaders); };
  function detail(e) {
    q('#int-detail').innerHTML = `<h4><b class="int-m int-${e.method}">${e.method}</b> <span class="int-st ${col(e.status)}">${e.status}</span> ${e.ms} ms</h4><p class="mono small">${esc(e.proto)}://${esc(e.host)}${esc(e.url)}<br>HTTP/${esc(e.httpVersion)} · ${esc(e.ip)} · ${esc(e.ct || 'sin content-type')}</p><h5>Cabeceras de la petición</h5>${kv(e.reqHeaders)}<h5>Cuerpo enviado</h5><pre class="raw-output">${e.reqBody ? esc(JSON.stringify(e.reqBody, null, 2)) : '(sin cuerpo)'}</pre><h5>Cabeceras de la respuesta</h5>${kv(e.resHeaders)}<h5>Paquete HTTP crudo</h5><pre class="raw-output">${esc(raw(e))}</pre>`;
  }
  async function poll() {
    if (paused || !owner() || !vis()) return;
    try { const d = await api('/api/intercept/requests?since=' + last); if (d.items.length) { items = items.concat(d.items).slice(-1000); } last = d.last; paint(); } catch (_) {}
  }
  q('#int-body').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (!tr) return; sel = +tr.dataset.id; const it = items.find(x => x.id === sel); if (it) { detail(it); paint(); } };
  q('#int-q').oninput = e => { f.q = e.target.value.toLowerCase(); paint(); }; q('#int-m').onchange = e => { f.m = e.target.value; paint(); }; q('#int-s').onchange = e => { f.s = e.target.value; paint(); };
  q('#int-pause').onclick = e => { paused = !paused; e.target.textContent = paused ? 'Reanudar' : 'Pausar'; };
  q('#int-clear').onclick = async () => { try { await api('/api/intercept/requests', { method: 'DELETE' }); } catch (_) {} items = []; last = 0; sel = null; paint(); };
  timer = setInterval(poll, 1500);
  return { poll };
  }
  window.IPHubIntercept = { mount };
  const root = document.getElementById('intercept-root');
  if (root) {
    const m = mount(root, () => document.getElementById('intercept').classList.contains('active'));
    const orig = window.showSection;
    window.showSection = function (id) { if (id === 'intercept' && !((typeof ME !== 'undefined' && ME) && ME.isOwner)) { toast('Solo el dueño puede usar Interceptar', true); id = 'dashboard'; } orig(id); if (id === 'intercept') m.poll(); };
  }
})();
