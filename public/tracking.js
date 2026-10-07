/* ============================================================================
 * TRACKING STUDIO — Frontend (sección "tracking" dentro de la app IPHub).
 * IDE pesado de logística: workspace con pestañas, GIS canvas, timeline,
 * telemetría en vivo, dispositivos IoT, rutas/geofences, simulaciones,
 * snapshots/escenarios, bridge Virtual Lab, incidentes/alertas/riesgo,
 * code intelligence, resource monitor, reportes y demo.
 * Habla exclusivamente con /api/tracking/* (ver server-tracking.js).
 * ==========================================================================*/
(function () {
  'use strict';
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => [...(c || document).querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (m, bad) => { try { toast(m, !!bad); } catch (_) { alert(m); } };
  const fmt = n => (Number(n) || 0).toLocaleString('es');

  let CAT = null;            // catálogos del servidor (/api/tracking/state)
  let TABS = ['dashboard'];  // workspace abierto
  let ACTIVE = 'dashboard';
  let LIVE = null;           // timer de live tracking
  let SIM_POLL = null;
  const state = { project: null, shipments: [], devices: [], map: null, selShipment: null, selDevice: null };

  async function T(path, opts) { return api('/api/tracking' + path, opts || {}); }

  // ---------------- Entry point ----------------
  function initTracking() {
    const root = $('#tracking-root'); if (!root) return;
    if (!CAT) { loadState(root); } else { renderShell(root); }
  }
  async function loadState(root) {
    try { CAT = await T('/state'); } catch (e) { root.innerHTML = `<div class="card glass"><p>${esc(e.message)}</p></div>`; return; }
    renderShell(root);
  }

  // ---------------- Shell del IDE ----------------
  function renderShell(root) {
    root.innerHTML = `
      <div class="ts-bar">
        <span class="ts-brand">⬢ Tracking Studio</span>
        <select id="ts-project" class="tm-in ts-sel"></select>
        <button class="btn btn-sm btn-primary" id="ts-new-proj">Nuevo proyecto</button>
        <button class="btn btn-sm g" id="ts-demo" title="Carga Global Cold Chain Demo (50 envíos, hubs, vehículos, sensores, frío, incidente)">Cargar demo</button>
        <span class="ts-mode" id="ts-mode"></span>
        <span class="ts-bridge" id="ts-bridge"></span>
        <div class="spacer"></div>
        <input type="search" id="ts-search" class="global-search" placeholder="Buscar envío, dispositivo… (Ctrl+K)" autocomplete="off">
        <div id="ts-search-results" class="search-results hidden"></div>
      </div>
      <div class="ts-tabs" id="ts-tabs"></div>
      <div class="ts-body card glass" id="ts-panel"></div>`;
    drawProjectSelect(); drawMode(); drawBridge(); drawTabs(); openTab(ACTIVE);
    // eventos barra
    $('#ts-new-proj').onclick = newProjectDialog;
    $('#ts-demo').onclick = async () => {
      $('#ts-demo').disabled = true;
      try { const d = await T('/demo', { method: 'POST', body: {} }); say(`Demo listo: ${fmt(d.shipments)} envíos · ${fmt(d.telemetryReads)} lecturas · escenario "Cold Chain Failure"`); CAT = await T('/state'); drawProjectSelect(); drawMode(); refreshCurrentTab(); }
      catch (e) { say(e.message, true); } finally { $('#ts-demo').disabled = false; }
    };
    $('#ts-project').onchange = e => { setProject(e.target.value); };
    bindSearch();
    document.addEventListener('keydown', tsHotkeys);
  }

  function drawProjectSelect() {
    const sel = $('#ts-project'); if (!sel) return;
    const ps = CAT.projects || [];
    sel.innerHTML = ps.length ? ps.map(p => `<option value="${p.id}" ${CAT.active && CAT.active.id === p.id ? 'selected' : ''}>${esc(p.name)} · ${p.mode} (${fmt(p.shipments)} envíos)</option>`).join('')
      : '<option value="">— sin proyectos —</option>';
    state.project = CAT.active ? CAT.active.id : null;
  }
  function drawMode() {
    const el = $('#ts-mode'); if (!el) return;
    const m = CAT.active ? CAT.active.mode : '—';
    el.innerHTML = `Modo: <b class="ts-m-${m.toLowerCase()}">${esc(m)}</b>`;
  }
  async function drawBridge() {
    const el = $('#ts-bridge'); if (!el) return;
    try { const st = await T('/bridge/status'); el.innerHTML = st.connected
      ? `<span class="dot green"></span> Virtual Lab: conectado (${st.online}/${st.hosts} hosts)`
      : `<span class="dot red"></span> Virtual Lab: fallback simulado (conectá la app)`; }
    catch (_) { el.textContent = ''; }
  }
  async function setProject(pid) {
    if (!pid) return;
    try { await T('/projects/' + pid, { method: 'PUT', body: { activate: true } }); } catch (_) {}
    CAT = await T('/state'); state.project = pid; drawProjectSelect(); drawMode(); refreshCurrentTab();
  }

  function newProjectDialog() {
    const name = prompt('Nombre del proyecto logístico:', 'Mi cadena logística');
    if (!name) return;
    const mode = CAT.modes.find(m => m === prompt('Modo de aislamiento (REAL | SIMULATED | REPLAY | HYBRID):', 'SIMULATED')) || 'SIMULATED';
    T('/projects', { method: 'POST', body: { name, mode } }).then(async p => {
      say('Proyecto creado: ' + p.name); CAT = await T('/state'); drawProjectSelect(); drawMode(); refreshCurrentTab();
    }).catch(e => say(e.message, true));
  }

  // ---------------- Tabs (workspace del IDE) ----------------
  const TAB_DEFS = {
    dashboard: 'Dashboard', projects: 'Proyectos', shipments: 'Envíos', timeline: 'Timeline', map: 'GIS Mapa',
    telemetry: 'Telemetría', devices: 'IoT Devices', topology: 'Topología Logística', routes: 'Rutas', geofences: 'Geofences',
    simulations: 'Simulación', stress: 'Stress Test', snapshots: 'Snapshots', scenarios: 'Escenarios',
    bridge: 'Virtual Lab Bridge', trace: 'Network Trace', failures: 'Failure Sim', incidents: 'Incidentes',
    alerts: 'Alertas', risk: 'Risk Score', carriers: 'Carriers', webhooks: 'Webhook Lab', replay: 'Replay',
    codeintel: 'Code Intelligence', resources: 'Recursos', reports: 'Reportes', importexport: 'Import/Export', help: 'Ayuda',
  };
  function drawTabs() {
    const host = $('#ts-tabs'); if (!host) return;
    host.innerHTML = TABS.map(t => `<button class="ts-tab ${t === ACTIVE ? 'active' : ''}" data-t="${t}">${TAB_DEFS[t] || t}<span class="ts-x" data-x="${t}">✕</span></button>`).join('')
      + `<select id="ts-add-tab" class="tm-in ts-sel"><option value="">＋ Agregar pestaña…</option>${Object.entries(TAB_DEFS).filter(([k]) => !TABS.includes(k)).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`;
    $$('.ts-tab', host).forEach(b => {
      b.onclick = e => { if (e.target.dataset.x) { closeTab(e.target.dataset.x); return; } openTab(b.dataset.t); };
    });
    const add = $('#ts-add-tab'); if (add) add.onchange = () => { if (add.value) openTab(add.value); };
  }
  function closeTab(t) { TABS = TABS.filter(x => x !== t); if (!TABS.length) TABS = ['dashboard']; if (ACTIVE === t) ACTIVE = TABS[TABS.length - 1]; drawTabs(); openTab(ACTIVE); }
  function openTab(t) {
    if (LIVE) { clearInterval(LIVE); LIVE = null; }
    if (SIM_POLL) { clearInterval(SIM_POLL); SIM_POLL = null; }
    ACTIVE = t; if (!TABS.includes(t)) TABS.push(t); drawTabs();
    refreshCurrentTab();
  }
  function refreshCurrentTab() { const fn = RENDER[ACTIVE]; if (fn) fn($('#ts-panel')); }

  const RENDER = {};

  // ---------------- Dashboard (#46) ----------------
  RENDER.dashboard = async (host) => {
    if (!state.project) return noProject(host);
    host.innerHTML = '<p class="muted">Cargando dashboard…</p>';
    let d; try { d = await T('/dashboard'); } catch (e) { host.innerHTML = `<p>${esc(e.message)}</p>`; return; }
    const kpi = (t, v, u) => `<div class="card glass stat-card"><h4>${t}</h4><p class="stat-value">${fmt(v)}${u || ''}</p></div>`;
    host.innerHTML = `
      <div class="grid-dashboard">
        ${kpi('Envíos', d.totals.shipments)}${kpi('Excepciones', d.totals.exceptions)}${kpi('Dispositivos IoT', d.totals.devices)}
        ${kpi('Lecturas telemetría', d.totals.telemetryReads)}${kpi('Eventos append-only', d.totals.events)}${kpi('Alertas abiertas', d.totals.openAlerts)}
        ${kpi('Incidentes abiertos', d.totals.openIncidents)}${kpi('Excursiones térmicas', d.totals.excursions)}
      </div>
      <div class="ts-cols2">
        <div class="card glass"><h3>Estados</h3><div id="ts-status-bars">${Object.entries(d.byStatus).map(([k, v]) => `<div class="ts-hbar"><span>${esc(k)}</span><div class="ts-bar-track"><div style="width:${Math.min(100, v * 4)}%"></div></div><b>${v}</b></div>`).join('') || '<p class="muted">Sin envíos todavía.</p>'}</div></div>
        <div class="card glass"><h3>Top riesgo (Supply Chain Risk #44)</h3><table class="data-table"><thead><tr><th>Tracking</th><th>Score</th><th>Nivel</th></tr></thead><tbody>${d.topRisk.map(r => `<tr><td>${esc(r.trackingNumber)}</td><td>${r.score}/100</td><td class="ts-risk-${r.level}">${r.level}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">—</td></tr>'}</tbody></table></div>
      </div>
      <div class="card glass"><h3>Eventos recientes (Event Bus)</h3><div class="activity-list">${d.recentEvents.map(e => `<div class="activity-item"><span class="activity-dot"></span><div><p>${esc(e.kind)} · ${esc(e.eventType || e.action || e.title || e.event || '')}</p><small>${new Date(e.ts).toLocaleString()} · hash ${esc((e.hash || '').slice(0, 8))}</small></div></div>`).join('') || '<p class="muted">Sin eventos.</p>'}</div></div>`;
  };
  function noProject(host) {
    host.innerHTML = `<div class="ts-empty"><h3>Bienvenido a Tracking Studio</h3>
      <p>El IDE de ingeniería logística: cadenas, envíos, sensores IoT, GIS, simulaciones pesadas y puente con el Virtual Lab.</p>
      <p><button class="btn btn-primary" id="ts-empty-demo">Cargar demo «Global Cold Chain Demo»</button> o <button class="btn g" id="ts-empty-new">Crear proyecto</button></p>
      <p class="muted small">Todo lo simulado se marca <b>SIMULATED</b>; nada toca sistemas externos sin confirmación explícita.</p></div>`;
    $('#ts-empty-demo').onclick = () => $('#ts-demo').click();
    $('#ts-empty-new').onclick = newProjectDialog;
  }

  // ---------------- Projects (#6,#50) ----------------
  RENDER.projects = async (host) => {
    host.innerHTML = '<p class="muted">Cargando…</p>';
    CAT = await T('/state');
    host.innerHTML = `<div class="tool-form" style="margin-bottom:.8rem">
        <input id="pj-name" class="tm-in" placeholder="Nombre del proyecto">
        <select id="pj-mode" class="tm-in">${CAT.modes.map(m => `<option>${m}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" id="pj-create">Crear</button></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Proyecto</th><th>Modo</th><th>Envíos</th><th>Devices</th><th>Rutas</th><th>Geofences</th><th>Alertas</th><th>Incidentes</th><th>Acciones</th></tr></thead><tbody>
      ${CAT.projects.map(p => `<tr><td>${esc(p.name)}${CAT.active && CAT.active.id === p.id ? ' ★' : ''}</td><td>${p.mode}</td><td>${fmt(p.shipments)}</td><td>${fmt(p.devices)}</td><td>${fmt(p.routes)}</td><td>${fmt(p.geofences)}</td><td>${p.alerts}</td><td>${p.incidents}</td>
      <td class="ts-actions"><button class="btn btn-sm g" data-act="use" data-id="${p.id}">Usar</button> <button class="btn btn-sm g" data-act="dup" data-id="${p.id}">Duplicar</button> <a class="btn btn-sm g" href="/api/tracking/projects/${p.id}/export?token=${encodeURIComponent(TOKEN || '')}">Export</a> <button class="btn btn-sm g danger" data-act="del" data-id="${p.id}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">Sin proyectos.</td></tr>'}
      </tbody></table></div>`;
    $('#pj-create').onclick = () => T('/projects', { method: 'POST', body: { name: $('#pj-name').value, mode: $('#pj-mode').value } }).then(() => { say('Proyecto creado'); refreshCurrentTab(); }).catch(e => say(e.message, true));
    host.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const id = b.dataset.id;
      try {
        if (b.dataset.act === 'use') await setProject(id);
        if (b.dataset.act === 'dup') { await T(`/projects/${id}/duplicate`, { method: 'POST', body: {} }); say('Copiado'); refreshCurrentTab(); }
        if (b.dataset.act === 'del') { if (confirm('¿Borrar proyecto? Acción irreversible.')) { await T('/projects/' + id, { method: 'DELETE' }); refreshCurrentTab(); } }
      } catch (e) { say(e.message, true); }
    });
  };

  // ---------------- Shipments (#7,#21) ----------------
  RENDER.shipments = async (host, page = 1) => {
    if (!state.project) return noProject(host);
    host.innerHTML = '<p class="muted">Cargando envíos…</p>';
    let d; try { d = await T(`/shipments?page=${page}&size=50&q=${encodeURIComponent(host.querySelector('#sh-q')?.value || '')}`); } catch (e) { host.innerHTML = `<p>${esc(e.message)}</p>`; return; }
    state.shipments = d.shipments;
    const form = `
      <details class="ts-details"><summary>＋ Crear envío (Package Asset Sheet #21)</summary>
        <div class="tool-form">
          <input id="sh-origin" class="tm-in" placeholder="Origen (ej. Buenos Aires)">
          <input id="sh-dest" class="tm-in" placeholder="Destino (ej. Madrid)">
          <select id="sh-carrier" class="tm-in">${['DHL', 'FedEx', 'UPS', 'USPS', 'Correo Argentino'].map(c => `<option>${c}</option>`).join('')}</select>
          <select id="sh-risk" class="tm-in">${['GENERAL', 'COLD_CHAIN', 'HAZMAT', 'HIGH_VALUE'].map(c => `<option>${c}</option>`).join('')}</select>
          <label class="ts-lbl"><input type="checkbox" id="sh-cold"> Cold chain 2..8°C</label>
          <input id="sh-weight" class="tm-in" type="number" placeholder="kg" min="0" step="0.1">
          <button class="btn btn-primary btn-sm" id="sh-add">Agregar</button>
        </div></details>`;
    host.innerHTML = form + `
      <div class="tool-form"><input id="sh-q" class="tm-in" placeholder="Filtrar tracking/origen/destino…" value=""><button class="btn btn-sm g" id="sh-filter">Filtrar</button></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Tracking</th><th>Estado</th><th>Origen → Destino</th><th>Carrier</th><th>Tipo</th><th>Riesgo</th><th>Ubicación actual</th><th></th></tr></thead><tbody>
      ${d.shipments.map(s => `<tr><td><b>${esc(s.trackingNumber)}</b></td><td><span class="ts-st ts-st-${s.status.toLowerCase()}">${esc(s.status)}</span></td><td>${esc(s.origin)} → ${esc(s.destination)}</td><td>${esc(s.carrier)}</td><td>${esc(s.riskCategory)}</td><td class="ts-risk-${s.risk.level}">${s.risk.score}/100</td><td>${s.currentLocation ? s.currentLocation.lat.toFixed(2) + ',' + s.currentLocation.lon.toFixed(2) : '—'}</td>
      <td><button class="btn btn-sm g" data-sh="${s.id}">Asset sheet</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Sin envíos. Creá uno arriba o cargá la demo.</td></tr>'}
      </tbody></table></div>
      <div class="pager">${Array.from({ length: Math.max(1, Math.ceil(d.total / 50)) }, (_, i) => `<button class="btn btn-sm ${i + 1 === d.page ? 'btn-primary' : 'g'}" data-page="${i + 1}">${i + 1}</button>`).join(' ')}</div>
      <div id="sh-detail"></div>`;
    $('#sh-filter').onclick = () => RENDER.shipments(host);
    $('#sh-q').onkeydown = e => { if (e.key === 'Enter') RENDER.shipments(host); };
    host.querySelectorAll('[data-page]').forEach(b => b.onclick = () => RENDER.shipments(host, +b.dataset.page));
    $('#sh-add').onclick = () => {
      const cold = $('#sh-cold').checked;
      const body = { origin: $('#sh-origin').value, destination: $('#sh-dest').value, carrier: $('#sh-carrier').value, riskCategory: $('#sh-risk').value, weightKg: +$('#sh-weight').value || 1 };
      if (cold) { body.riskCategory = 'COLD_CHAIN'; body.temperatureRequired = { min: 2, max: 8, target: 5, maxExposureMin: 120 }; }
      T('/shipments', { method: 'POST', body }).then(() => { say('Envío creado (evento LABEL_CREATED append-only)'); RENDER.shipments(host); }).catch(e => say(e.message, true));
    };
    host.querySelectorAll('[data-sh]').forEach(b => b.onclick = async () => {
      const s = await T('/shipments/' + b.dataset.sh);
      $('#sh-detail').innerHTML = `<div class="card glass ts-sheet">
        <h3>Package Asset Sheet — ${esc(s.package.trackingId)}</h3>
        <div class="ts-cols2"><div>
          <p><b>Identidad:</b> barcode ${esc(s.package.barcode || '—')} · QR ${esc(s.package.qr || '—')} · RFID ${esc(s.package.rfid || '—')} · sensor ${esc(s.package.sensorUuid || '—')}</p>
          <p><b>Ruta:</b> ${esc(s.origin)} → ${esc(s.destination)} · estado <b>${esc(s.currentStatus)}</b></p>
          <p><b>Físico:</b> ${s.weight ?? 0} kg · ${s.volume?.m3 ?? s.dimensions ? `${s.dimensions.l}×${s.dimensions.w}×${s.dimensions.h} cm` : ''} · valor declarado ${esc(JSON.stringify({}))}${'' }</p>
          <p><b>Sensores:</b> temp ${s.temperature ?? '—'}°C · humedad ${s.humidity ?? '—'}% · batería ${s.battery ?? '—'}%</p>
          <p><b>Red virtual:</b> ${s.networkHost ? `host ${esc(s.networkHost.hostId)} vía gateway ${esc(s.networkHost.gateway || 'gw')}` : 'sin mapeo al Virtual Lab'}</p>
          <p><b>Riesgo:</b> ${s.risk.score}/100 (${s.risk.level}) — excursiones ${s.risk.factors.excursions}, alertas abiertas ${s.risk.factors.openAlerts}</p>
        </div><div>
          <h4>Chain of Custody (#22)</h4>${s.chainOfCustody.length ? s.chainOfCustody.map(c => `<p class="small">${new Date(c.ts).toLocaleString()} · ${esc(c.operation)} ${esc(c.operator)} @ ${esc(c.location)} <code title="firma SHA-256 truncada">${esc(c.signature.slice(0, 10))}</code></p>`).join('') : '<p class="muted small">Sin registros.</p>'}
          <div class="tool-form"><select id="cv-op" class="tm-in">${CAT.custodyOps.map(o => `<option>${o}</option>`).join('')}</select><input id="cv-op-name" class="tm-in" placeholder="Operador"><input id="cv-loc" class="tm-in" placeholder="Lugar"><button class="btn btn-sm btn-primary" id="cv-add">Registrar custodia</button></div>
          <h4>Delivery Proof (#23)</h4>${s.deliveryProof ? `<p class="small">✔ ${esc(s.deliveryProof.method)} por ${esc(s.deliveryProof.operator || '—')} · ${new Date(s.deliveryProof.ts).toLocaleString()}</p>` : '<p class="muted small">Sin prueba.</p>'}
          <div class="tool-form"><select id="dp-m" class="tm-in"><option value="signature">Firma</option><option value="OTP">OTP</option><option value="photo">Foto</option><option value="timestamp">Timestamp</option></select><input id="dp-sign" class="tm-in" placeholder="Nombre que recibe"><button class="btn btn-sm btn-primary" id="dp-add">Probar entrega</button></div>
        </div></div>
        <h4>Timeline de eventos (#9)</h4><div class="ts-timeline">${s.events.map(e => `<div class="ts-ev"><b>${esc(e.eventType || e.action || e.kind)}</b><span>${new Date(e.ts).toLocaleString()}</span><small>${esc(e.source || '')} ${e.latitude != null ? `@${(+e.latitude).toFixed(2)},${(+e.longitude).toFixed(2)}` : ''}</small></div>`).join('') || '<p class="muted small">Sin eventos aún.</p>'}</div></div>`;
      $('#cv-add').onclick = () => T('/custody', { method: 'POST', body: { shipmentId: s.package.id || b.dataset.sh, operation: $('#cv-op').value, operator: $('#cv-op-name').value, location: $('#cv-loc').value } }).then(() => { say('Custodia firmada'); b.click(); }).catch(e => say(e.message, true));
      $('#dp-add').onclick = () => T('/proof', { method: 'POST', body: { shipmentId: b.dataset.sh, method: $('#dp-m').value, signature: $('#dp-sign').value, otpVerified: $('#dp-m').value !== 'OTP', operator: $('#dp-sign').value } }).then(() => { say('Entrega probada → DELIVERED'); RENDER.shipments(host); }).catch(e => say(e.message, true));
    });
  };

  // ---------------- Timeline global (#68) ----------------
  RENDER.timeline = async (host) => {
    if (!state.project) return noProject(host);
    host.innerHTML = '<p class="muted">Cargando eventos…</p>';
    const d = await T('/events?limit=300');
    host.innerHTML = `<p class="muted small">Motor append-only con firma encadenada. Integridad verificada: <b class="${d.integrity.ok ? 'ok' : 'bad'}">${d.integrity.ok ? 'OK ✔ (' + fmt(d.integrity.count) + ' eventos)' : 'ALTERADO en seq ' + d.integrity.at}</b></p>
      <div class="ts-timeline ts-tl-full">${d.events.map(e => `<div class="ts-ev ts-ev-${esc(e.kind)}"><b>#${e.seq} ${esc(e.kind)}</b><span>${new Date(e.ts).toLocaleString()}</span><small>${esc([e.eventType, e.action, e.title, e.event, e.name].filter(Boolean).join(' · '))} ${esc(e.source || '')} · hash ${esc((e.hash || '').slice(0, 10))}</small></div>`).join('') || '<p class="muted">Sin eventos.</p>'}</div>`;
  };

  // ---------------- GIS Map (#15,#16) — canvas sin dependencias ----------------
  RENDER.map = async (host) => {
    if (!state.project) return noProject(host);
    host.innerHTML = '<p class="muted">Cargando mapa…</p>';
    const d = await T('/map');
    state.map = d;
    host.innerHTML = `
      <div class="ts-mapwrap"><canvas id="ts-gis" width="900" height="480"></canvas>
        <div class="ts-maplegend">🟦 hub/nodo · 🟩 dispositivo · 🟧 envío · líneas = rutas · círculos = geofences</div></div>
      <div class="tool-form">
        <select id="mp-layer" class="tm-in"><option value="all">Todas las capas</option><option value="routes">Solo rutas</option><option value="geofences">Solo geofences</option><option value="devices">Solo dispositivos</option><option value="shipments">Solo envíos</option></select>
        <label class="ts-lbl"><input type="checkbox" id="mp-compare" checked> Planned vs Actual</label>
        <button class="btn btn-sm g" id="mp-refresh">Actualizar</button>
        <span class="muted small" id="mp-info">Click en un punto para inspeccionar.</span>
      </div>
      <div id="mp-inspect"></div>`;
    const draw = layer => paintGIS($('#ts-gis'), d, layer, $('#mp-compare').checked);
    draw('all');
    $('#mp-refresh').onclick = () => RENDER.map(host);
    $('#mp-layer').onchange = e => draw(e.target.value);
    $('#mp-compare').onchange = () => draw($('#mp-layer').value);
    $('#ts-gis').onclick = ev => {
      const r = ev.target.getBoundingClientRect();
      const near = nearestPoint(d.markers, ev.clientX - r.left, ev.clientY - r.top, r.width, r.height);
      $('#mp-info').textContent = near ? `${near.kind}: ${near.name}` : 'Nada cerca del click.';
      if (near && near.kind === 'Shipment') inspectShipmentOnMap(near.id);
    };
  };
  async function inspectShipmentOnMap(id) {
    const s = await T('/shipments/' + id);
    $('#mp-inspect').innerHTML = `<div class="card glass"><h4>${esc(s.package.trackingId)} · ${esc(s.currentStatus)}</h4>
      <p class="small">Ubicación: ${s.currentLocation ? s.currentLocation.lat.toFixed(3) + ', ' + s.currentLocation.lon.toFixed(3) : '—'} · Temp ${s.temperature ?? '—'}°C · Riesgo ${s.risk.score}/100 · Host virtual: ${s.networkHost ? esc(s.networkHost.hostId) : '—'}</p>
      <p class="small"><button class="btn btn-sm g" onclick="window.__tsOpenTab('trace')">Ver Network Trace</button></p></div>`;
  }
  window.__tsOpenTab = t => openTab(t);
  function projXY(lat, lon, bounds, w, h) {
    const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon || 1)) * (w - 40) + 20;
    const y = h - 20 - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat || 1)) * (h - 40);
    return [x, y];
  }
  function boundsOf(d) {
    let pts = [];
    d.markers.forEach(m => { if (Number.isFinite(m.lat)) pts.push(m); });
    d.routes.forEach(r => r.points.forEach(p => pts.push(p)));
    if (!pts.length) return { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 };
    return { minLat: Math.min(...pts.map(p => p.lat)), maxLat: Math.max(...pts.map(p => p.lat)), minLon: Math.min(...pts.map(p => p.lon)), maxLon: Math.max(...pts.map(p => p.lon)) };
  }
  function paintGIS(cv, d, layer, compare) {
    if (!cv) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, B = boundsOf(d);
    ctx.fillStyle = '#0b1224'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,160,255,.08)';
    for (let gx = 0; gx < W; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (let gy = 0; gy < H; gy += 60) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    if (layer === 'all' || layer === 'geofences') d.geofences.forEach(gf => {
      const c = gf.center; if (!c) return;
      const [x, y] = projXY(c.lat, c.lon, B, W, H);
      const rKm = gf.radiusKm || 5; const px = (rKm / 111) * ((H - 40) / ((B.maxLat - B.minLat) || 1));
      ctx.strokeStyle = 'rgba(34,211,238,.7)'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.arc(x, y, Math.max(6, px), 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#7dd3fc'; ctx.font = '11px sans-serif'; ctx.fillText(gf.name + ' (' + gf.type + ')', x + 8, y - 8);
    });
    if (layer === 'all' || layer === 'routes') d.routes.forEach(r => {
      ctx.strokeStyle = r.status === 'CLOSED' ? '#ef4444' : '#818cf8'; ctx.lineWidth = 2; ctx.beginPath();
      r.points.forEach((p, i) => { const [x, y] = projXY(p.lat, p.lon, B, W, H); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.lineWidth = 1;
    });
    if (compare && (layer === 'all' || layer === 'shipments')) d.plannedVsActual.forEach(pva => {
      [[pva.planned, 'rgba(129,140,248,.5)'], [pva.actual, '#f59e0b']].forEach(([pts, col], idx) => {
        ctx.strokeStyle = col; ctx.beginPath();
        pts.forEach((p, i) => { const [x, y] = projXY(p.lat, p.lon, B, W, H); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        if (idx === 0) ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      });
    });
    const showM = k => layer === 'all' || layer === k + 's' || (k === 'hub' && layer === 'routes');
    d.markers.forEach(m => {
      const kindLayer = m.kind === 'Shipment' ? 'shipments' : m.kind === 'IoT Device' ? 'devices' : 'hubs';
      if (!(layer === 'all' || layer === kindLayer || (kindLayer === 'hubs' && layer === 'routes'))) return;
      const [x, y] = projXY(m.lat, m.lon, B, W, H);
      m._sx = x; m._sy = y;
      ctx.fillStyle = m.kind === 'Shipment' ? '#fb923c' : m.kind === 'IoT Device' ? '#34d399' : '#60a5fa';
      ctx.beginPath(); ctx.arc(x, y, m.kind === 'Shipment' ? 5 : 4, 0, 7); ctx.fill();
      if (m.meta && m.meta.state === 'BUFFERING') { ctx.strokeStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke(); }
    });
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px monospace';
    ctx.fillText(`${d.markers.length} marcadores · ${d.routes.length} rutas · modo ${d.mode}`, 8, H - 6);
  }
  function nearestPoint(markers, mx, my, w, h) {
    let best = null, bd = 15;
    markers.forEach(m => { if (m._sx == null) return; const dd = Math.hypot(m._sx * (w / 900) - mx * (w / w), m._sy * (h / 480) - my * (h / h)); const d2 = Math.hypot(m._sx * (w / 900) - mx, m._sy * (h / 480) - my); if (d2 < bd) { bd = d2; best = m; } });
    return best;
  }

  // ---------------- Telemetry (#10,#12,#13) ----------------
  RENDER.telemetry = async (host) => {
    if (!state.project) return noProject(host);
    host.innerHTML = '<p class="muted">Cargando telemetría…</p>';
    const [devs, tel] = await Promise.all([T('/devices'), T('/telemetry?limit=200')]);
    host.innerHTML = `
      <div class="tool-form">
        <select id="tl-dev" class="tm-in">${devs.devices.map(d => `<option value="${d.id}">${esc(d.name)} (${esc(d.type)})</option>`).join('') || '<option value="">— sin dispositivos —</option>'}</select>
        <select id="tl-model" class="tm-in">${CAT.sensorModels.map(m => `<option ${m === 'Gaussian' ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <label class="ts-lbl">Temp base <input id="tl-temp" type="number" class="tm-in" value="5" step="0.5" style="width:80px"> °C</label>
        <label class="ts-lbl">Intervalo <input id="tl-int" type="number" class="tm-in" value="2000" min="200" style="width:90px"> ms</label>
        <button class="btn btn-sm btn-primary" id="tl-live">▶ Live tracking</button>
        <button class="btn btn-sm g" id="tl-stop">■ Detener</button>
        <button class="btn btn-sm g" id="tl-burst">Ingestar 1000 lecturas (stress #13)</button>
      </div>
      <p class="muted small">El emulador genera GPS+sensores según el modelo elegido (Gaussian/Sinusoidal/Failure Injection…) y los envía por lotes a POST /api/tracking/telemetry. Las excursiones frías disparan alerta + EXCEPTION automáticamente.</p>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Timestamp</th><th>Device</th><th>GPS</th><th>°C</th><th>%HR</th><th>Luz</th><th>Impacto</th><th>Bat</th><th>Señal</th><th>Fuente</th></tr></thead><tbody id="tl-body">
      ${tel.reads.map(r => rowRead(devices_map(devs), r)).join('') || '<tr><td colspan="10" class="muted">Sin lecturas.</td></tr>'}</tbody></table></div>`;
    const dm = devices_map(devs);
    function devices_map(dd) { const m = {}; dd.devices.forEach(d => m[d.id] = d); return m; }
    let t = 0;
    const genRead = () => {
      const id = $('#tl-dev').value; if (!id) return null;
      const dev = dm[id]; const base = +$('#tl-temp').value || 5; const model = $('#tl-model').value;
      t++;
      let temp = base;
      if (model === 'Gaussian') temp = base + (Math.random() - .5) * 2;
      if (model === 'Sinusoidal') temp = base + Math.sin(t / 8) * 4;
      if (model === 'Random') temp = base + (Math.random() - .5) * 12;
      if (model === 'Constant') temp = base;
      if (model === 'Failure Injection') temp = t % 12 === 0 ? base + 9 : base + (Math.random() - .5);
      if (model === 'Weather Based') temp = base + Math.sin(t / 20) * 6 + Math.random();
      const last = dev.lastLocation || { lat: -34.6, lon: -58.4 };
      return { deviceId: id, timestamp: new Date().toISOString(), gps: { lat: +(last.lat + (Math.random() - .5) * .3).toFixed(5), lon: +(last.lon + (Math.random() - .5) * .3).toFixed(5), altitude: 20, speed: 40 + Math.random() * 60 }, temperature: +temp.toFixed(1), humidity: Math.round(40 + Math.random() * 50), light: Math.round(Math.random() * 900), impactG: +(Math.random() * 2).toFixed(2), battery: Math.max(0, (dev.battery || 100) - t * 0.01), signal: -50 - Math.round(Math.random() * 45) };
    };
    $('#tl-live').onclick = () => {
      if (LIVE) return;
      if (!$('#tl-dev').value) return say('Primero creá un dispositivo IoT en la pestaña IoT Devices.', true);
      const iv = Math.max(200, +$('#tl-int').value || 2000);
      LIVE = setInterval(async () => {
        const reads = []; for (let i = 0; i < 5; i++) { const r = genRead(); if (r) reads.push(r); }
        try { const res = await T('/telemetry', { method: 'POST', body: { reads } });
          const tb = $('#tl-body'); if (tb) { reads.slice().reverse().forEach(r => tb.insertAdjacentHTML('afterbegin', rowRead(dm, r))); while (tb.children.length > 200) tb.lastChild.remove(); }
          if (res.anomalies) say(`⚠ ${res.anomalies} anomalía(s) detectada(s) → alerta creada`, true);
        } catch (e) { clearInterval(LIVE); LIVE = null; say(e.message, true); }
      }, iv);
      say('Live tracking activo (polling cada ' + iv + 'ms, batching 5×5 lecturas)');
    };
    $('#tl-stop').onclick = () => { if (LIVE) { clearInterval(LIVE); LIVE = null; say('Live tracking detenido'); } };
    $('#tl-burst').onclick = async () => {
      const reads = []; for (let i = 0; i < 1000; i++) { const r = genRead(); if (!r) break; reads.push(r); }
      if (!reads.length) return say('Creá un dispositivo primero', true);
      const t0 = performance.now();
      try { const res = await T('/telemetry', { method: 'POST', body: { reads } }); say(`Ingeridas ${fmt(res.accepted)} lecturas en ${Math.round(performance.now() - t0)}ms (${fmt(res.throughputPerSec)}/s, ${res.anomalies} anomalías)`); RENDER.telemetry(host); } catch (e) { say(e.message, true); }
    };
  };
  function rowRead(dm, r) {
    const d = dm[r.deviceId];
    return `<tr><td>${new Date(r.timestamp).toLocaleTimeString()}</td><td>${esc(d ? d.name : r.deviceId)}</td><td>${r.gps ? r.gps.lat.toFixed(3) + ',' + r.gps.lon.toFixed(3) : '—'}</td><td>${r.temperature ?? '—'}</td><td>${r.humidity ?? '—'}</td><td>${r.light ?? '—'}</td><td>${r.impactG ?? '—'}</td><td>${r.battery != null ? Math.round(r.battery) + '%' : '—'}</td><td>${r.signal ?? '—'} dBm</td><td>${esc(r.source || '')}</td></tr>`;
  }

  // ---------------- IoT Devices (#11) ----------------
  RENDER.devices = async (host) => {
    if (!state.project) return noProject(host);
    const [devs, shs, bh] = await Promise.all([T('/devices'), T('/shipments?size=500'), T('/bridge/hosts')]);
    host.innerHTML = `
      <details class="ts-details"><summary>＋ Registrar tracker IoT</summary>
        <div class="tool-form">
          <input id="dv-name" class="tm-in" placeholder="Nombre (tracker-01)">
          <select id="dv-type" class="tm-in">${['GPS', 'RFID', 'BLE', 'CELLULAR', 'SATCOM', 'MULTI'].map(t => `<option>${t}</option>`).join('')}</select>
          <select id="dv-proto" class="tm-in">${['MQTT', 'HTTP', 'CoAP', 'LoRaWAN', 'Satellite'].map(p => `<option>${p}</option>`).join('')}</select>
          <select id="dv-ship" class="tm-in"><option value="">— sin envío —</option>${shs.shipments.map(s => `<option value="${s.id}">${esc(s.trackingNumber)}</option>`).join('')}</select>
          <button class="btn btn-sm btn-primary" id="dv-add">Registrar</button>
        </div></details>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Nombre</th><th>Tipo</th><th>IMEI/MAC/UUID/EPC</th><th>Protocolo</th><th>Envío</th><th>Batería</th><th>Buffer</th><th>Estado</th><th>Host virtual</th><th></th></tr></thead><tbody>
      ${devs.devices.map(d => { const s = shs.shipments.find(x => x.id === d.shipmentId); return `<tr><td><b>${esc(d.name)}</b><br><small>${esc(d.firmware)}</small></td><td>${esc(d.type)}</td><td class="small mono">${esc(d.imei)}<br>${esc(d.mac)}<br>${esc((d.uuid || '').slice(0, 13))}…<br>${esc(d.epc)}</td><td>${esc(d.protocol)}</td><td>${s ? esc(s.trackingNumber) : '—'}</td><td>${d.battery}%</td><td>${(d.buffer || []).length}/${d.bufferMax}</td><td><span class="ts-st ts-st-${d.state.toLowerCase()}">${esc(d.state)}</span></td><td>${esc(d.virtualHostId || '—')}</td>
      <td><select class="tm-in ts-hostsel" data-d="${d.id}"><option value="">mapear host…</option>${bh.hosts.slice(0, 30).map(h => `<option value="${h.id}">${esc(h.alias)}${h.online ? '' : ' (offline)'}${h.simulated ? ' (sim)' : ''}</option>`).join('')}${bh.hosts.length ? '' : '<option value="host-sim-1">host-sim-1 (fallback)</option>'}</select></td></tr>`; }).join('') || '<tr><td colspan="10" class="muted">Sin dispositivos.</td></tr>'}
      </tbody></table></div>
      <p class="muted small">Mapeo Tracker→Host (mapeo #34): al elegir host se registra la cadena IoT Device → Virtual Host → Gateway → Red → Firewall → MQTT → Tracking API → Studio.</p>`;
    $('#dv-add').onclick = () => T('/devices', { method: 'POST', body: { name: $('#dv-name').value, type: $('#dv-type').value, protocol: $('#dv-proto').value, shipmentId: $('#dv-ship').value || null } }).then(() => { say('Tracker dado de alta'); RENDER.devices(host); }).catch(e => say(e.message, true));
    host.querySelectorAll('.ts-hostsel').forEach(sel => sel.onchange = async () => {
      if (!sel.value) return;
      try { const r = await T('/bridge/attach', { method: 'POST', body: { deviceId: sel.dataset.d, hostId: sel.value } }); say(r.mapping); RENDER.devices(host); } catch (e) { say(e.message, true); }
    });
  };

  // ---------------- Topology editor (#16) ----------------
  RENDER.topology = async (host) => {
    if (!state.project) return noProject(host);
    const d = await T('/map');
    const nodes = d.markers.filter(m => m.kind !== 'Shipment' && m.kind !== 'IoT Device');
    host.innerHTML = `
      <details class="ts-details"><summary>＋ Agregar nodo (Factory/Warehouse/Hub/Port/Airport/Customs/Locker/Customer/Vehicle…)</summary>
        <div class="tool-form">
          <select id="nd-type" class="tm-in">${CAT.nodeTypes.map(t => `<option>${t}</option>`).join('')}</select>
          <input id="nd-name" class="tm-in" placeholder="Nombre">
          <input id="nd-lat" class="tm-in" type="number" step="0.001" placeholder="-34.61" style="width:110px">
          <input id="nd-lon" class="tm-in" type="number" step="0.001" placeholder="-58.38" style="width:110px">
          <label class="ts-lbl"><input id="nd-lock" type="checkbox"> bloquear</label>
          <button class="btn btn-sm btn-primary" id="nd-add">Agregar</button>
        </div></details>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Tipo</th><th>Nombre</th><th>Lat/Lon</th><th>Lock</th><th></th></tr></thead><tbody>
      ${nodes.map(n => `<tr><td>${esc(n.kind)}</td><td>${esc(n.name)}</td><td class="mono">${n.lat}, ${n.lon}</td><td>${n.meta && n.meta.locked ? '🔒' : ''}</td><td><button class="btn btn-sm g" data-nm="${esc(n.name)}" data-nl="${n.lat}" data-no="${n.lon}">Mover (lat,lon)</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin nodos. Agregá hubs/warehouses/ports acá o miralos en GIS Mapa.</td></tr>'}
      </tbody></table></div>
      <p class="muted small">Bloqueo/ocultamiento y edición de conexiones se persisten como cambios del escenario (undo disponible vía Snapshots).</p>`;
    $('#nd-add').onclick = () => T('/nodes', { method: 'POST', body: { type: $('#nd-type').value, name: $('#nd-name').value, lat: +$('#nd-lat').value, lon: +$('#nd-lon').value, locked: $('#nd-lock').checked } }).then(() => { say('Nodo agregado'); RENDER.topology(host); }).catch(e => say(e.message, true));
    host.querySelectorAll('[data-nm]').forEach(b => b.onclick = async () => {
      const lat = prompt('Nueva latitud', b.dataset.nl), lon = prompt('Nueva longitud', b.dataset.no);
      if (lat == null) return;
      // buscar id del nodo por nombre (los nodes viven en P.nodes; usamos el endpoint PUT)
      const all = await T('/map');
      const node = all.markers.find(m => m.name === b.dataset.nm && m.kind !== 'Shipment' && m.kind !== 'IoT Device');
      if (!node) return say('Nodo no encontrado', true);
      try { await T('/nodes/' + node.id, { method: 'PUT', body: { lat: +lat, lon: +lon } }); RENDER.topology(host); } catch (e) { say(e.message, true); }
    });
  };

  // ---------------- Routes (#17) ----------------
  RENDER.routes = async (host) => {
    if (!state.project) return noProject(host);
    const d = await T('/map');
    host.innerHTML = `
      <details class="ts-details"><summary>＋ Crear ruta (Route Engine: distancia/ETA/costo/risk)</summary>
        <div class="tool-form">
          <input id="rt-name" class="tm-in" placeholder="Nombre ruta">
          <select id="rt-mode" class="tm-in">${CAT.transportModes.map(m => `<option>${m}</option>`).join('')}</select>
          <textarea id="rt-wps" class="tm-in" rows="3" placeholder="waypoints: lat,lon; lat,lon; … (ej. -34.6,-58.4; -34.9,-57.9; 40.4,-3.7)"></textarea>
          <button class="btn btn-sm btn-primary" id="rt-add">Calcular y crear</button>
        </div></details>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Ruta</th><th>Modo</th><th>Distancia</th><th>ETA</th><th>Costo est.</th><th>Estado</th><th></th></tr></thead><tbody>
      ${d.routes.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.mode)}</td><td>${fmt(r.distanceKm || 0)} km*</td><td>${r.etaHours ?? '—'} h*</td><td>$${r.estimatedCost ?? '—'}*</td><td>${esc(r.status)}</td><td><button class="btn btn-sm g" data-close="${r.id}">${r.status === 'ACTIVE' ? 'Cerrar' : 'Reabrir'}</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin rutas.</td></tr>'}
      </tbody></table></div><p class="muted small">* Calculadas con haversine + velocidad media por modo de transporte. El cierre de ruta dispara re-routing manual desde Envíos.</p>`;
    $('#rt-add').onclick = () => {
      const wps = $('#rt-wps').value.split(';').map(s => s.trim()).filter(Boolean).map(s => { const [lat, lon] = s.split(',').map(Number); return { lat, lon }; });
      T('/routes', { method: 'POST', body: { name: $('#rt-name').value, transportMode: $('#rt-mode').value, waypoints: wps } }).then(r => { say(`Ruta creada: ${r.distanceKm} km · ETA ${r.etaHours} h`); RENDER.routes(host); }).catch(e => say(e.message, true));
    };
    host.querySelectorAll('[data-close]').forEach(b => b.onclick = () => T('/routes/' + b.dataset.close, { method: 'PUT', body: { status: b.textContent.trim() === 'Cerrar' ? 'CLOSED' : 'ACTIVE' } }).then(() => RENDER.routes(host)));
  };

  // ---------------- Geofences (#18) ----------------
  RENDER.geofences = async (host) => {
    if (!state.project) return noProject(host);
    const g = await T('/geofences');
    host.innerHTML = `
      <details class="ts-details"><summary>＋ Crear geofence</summary>
        <div class="tool-form">
          <input id="gf-name" class="tm-in" placeholder="Nombre">
          <select id="gf-type" class="tm-in">${CAT.geofenceTypes.map(t => `<option>${t}</option>`).join('')}</select>
          <input id="gf-lat" class="tm-in" type="number" step="0.001" placeholder="center lat" style="width:110px">
          <input id="gf-lon" class="tm-in" type="number" step="0.001" placeholder="center lon" style="width:110px">
          <input id="gf-r" class="tm-in" type="number" placeholder="radio km" value="10" style="width:90px">
          <input id="gf-pts" class="tm-in" placeholder="polygon: lat,lon; lat,lon; lat,lon" style="min-width:260px">
          <button class="btn btn-sm btn-primary" id="gf-add">Crear</button>
        </div></details>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Nombre</th><th>Tipo</th><th>Centro/Radio</th><th>Reglas</th></tr></thead><tbody>
      ${g.geofences.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.type)}</td><td class="mono">${x.center ? x.center.lat + ',' + x.center.lon + ' · ' + x.radiusKm + 'km' : (x.points || []).length + ' puntos'}</td><td class="small">vel≤${x.rules.maxSpeedKmh}km/h · temp≤${x.rules.tempMax}°C · dwell≤${x.rules.dwellMin}min</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin geofences.</td></tr>'}
      </tbody></table></div>
      <p class="muted small">Los ENTER/EXIT se evalúan en cada lectura GPS y quedan en el timeline como eventos geofence.</p>`;
    $('#gf-add').onclick = () => {
      const body = { name: $('#gf-name').value, type: $('#gf-type').value, radiusKm: +$('#gf-r').value, center: { lat: +$('#gf-lat').value, lon: +$('#gf-lon').value } };
      if ($('#gf-pts').value.trim()) body.points = $('#gf-pts').value.split(';').map(s => s.trim()).filter(Boolean).map(s => { const [lat, lon] = s.split(',').map(Number); return { lat, lon }; });
      T('/geofences', { method: 'POST', body }).then(() => { say('Geofence activo'); RENDER.geofences(host); }).catch(e => say(e.message, true));
    };
  };

  // ---------------- Simulation (#30) + Stress (#31) ----------------
  RENDER.simulations = async (host) => {
    if (!state.project) return noProject(host);
    const s = await T('/simulations');
    host.innerHTML = `
      <details class="ts-details" open><summary>▶ Ejecutar simulación (Simulation Runner)</summary>
        <div class="tool-form">
          <label class="ts-lbl">Shipments <input id="sm-count" type="number" class="tm-in" value="500" min="1" max="500000" style="width:100px"></label>
          <label class="ts-lbl">Frecuencia Hz <input id="sm-freq" type="number" class="tm-in" value="1" min="1" max="1000" style="width:80px"></label>
          <label class="ts-lbl">Duración s <input id="sm-dur" type="number" class="tm-in" value="60" min="1" max="600" style="width:80px"></label>
          <label class="ts-lbl">Workers <input id="sm-workers" type="number" class="tm-in" value="2" min="1" max="4" style="width:60px"></label>
          <label class="ts-lbl">Seed <input id="sm-seed" type="number" class="tm-in" value="42" style="width:100px"></label>
          <select id="sm-weather" class="tm-in">${['clear', 'rain', 'storm', 'snow', 'fog', 'extreme heat', 'extreme cold'].map(w => `<option>${w}</option>`).join('')}</select>
          <select id="sm-carrier" class="tm-in">${['normal', 'delayed', 'unstable', 'offline'].map(w => `<option>${w}</option>`).join('')}</select>
        </div>
        <div class="tool-form"><label class="ts-lbl">Failure injection:</label>${CAT.failures.map(f => `<label class="ts-lbl ts-mini"><input type="checkbox" class="sm-fail" value="${esc(f)}"> ${esc(f)}</label>`).join('')}</div>
        <button class="btn btn-sm btn-primary" id="sm-run">Ejecutar</button>
      </details>
      <div id="sm-progress"></div>
      <h3>Runs anteriores</h3>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Nombre</th><th>Estado</th><th>Eventos</th><th>Fallas</th><th>Warnings</th><th>Throughput</th><th>Duración</th></tr></thead><tbody>
      ${s.runs.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.state)}</td><td>${fmt(r.generated)}</td><td>${r.failures}</td><td>${r.warnings}</td><td>${fmt(r.throughputPerSec || 0)}/s</td><td>${Math.round((r.elapsedMs || 0) / 1000)}s</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin runs.</td></tr>'}
      </tbody></table></div>`;
    $('#sm-run').onclick = async () => {
      const fails = host.querySelectorAll('.sm-fail:checked').map(c => c.value);
      try {
        const r = await T('/simulations', { method: 'POST', body: { shipementCount: undefined, shipmentCount: +$('#sm-count').value, telemetryFrequencyHz: +$('#sm-freq').value, durationSec: +$('#sm-dur').value, workers: +$('#sm-workers').value, seed: +$('#sm-seed').value, weather: $('#sm-weather').value, carrierBehavior: $('#sm-carrier').value, failureInjection: fails } });
        say(`Run lanzado: ${fmt(r.totalEvents)} eventos planificados`);
        if (SIM_POLL) clearInterval(SIM_POLL);
        SIM_POLL = setInterval(async () => {
          const st = await T('/simulations');
          const run = st.running.find(x => x.id === r.id);
          $('#sm-progress').innerHTML = run ? `<div class="prog-bar-wrap"><div class="prog-bar" style="width:${run.progress}%"></div></div><p class="small">${run.progress}% · <button class="btn btn-sm g" id="sm-cancel">Cancelar</button></p>
            ;` : `<p class="small">✔ Run finalizado (o cancelado). Refresh de datos aplicado.</p>`;
          if (!run) { clearInterval(SIM_POLL); SIM_POLL = null; CAT = await T('/state'); drawProjectSelect(); }
          const cb = $('#sm-cancel'); if (cb) cb.onclick = () => T(`/simulations/${r.id}/cancel`, { method: 'POST', body: {} });
        }, 1000);
      } catch (e) { say(e.message, true); }
    };
  };
  RENDER.stress = RENDER.simulations; // misma motorización con límites visibles

  // ---------------- Snapshots (#28) + Scenarios (#29) ----------------
  RENDER.snapshots = async (host) => {
    if (!state.project) return noProject(host);
    const sn = await T('/snapshots');
    host.innerHTML = `
      <div class="tool-form"><input id="sn-name" class="tm-in" placeholder="Nombre snapshot"><button class="btn btn-sm btn-primary" id="sn-add">Capturar snapshot</button></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Nombre</th><th>Cuándo</th><th>Modo</th><th>Eventos</th><th></th></tr></thead><tbody>
      ${sn.snapshots.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${new Date(x.ts).toLocaleString()}</td><td>${x.mode}</td><td>${fmt(x.eventsCount)}</td>
      <td class="ts-actions"><button class="btn btn-sm g" data-restore="${x.id}">Restaurar</button> <button class="btn btn-sm g" data-branch="${x.id}">Branch scenario</button> <button class="btn btn-sm g" data-cmp="${x.id}">Comparar…</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin snapshots.</td></tr>'}
      </tbody></table></div><div id="sn-cmp"></div>
      <p class="muted small">Snapshot captura shipments, devices, routes, geofences, alerts, excursions, nodes y escenarios. Restaurar pide confirmación explícita (#79).</p>`;
    $('#sn-add').onclick = () => T('/snapshots', { method: 'POST', body: { name: $('#sn-name').value } }).then(() => { say('Snapshot capturado'); RENDER.snapshots(host); }).catch(e => say(e.message, true));
    host.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => {
      if (!confirm('Restaurar reemplaza el estado actual del proyecto por el del snapshot. ¿Continuar?')) return;
      T(`/snapshots/${b.dataset.restore}/restore`, { method: 'POST', body: { confirm: true } }).then(() => { say('Estado restaurado'); refreshCurrentTab(); }).catch(e => say(e.message, true));
    });
    host.querySelectorAll('[data-branch]').forEach(b => b.onclick = () => {
      const name = prompt('Nombre del escenario derivado (branch):', 'Scenario A'); if (!name) return;
      T('/scenarios', { method: 'POST', body: { name, fromSnapshotId: b.dataset.branch } }).then(() => { say('Scenario branch creado (el padre queda intacto)'); openTab('scenarios'); }).catch(e => say(e.message, true));
    });
    host.querySelectorAll('[data-cmp]').forEach(b => b.onclick = async () => {
      const other = prompt('ID del otro snapshot (pegar de la tabla o dejar vacío para el más reciente):', '');
      const target = other || sn.snapshots.find(x => x.id !== b.dataset.cmp)?.id;
      if (!target) return;
      const r = await T(`/snapshots/${b.dataset.cmp}/compare`, { method: 'POST', body: { otherId: target } });
      $('#sn-cmp').innerHTML = `<div class="card glass"><h4>Diff: ${esc(r.a)} ⇄ ${esc(r.b)}</h4><pre class="mono small">${esc(JSON.stringify(r.diff, null, 2))}</pre></div>`;
    });
  };
  RENDER.scenarios = async (host) => {
    if (!state.project) return noProject(host);
    const st = await T('/dashboard').catch(() => null);
    const CAT2 = await T('/state');
    host.innerHTML = `<p class="muted small">Los escenarios (branches) se listan por proyecto. Usá “Branch scenario” desde Snapshots para derivar uno del estado actual o de un snapshot.</p>
      <div class="card glass"><h4>Escenarios del proyecto activo</h4><div id="sc-list">Cargando…</div></div>`;
    try {
      const d = await fetch('/api/tracking/dashboard', { headers: authHeaders() }).then(r => r.json());
      $('#sc-list').innerHTML = '<p class="small">Tip: abrí la demo para ver “Normal Operations” ⇄ “Cold Chain Failure” ya ramificados y comparables.</p>';
    } catch (_) {}
    const sc = await T('/events?kind=system&limit=50');
    $('#sc-list').insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data-table"><thead><tr><th>Acción sistema</th><th>Cuándo</th></tr></thead><tbody>${sc.events.filter(e => e.action === 'scenario.branch').map(e => `<tr><td>Branch: ${esc(e.name)}</td><td>${new Date(e.ts).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Sin branches registrados.</td></tr>'}</tbody></table></div>`);
  };

  // ---------------- Bridge (#33..#36) + Trace ----------------
  RENDER.bridge = async (host) => {
    const b = await T('/bridge/hosts');
    host.innerHTML = `
      <div class="card glass"><h3>Virtual Lab Bridge</h3>
        <p class="small">Interfaz desacoplada: Tracking Studio es <b>LOGISTICS INTELLIGENCE CLIENT</b>, el Virtual Lab es <b>INFRASTRUCTURE PROVIDER</b>. Sin app conectada, el Bridge responde con infraestructura virtual de <b>fallback simulado</b> — todas las funciones siguen operando (#72).</p>
        <div class="ts-mapflow">${['Tracker GPS', 'IoT Device', 'Virtual Host', 'Cellular Gateway', 'Virtual Network', 'Firewall', 'MQTT Broker', 'Tracking API', 'Tracking Studio'].map(x => `<span class="ts-flow">${esc(x)}</span>`).join('<i>↓</i>')}</div>
      </div>
      <div class="ts-cols2">
        <div class="card glass"><h4>Hosts virtuales (${b.hosts.length})</h4><div class="table-wrap"><table class="data-table"><thead><tr><th>Alias/IP</th><th>Estado</th><th>Fuente</th></tr></thead><tbody>${b.hosts.slice(0, 25).map(h => `<tr><td class="mono">${esc(h.alias || h.ip)}${h.simulated ? ' <b>(sim)</b>' : ''}</td><td>${h.online ? '🟢 online' : '🔴 offline'}</td><td>${esc(h.source || 'simulated')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sin hosts: conectá la app o usá el mapeo de dispositivos (usa fallback).</td></tr>'}</tbody></table></div></div>
        <div class="card glass"><h4>Gateways / Networks / Firewalls</h4>
          ${b.gateways.map(g => `<p class="small">⇄ <b>${esc(g.name)}</b> (${esc(g.type)}) ${g.online ? '🟢' : '🔴'}${g.simulated ? ' <b>simulado</b>' : ''}</p>`).join('')}
          ${b.networks.map(n => `<p class="small">🌐 ${esc(n.name)} <span class="mono">${esc(n.cidr)}</span>${n.simulated ? ' <b>sim</b>' : ''}</p>`).join('')}
          ${b.firewalls.map(f => `<p class="small">🛡 ${esc(f.name)} · ${f.rules} reglas${f.simulated ? ' <b>sim</b>' : ''}</p>`).join('')}
        </div></div>
      <p class="muted small">Mapeá dispositivos en la pestaña <b>IoT Devices</b> (columna “mapear host”). Suscripción a eventos de red: el Event Bus interno expone virtuallab.connected/disconnected.</p>`;
  };
  RENDER.trace = async (host) => {
    if (!state.project) return noProject(host);
    const shs = await T('/shipments?size=500');
    host.innerHTML = `<div class="tool-form"><select id="tr-sh" class="tm-in">${shs.shipments.map(s => `<option value="${s.id}">${esc(s.trackingNumber)} · ${esc(s.origin)}→${esc(s.destination)}</option>`).join('') || '<option value="">— sin envíos —</option>'}</select><button class="btn btn-sm btn-primary" id="tr-go">Trazar PHYSICAL + DIGITAL</button></div><div id="tr-out"></div>`;
    $('#tr-go').onclick = async () => {
      const id = $('#tr-sh').value; if (!id) return;
      const t = await T('/network-trace/' + id);
      const hopHtml = hops => hops.map(h => `<div class="ts-hop"><b>${esc(h.place || h.node)}</b>${h.latencyMs != null ? `<small>${h.latencyMs}ms</small>` : ''}<small>pkt ${fmt(h.packets ?? 0)} · err ${h.errors ?? 0}${h.dropped ? ` · drop ${h.dropped}` : ''}${h.simulated ? ' · <b>sim</b>' : ''}</small></div>`).join('<i>↓</i>');
      $('#tr-out').innerHTML = `<div class="ts-cols2">
        <div class="card glass"><h4>${esc(t.physical.label)}</h4>${hopHtml(t.physical.hops)}</div>
        <div class="card glass"><h4>${esc(t.digital.label)}</h4>${hopHtml(t.digital.hops)}</div></div>
        ${t.failureEffect ? `<div class="card glass ts-failbox"><b>Efecto logístico de la falla de red:</b> ${esc(t.failureEffect)}</div>` : ''}
        ${t.recovery ? `<div class="card glass"><b>Recuperación:</b> ${esc(t.recovery)}</div>` : ''}
        <p class="small">Confianza ETA del envío asociado: <b>${Math.round(t.associatedShipment.etaConfidence * 100)}%</b> · Bridge: ${t.bridge.connected ? 'Virtual Lab real' : 'fallback simulado'}</p>`;
    };
  };

  // ---------------- Failures (#32,#36) ----------------
  RENDER.failures = async (host) => {
    if (!state.project) return noProject(host);
    const devs = await T('/devices');
    host.innerHTML = `
      <div class="tool-form">
        <select id="fl-dev" class="tm-in">${devs.devices.map(d => `<option value="${d.id}">${esc(d.name)} (${esc(d.state)})</option>`).join('') || '<option value="">— sin devices —</option>'}</select>
        <select id="fl-kind" class="tm-in">${CAT.failures.map(f => `<option>${f}</option>`).join('')}</select>
        <button class="btn btn-sm btn-primary" id="fl-inject">Inyectar falla (LAB)</button>
        <button class="btn btn-sm g" id="fl-recover">Recuperar conectividad</button>
      </div>
      <div class="card glass"><h4>Cadena de efecto esperada (#36)</h4>
        ${['Sensor offline', 'Telemetry buffer increases', 'Events queued', 'ETA confidence decreases', 'Alert created'].map(x => `<div class="ts-hop"><b>${x}</b></div>`).join('<i>↓</i>')}
        <p class="muted small">Y al recuperar: Connection restored → Buffered events → Replay → Synchronization → State reconciliation.</p>
        <p class="small">⚠ Restringido a Local Lab / Sandbox / Authorized Simulation. Nunca contra sistemas externos (#85).</p></div>`;
    $('#fl-inject').onclick = () => T('/failures/inject', { method: 'POST', body: { deviceId: $('#fl-dev').value, kind: $('#fl-kind').value } }).then(r => { say(r.effect || 'Falla inyectada'); openTab('alerts'); }).catch(e => say(e.message, true));
    $('#fl-recover').onclick = () => T('/failures/recover', { method: 'POST', body: {} }).then(r => say(`Recuperado: ${fmt(r.replayedEvents)} eventos del buffer reproducidos y sincronizados`)).catch(e => say(e.message, true));
  };

  // ---------------- Incidents / Alerts / Risk (#42..#44) ----------------
  RENDER.alerts = async (host) => {
    if (!state.project) return noProject(host);
    const a = await T('/alerts');
    host.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Sev</th><th>Título</th><th>Detalle</th><th>Modo</th><th>Cuándo</th><th></th></tr></thead><tbody>
      ${a.alerts.map(x => `<tr class="${x.ack ? 'ts-ack' : ''}"><td><span class="ts-risk-${x.severity === 'high' ? 'high' : x.severity === 'low' ? 'low' : 'medium'}">${esc(x.severity)}</span></td><td><b>${esc(x.title)}</b><br><small>${esc(x.kind)}</small></td><td class="small">${esc(x.detail)}</td><td>${esc(x.mode)}</td><td>${new Date(x.ts).toLocaleString()}</td><td>${x.ack ? (x.ackedBy || '✓') : `<button class="btn btn-sm g" data-ack="${x.id}">Ack</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin alertas. Probá Live tracking con temperatura fuera de rango o inyectá una falla.</td></tr>'}
      </tbody></table></div>`;
    host.querySelectorAll('[data-ack]').forEach(b => b.onclick = () => T(`/alerts/${b.dataset.ack}/ack`, { method: 'POST', body: {} }).then(() => RENDER.alerts(host)));
  };
  RENDER.incidents = async (host) => {
    if (!state.project) return noProject(host);
    const [inc, al, shs] = await Promise.all([T('/incidents'), T('/alerts'), T('/shipments?size=500')]);
    host.innerHTML = `
      <details class="ts-details"><summary>＋ Abrir incidente (Investigation Center #42)</summary>
        <div class="tool-form"><input id="in-title" class="tm-in" placeholder="Título"><select id="in-sev" class="tm-in"><option>low</option><option selected>medium</option><option>high</option><option>critical</option></select>
        <select id="in-sh" class="tm-in">${shs.shipments.slice(0, 100).map(s => `<option value="${s.id}">${esc(s.trackingNumber)}</option>`).join('')}</select>
        <button class="btn btn-sm btn-primary" id="in-add">Crear + causa raíz automática</button></div></details>
      ${inc.incidents.map(i => `<div class="card glass ${i.state === 'resolved' ? 'ts-ack' : ''}">
        <h4>${esc(i.title)} <span class="ts-risk-${i.severity}">${esc(i.severity)}</span> <small>[${esc(i.state)}]</small></h4>
        <p class="small">Modo ${esc(i.mode)} · ${i.shipmentIds.length} envíos · ${i.alertIds.length} alertas ligadas · ${new Date(i.ts).toLocaleString()}</p>
        ${i.rootCause ? `<p class="small"><b>Root cause analysis:</b> hipótesis: ${esc(i.rootCause.hypothesis)} (confianza ${Math.round(i.rootCause.confidence * 100)}%) · tipos detectados: ${i.rootCause.detectedKinds.map(esc).join(', ')}</p>` : ''}
        ${i.resolution ? `<p class="small"><b>Resolución:</b> ${esc(i.resolution)}</p>` : ''}
        <div class="tool-form">${['investigating', 'resolved'].map(st => `<button class="btn btn-sm g" data-st="${st}" data-id="${i.id}">${st}</button>`).join('')}<input class="tm-in" id="res-${i.id}" placeholder="Describir resolución…"></div>
      </div>`).join('') || '<p class="muted">Sin incidentes.</p>'}`;
    $('#in-add').onclick = () => T('/incidents', { method: 'POST', body: { title: $('#in-title').value, severity: $('#in-sev').value, shipmentIds: [$('#in-sh').value], alertIds: al.alerts.filter(a => a.shipmentId === $('#in-sh').value).map(a => a.id) } }).then(() => { say('Incidente creado con análisis de causa raíz'); RENDER.incidents(host); }).catch(e => say(e.message, true));
    host.querySelectorAll('[data-st]').forEach(b => b.onclick = () => T('/incidents/' + b.dataset.id, { method: 'PUT', body: { state: b.dataset.st, resolution: ($('#res-' + b.dataset.id) || {}).value } }).then(() => RENDER.incidents(host)));
  };
  RENDER.risk = async (host) => {
    if (!state.project) return noProject(host);
    const d = await T('/dashboard');
    host.innerHTML = `<p class="muted small">Supply Chain Risk Score combina categoría, cold chain, excursiones, alertas abiertas, estado EXCEPCIÓN e incidentes.</p>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Tracking</th><th>Score</th><th>Nivel</th><th>Factores</th></tr></thead><tbody>
      ${d.topRisk.map(r => `<tr><td>${esc(r.trackingNumber)}</td><td>${r.score}/100</td><td class="ts-risk-${r.level}"><b>${r.level.toUpperCase()}</b></td><td class="small">excursiones ${r.factors.excursions} · alertas ${r.factors.openAlerts}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin envíos evaluados.</td></tr>'}
      </tbody></table></div>`;
  };

  // ---------------- Carriers (#24,#83) + Webhook Lab (#25) + Replay (#27) ----------------
  RENDER.carriers = async (host) => {
    if (!state.project) return noProject(host);
    const c = await T('/carriers');
    host.innerHTML = `<p class="muted small">${esc(c.carriers[0]?.note || '')}</p>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Carrier</th><th>Adapter</th><th>Ambiente</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
      ${c.carriers.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.adapter)}</td><td>${esc(x.env)}</td><td><span class="ts-st ts-st-${x.status.toLowerCase()}">${esc(x.status)}</span></td>
      <td class="ts-actions"><button class="btn btn-sm g" data-env="sandbox" data-id="${x.id}">Sandbox</button><button class="btn btn-sm g" data-env="mock" data-id="${x.id}">Mock</button><button class="btn btn-sm g danger" data-env="production" data-id="${x.id}">Producción</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small">Cada carrier tiene Production/Sandbox/Mock adapter. Pasar a producción exige confirmación explícita; sin credenciales reales no se contacta a terceros (#83,#84).</p>`;
    host.querySelectorAll('[data-env]').forEach(b => b.onclick = async () => {
      const body = { env: b.dataset.env };
      if (b.dataset.env === 'production') { if (!confirm('¿Confirmás conectar este carrier a PRODUCCIÓN? Se pedirá confirmación también en el servidor.')) return; body.confirm = true; }
      try { await T('/carriers/' + b.dataset.id, { method: 'PUT', body }); say('Carrier actualizado: ' + b.dataset.env); RENDER.carriers(host); } catch (e) { say(e.message, true); }
    });
  };
  RENDER.webhooks = async (host) => {
    if (!state.project) return noProject(host);
    host.innerHTML = `
      <div class="tool-form">
        <select id="wh-act" class="tm-in">${['generate', 'replay', 'delay', 'drop', 'duplicate', 'modify', 'retry'].map(a => `<option>${a}</option>`).join('')}</select>
        <input id="wh-tn" class="tm-in" placeholder="trackingNumber (ej. TSDEMO1)">
        <input id="wh-endpoint" class="tm-in" placeholder="endpoint (default /webhooks/carrier)">
        <button class="btn btn-sm btn-primary" id="wh-go">Simular webhook</button>
      </div>
      <p class="muted small">Webhook Lab corre solo en sandbox local: genera payloads con HMAC firmado, simula delays/drops/retries y muestra la respuesta. Nunca envía a terceros.</p>
      <div id="wh-out"></div>`;
    $('#wh-go').onclick = async () => {
      const r = await T('/webhooks/simulate', { method: 'POST', body: { action: $('#wh-act').value, trackingNumber: $('#wh-tn').value, endpoint: $('#wh-endpoint').value || undefined, payload: { event: 'IN_TRANSIT', trackingNumber: $('#wh-tn').value || 'TSDEMO1' } } });
      $('#wh-out').innerHTML = `<div class="card glass"><h4>Webhook ${esc(r.webhook.direction)}</h4><pre class="mono small">${esc(JSON.stringify({ endpoint: r.webhook.endpoint, headers: r.webhook.headers, payload: r.webhook.payload, response: r.webhook.response, retries: r.webhook.retries }, null, 2))}</pre><p class="small">${esc(r.note)}</p></div>`;
    };
  };
  RENDER.replay = async (host) => {
    if (!state.project) return noProject(host);
    host.innerHTML = `
      <div class="tool-form"><select id="rp-fmt" class="tm-in"><option>GPX</option><option>NMEA</option><option>CSV</option><option>JSON</option></select>
      <button class="btn btn-sm btn-primary" id="rp-go">Parsear y reproducir como REPLAY</button></div>
      <textarea id="rp-data" class="tm-in mono" rows="10" placeholder="Pegá el track: GPX (<trkpt lat lon>), NMEA ($GNRMC), CSV (lat,lon,time) o JSON ([{lat,lon,timestamp}])"></textarea>
      <div id="rp-out"></div>`;
    $('#rp-go').onclick = async () => {
      try {
        const r = await T('/replay/parse', { method: 'POST', body: { format: $('#rp-fmt').value, text: $('#rp-data').value } });
        $('#rp-out').innerHTML = `<div class="card glass"><h4>Replay OK</h4><p class="small">${fmt(r.parsed)} puntos parseados · primero ${esc(JSON.stringify(r.first))} · último ${esc(JSON.stringify(r.last))}</p><p class="small">${esc(r.note)}</p></div>`;
        say(`Replay: ${r.parsed} puntos aplicados sobre el dispositivo base`);
      } catch (e) { $('#rp-out').innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
    };
  };

  // ---------------- Code Intelligence (#37..#39) ----------------
  RENDER.codeintel = async (host) => {
    host.innerHTML = `
      <p class="muted small">Analizador estático (JS/TS; Python/Java/Go en roadmap) sobre archivos del repo: webhooks sin firma, HTTP sin retry, secretos hardcodeados (API keys, JWT, private keys, connection strings).</p>
      <div class="tool-form"><input id="ci-files" class="tm-in" value="server.js, server-code.js, public/app.js" style="min-width:340px"><button class="btn btn-sm btn-primary" id="ci-go">Analizar</button></div>
      <div id="ci-out"></div>`;
    $('#ci-go').onclick = async () => {
      $('#ci-out').innerHTML = '<p class="muted">Analizando…</p>';
      const files = $('#ci-files').value.split(',').map(s => s.trim()).filter(Boolean);
      try {
        const r = await T('/code/analyze', { method: 'POST', body: { files } });
        $('#ci-out').innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Archivo</th><th>Línea</th><th>Tipo</th><th>Riesgo</th><th>Explicación</th><th>Recomendación</th></tr></thead><tbody>
        ${r.findings.map(f => `<tr><td class="mono">${esc(f.file)}</td><td>${f.line}</td><td>${esc(f.type)}${f.pattern ? ' · ' + esc(f.pattern) : ''}</td><td class="ts-risk-${f.risk === 'info' ? 'low' : f.risk}">${esc(f.risk)}</td><td class="small">${esc(f.explanation || f.error || '')}</td><td class="small">${esc(f.recommendation || '')}</td></tr>`).join('')}
        </tbody></table></div><p class="small">${esc(r.note)}</p>`;
      } catch (e) { $('#ci-out').innerHTML = `<p>${esc(e.message)}</p>`; }
    };
  };

  // ---------------- Resources (#14) ----------------
  RENDER.resources = async (host) => {
    const r = await T('/resources');
    host.innerHTML = `
      <div class="grid-dashboard">
        <div class="card glass stat-card"><h4>CPU</h4><p class="stat-value">${r.cpuPct}%</p><small>${r.cores} cores</small></div>
        <div class="card glass stat-card"><h4>RAM</h4><p class="stat-value">${fmt(r.ramUsedMB)} MB</p><small>de ${fmt(r.ramTotalMB)} MB</small></div>
        <div class="card glass stat-card"><h4>Workers activos</h4><p class="stat-value">${r.workers}</p></div>
        <div class="card glass stat-card"><h4>Eventos/s</h4><p class="stat-value">${fmt(r.eventsPerSec)}</p></div>
        <div class="card glass stat-card"><h4>Queue depth</h4><p class="stat-value">${fmt(r.queueDepth)}</p></div>
      </div>
      <div class="card glass"><h4>Límites obligatorios</h4><pre class="mono small">${esc(JSON.stringify({ limits: r.limits, storage: r.storage }, null, 2))}</pre><p class="small">${esc(r.note)}</p></div>`;
  };

  // ---------------- Reports (#51) + Import/Export (#50) ----------------
  RENDER.reports = async (host) => {
    if (!state.project) return noProject(host);
    host.innerHTML = `<div class="tool-form"><input id="rp-name" class="tm-in" placeholder="Nombre del reporte"><button class="btn btn-sm btn-primary" id="rp-gen">Generar reporte (Markdown)</button></div><div id="rp-view"></div>`;
    $('#rp-gen').onclick = async () => {
      const r = await T('/reports', { method: 'POST', body: { name: $('#rp-name').value } });
      $('#rp-view').innerHTML = `<div class="card glass"><h4>${esc(r.name)}</h4><pre class="mono small" style="white-space:pre-wrap">${esc(r.markdown)}</pre>
        <button class="btn btn-sm g" id="rp-dl">Descargar .md</button></div>`;
      $('#rp-dl').onclick = () => { const blob = new Blob([r.markdown], { type: 'text/markdown' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = r.name.replace(/\s+/g, '-') + '.md'; a.click(); };
    };
  };
  RENDER.importexport = async (host) => {
    if (!state.project) return noProject(host);
    host.innerHTML = `
      <div class="card glass"><h4>Exportar proyecto activo</h4>
        <p class="small">Descarga todo el modelo (shipments, devices, rutas, geofences, alertas, eventos) como JSON versionado.</p>
        <a class="btn btn-sm btn-primary" id="ie-exp" href="#">Descargar JSON</a></div>
      <div class="card glass"><h4>Importar proyecto</h4>
        <p class="small">Pegá un JSON exportado. Se crea como proyecto nuevo con ID propio (no pisa el padre).</p>
        <textarea id="ie-json" class="tm-in mono" rows="6" placeholder='{"format":"iphub-tracking-export", ...}'></textarea>
        <button class="btn btn-sm btn-primary" id="ie-imp">Importar</button></div>`;
    $('#ie-exp').href = '/api/tracking/projects/' + state.project + '/export';
    $('#ie-imp').onclick = () => {
      try { const j = JSON.parse($('#ie-json').value); T('/projects/import', { method: 'POST', body: j }).then(() => { say('Proyecto importado'); loadState($('#tracking-root')); }).catch(e => say(e.message, true)); }
      catch (_) { say('JSON inválido', true); }
    };
  };

  // ---------------- Help ----------------
  RENDER.help = async (host) => {
    host.innerHTML = `<div class="card glass"><h4>Cómo usar Tracking Studio</h4><ol class="small">
      <li><b>Cargar demo</b> (botón arriba) o <b>crear proyecto</b> eligiendo modo REAL/SIMULATED/REPLAY/HYBRID.</li>
      <li>En <b>Topología Logística</b> creá hubs/warehouses/ports; en <b>Rutas</b> trazá cadenas con ETA/costo; en <b>Geofences</b> definí zonas.</li>
      <li>En <b>Envíos</b> creá paquetes (marcá cold chain 2..8°C); en <b>IoT Devices</b> registrá trackers y asociarlos al envío.</li>
      <li>En <b>Telemetría</b> apretá ▶ Live tracking: el emulador inyecta GPS+temperatura; las excursiones generan alerta + EXCEPTION solas.</li>
      <li>En <b>Failure Sim</b> inyectá “Gateway Offline”: el device pasa a BUFFERING; <b>Network Trace</b> muestra el efecto físico+digital; “Recuperar” hace replay del buffer.</li>
      <li><b>Simulación</b> genera miles/millones de eventos con límites; <b>Snapshots</b> congelan el estado; <b>Branch scenario</b> deriva un escenario sin tocar el padre; <b>Comparar</b> muestra diffs.</li>
      <li><b>Incidentes</b> agrupan alertas con causa raíz automática; <b>Reportes</b> exporta Markdown; <b>Import/Export</b> mueve proyectos.</li>
      <li>El <b>Manual</b> (barra lateral → !) tiene la ficha técnica de cada función con sus APIs.</li></ol></div>`;
  };

  // ---------------- Búsqueda global + hotkeys (#63,#64) ----------------
  function authHeaders() { const h = { 'Content-Type': 'application/json' }; if (typeof TOKEN !== 'undefined' && TOKEN) h.Authorization = 'Bearer ' + TOKEN; return h; }
  let SEARCH_T = null;
  function bindSearch() {
    const inp = $('#ts-search'), out = $('#ts-search-results');
    inp.oninput = () => {
      clearTimeout(SEARCH_T);
      SEARCH_T = setTimeout(async () => {
        const q = inp.value.trim(); if (!q || !state.project) { out.classList.add('hidden'); return; }
        try {
          const r = await T('/search?q=' + encodeURIComponent(q));
          if (!r.results.length) { out.classList.add('hidden'); return; }
          out.innerHTML = r.results.map(x => `<div class="search-hit" data-t="${x.type === 'alert' ? 'alerts' : x.type === 'device' ? 'devices' : 'shipments'}">${esc(x.label)} <small>${esc(x.sub)}</small></div>`).join('');
          out.classList.remove('hidden');
          out.querySelectorAll('.search-hit').forEach(h => h.onclick = () => { openTab(h.dataset.t); out.classList.add('hidden'); });
        } catch (_) {}
      }, 250);
    };
  }
  function tsHotkeys(e) {
    if (!$('#tracking-root') || !$('#tracking-root').offsetParent) return; // solo si la sección está visible
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#ts-search')?.focus(); }
    if (e.altKey && /^[1-9]$/.test(e.key)) { const tabs = Object.keys(TAB_DEFS); const t = tabs[(+e.key - 1) % tabs.length]; if (t) openTab(t); }
  }

  // ---------------- Registro en la navegación de IPHub ----------------
  function injectNav() {
    if ($('#nav-tracking')) return;
    const nav = document.querySelector('.sidebar-nav'); if (!nav) return;
    const a = document.createElement('a');
    a.href = '/tracking'; a.className = 'nav-item'; a.dataset.section = 'tracking'; a.id = 'nav-tracking';
    a.innerHTML = '<span class="nav-icon">&#9672;</span> Tracking Studio';
    const anchor = nav.querySelector('[data-section="topology"]');
    anchor ? anchor.after(a) : nav.append(a);
    a.addEventListener('click', ev => { ev.preventDefault(); if (typeof showSection === 'function') showSection('tracking'); });
  }
  function ensureSection() {
    if ($('#tracking')) return;
    const main = document.querySelector('.main'); if (!main) return;
    const sec = document.createElement('section');
    sec.id = 'tracking'; sec.className = 'section'; sec.setAttribute('data-no-i18n', '');
    sec.innerHTML = `<div class="section-header"><h2>Tracking Studio <span class="fn-tip" data-fn="tracking-studio" title="IDE de ingeniería logística: envíos, IoT, GIS, simulación, Virtual Lab Bridge.">!</span></h2>
      <p>Logistics Engineering IDE — proyectos, cadenas, sensores, telemetría, simulaciones pesadas y evidencia técnica.</p></div>
      <div id="tracking-root"><p class="muted">Cargando Tracking Studio…</p></div>`;
    const topo = $('#topology'); topo ? topo.after(sec) : main.append(sec);
  }
  // hook showSection
  const origShow = window.showSection;
  window.showSection = function (id) {
    if (origShow) origShow.apply(this, arguments);
    if (id === 'tracking') initTracking();
  };
  // parchar ROUTES para /tracking
  function patchRoutes() { if (typeof ROUTES !== 'undefined' && !ROUTES.tracking) ROUTES.tracking = 'tracking'; }

  // CSS del módulo
  function injectCss() {
    if ($('#ts-css')) return;
    const st = document.createElement('style'); st.id = 'ts-css';
    st.textContent = `
    .ts-bar{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.8rem;position:relative}
    .ts-brand{font-weight:800;color:#22d3ee}
    .ts-sel{max-width:280px}
    .ts-mode,.ts-bridge{font-size:.8rem;background:rgba(255,255,255,.05);padding:.25rem .6rem;border-radius:8px}
    .ts-tabs{display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.8rem}
    .ts-tab{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#cbd5e1;border-radius:8px 8px 0 0;padding:.3rem .7rem;font-size:.78rem;cursor:pointer;display:flex;gap:.4rem;align-items:center}
    .ts-tab.active{background:rgba(34,211,238,.15);border-color:#22d3ee;color:#e0f2fe}
    .ts-x{opacity:.5;font-size:.7rem}.ts-x:hover{opacity:1;color:#f87171}
    .ts-body{min-height:320px;padding:1rem}
    .ts-cols2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}@media(max-width:900px){.ts-cols2{grid-template-columns:1fr}}
    .ts-details{margin-bottom:.8rem}.ts-details summary{cursor:pointer;color:#7dd3fc;font-size:.85rem}
    .ts-lbl{font-size:.78rem;display:inline-flex;gap:.3rem;align-items:center}.ts-mini{font-size:.7rem}
    .ts-st{padding:.1rem .5rem;border-radius:6px;font-size:.72rem;background:rgba(255,255,255,.08)}
    .ts-st-delivered,.ts-st-online,.ts-st-active{color:#34d399}.ts-st-exception,.ts-st-fault,.ts-st-closed{color:#f87171}
    .ts-st-buffering{color:#fbbf24}.ts-st-in_transit,.ts-st-label_created{color:#7dd3fc}
    .ts-risk-high{color:#f87171}.ts-risk-medium{color:#fbbf24}.ts-risk-low{color:#34d399}
    .ts-hbar{display:grid;grid-template-columns:150px 1fr 40px;gap:.5rem;align-items:center;font-size:.78rem;margin:.25rem 0}
    .ts-bar-track{background:rgba(255,255,255,.07);border-radius:4px;height:10px}.ts-bar-track div{background:linear-gradient(90deg,#22d3ee,#818cf8);height:10px;border-radius:4px}
    .ts-timeline{display:flex;flex-direction:column;gap:.3rem;max-height:380px;overflow:auto}
    .ts-tl-full{max-height:520px}
    .ts-ev{display:flex;gap:.8rem;align-items:baseline;border-left:3px solid #22d3ee;padding:.25rem .6rem;background:rgba(255,255,255,.04);border-radius:0 8px 8px 0;font-size:.78rem}
    .ts-ev-telemetry{border-color:#818cf8}.ts-ev-geofence{border-color:#34d399}.ts-ev-alert{border-color:#fbbf24}.ts-ev-incident{border-color:#f87171}.ts-ev-snapshot{border-color:#e879f9}
    .ts-ev span{color:#94a3b8;font-size:.72rem}.ts-ev small{color:#64748b}
    .ts-mapwrap{position:relative;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.1)}
    #ts-gis{width:100%;height:auto;display:block;cursor:crosshair}
    .ts-maplegend{position:absolute;top:8px;right:8px;background:rgba(10,15,30,.8);padding:.3rem .6rem;border-radius:8px;font-size:.7rem}
    .ts-empty{text-align:center;padding:2rem}
    .ts-actions{white-space:nowrap}
    .ts-hop{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:.3rem .7rem;font-size:.8rem;display:flex;gap:.7rem;align-items:center;flex-wrap:wrap}
    .ts-hop small{color:#94a3b8}
    #ts-panel i{display:block;text-align:center;color:#22d3ee;font-style:normal;padding:.1rem}
    .ts-mapflow{display:flex;flex-direction:column;align-items:center;gap:.1rem;margin:.6rem 0}
    .ts-flow{background:rgba(34,211,238,.12);border:1px solid rgba(34,211,238,.4);padding:.25rem .8rem;border-radius:8px;font-size:.78rem}
    .ts-failbox{border-color:#f87171!important}
    .ts-ack{opacity:.55}
    .ts-hostsel{max-width:180px;font-size:.72rem}
    .mono{font-family:ui-monospace,Consolas,monospace}
    .search-hit{padding:.4rem .7rem;cursor:pointer}.search-hit:hover{background:rgba(34,211,238,.12)}
    .ts-sheet{margin-top:1rem}`;
    document.head.appendChild(st);
  }

  function boot() { injectCss(); ensureSection(); injectNav(); patchRoutes(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setInterval(() => { if (window.ME) { ensureSection(); injectNav(); patchRoutes(); } }, 1500);
})();
