/**
 * Tracking Studio — UI extra: Consignments, POD, e-Seal, Carriers,
 * Replay, Topology, AI, Webhooks, RBAC + GIS layers en mapa.
 */
(function () {
  'use strict';
  const API = '/api/tracking';

  function token() {
    try { return localStorage.getItem('iphub_token') || sessionStorage.getItem('iphub_token') || ''; } catch (_) { return ''; }
  }
  async function api(path, opts) {
    const h = { Authorization: 'Bearer ' + token() };
    if (opts && opts.body) h['Content-Type'] = 'application/json';
    const r = await fetch(API + path, Object.assign({ headers: h }, opts || {}));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function log(msg, level) {
    const el = document.getElementById('ts-console-log');
    if (!el) return;
    const line = document.createElement('div');
    line.className = 'ts-log-line ts-log-' + (level || 'info');
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
  function pid() {
    return window.TrackingStudio && window.TrackingStudio.state && window.TrackingStudio.state.activeProject
      ? window.TrackingStudio.state.activeProject.id : null;
  }
  function selectedShip() {
    return window.TrackingStudio && window.TrackingStudio.state && window.TrackingStudio.state.selectedShipment;
  }

  // ---------- GIS layers on map canvas ----------
  async function enhanceMap() {
    const canvas = document.getElementById('ts-map-canvas');
    if (!canvas || !pid()) return;
    try {
      const gis = await api('/projects/' + pid() + '/gis');
      const ctx = canvas.getContext('2d');
      // Draw geofences
      const fences = gis.geofences || [];
      const markers = gis.markers || [];
      // Use simple projection from existing map if possible - redraw circles
      // Approximate: assume map already drawn; overlay relative
      const w = canvas.width, h = canvas.height;
      // Collect bounds from markers
      const pts = markers.filter(m => m.lat != null);
      if (!pts.length && !fences.length) return;
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      for (const m of pts) {
        minLat = Math.min(minLat, m.lat); maxLat = Math.max(maxLat, m.lat);
        minLon = Math.min(minLon, m.lon); maxLon = Math.max(maxLon, m.lon);
        if (m.origin) { minLat = Math.min(minLat, m.origin.lat); maxLat = Math.max(maxLat, m.origin.lat); minLon = Math.min(minLon, m.origin.lon); maxLon = Math.max(maxLon, m.origin.lon); }
        if (m.destination) { minLat = Math.min(minLat, m.destination.lat); maxLat = Math.max(maxLat, m.destination.lat); minLon = Math.min(minLon, m.destination.lon); maxLon = Math.max(maxLon, m.destination.lon); }
      }
      for (const g of fences) {
        if (g.center) {
          minLat = Math.min(minLat, g.center.lat - 0.1); maxLat = Math.max(maxLat, g.center.lat + 0.1);
          minLon = Math.min(minLon, g.center.lon - 0.1); maxLon = Math.max(maxLon, g.center.lon + 0.1);
        }
      }
      if (minLat >= maxLat) { minLat -= 1; maxLat += 1; }
      if (minLon >= maxLon) { minLon -= 1; maxLon += 1; }
      const pad = 40;
      function proj(lat, lon) {
        return {
          x: pad + ((lon - minLon) / (maxLon - minLon || 1)) * (w - pad * 2),
          y: pad + ((maxLat - lat) / (maxLat - minLat || 1)) * (h - pad * 2),
        };
      }
      // geofence circles
      for (const g of fences) {
        if (!g.center || g.center.lat == null) continue;
        const c = proj(g.center.lat, g.center.lon);
        // radius approx: 1 deg lat ~ 111km
        const rPx = ((g.radiusKm || 5) / 111) / (maxLat - minLat || 1) * (h - pad * 2);
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(8, rPx), 0, Math.PI * 2);
        ctx.strokeStyle = g.type === 'Restricted' ? 'rgba(248,113,113,0.7)' : 'rgba(52,211,153,0.6)';
        ctx.fillStyle = g.type === 'Restricted' ? 'rgba(248,113,113,0.12)' : 'rgba(52,211,153,0.1)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px system-ui';
        ctx.fillText(g.name || 'GF', c.x + 4, c.y - 4);
      }
      // routes
      for (const r of (gis.routes || [])) {
        if (!r.origin || !r.destination) continue;
        const a = proj(r.origin.lat, r.origin.lon);
        const b = proj(r.destination.lat, r.destination.lon);
        ctx.strokeStyle = 'rgba(96,165,250,0.7)';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        if (r.waypoints && r.waypoints.length) {
          for (const wp of r.waypoints) {
            if (wp.lat != null) { const p = proj(wp.lat, wp.lon); ctx.lineTo(p.x, p.y); }
          }
        }
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } catch (_) {}
  }

  // ---------- Extra panel ----------
  async function renderExtra() {
    const el = document.getElementById('ts-extra-body');
    if (!el) return;
    const id = pid();
    if (!id) {
      el.innerHTML = '<div class="ts-empty">Abrí un proyecto</div>';
      return;
    }
    let cons = [], topo = { nodes: [], links: [] }, carriers = [], roles = { roles: [] };
    try {
      cons = (await api('/projects/' + id + '/consignments').catch(() => ({ consignments: [] }))).consignments || [];
      topo = await api('/projects/' + id + '/topology').catch(() => ({ nodes: [], links: [] }));
      carriers = (await api('/carriers').catch(() => ({ carriers: [] }))).carriers || [];
      roles = await api('/projects/' + id + '/roles').catch(() => ({ roles: [] }));
    } catch (e) { log(e.message, 'error'); }

    el.innerHTML =
      '<div class="ts-dash-toolbar"><span class="muted small">Extra · Consignments · POD · e-Seal · Carriers · Replay · Topology · AI · Webhooks · RBAC</span></div>' +
      '<div class="ts-insp-section"><h4>ENVÍO SELECCIONADO</h4>' +
      '<button type="button" class="btn btn-sm btn-primary" id="ex-pod">Registrar POD</button> ' +
      '<button type="button" class="btn btn-sm" id="ex-custody">Custody handoff</button> ' +
      '<button type="button" class="btn btn-sm" id="ex-eseal">Crear e-Seal</button> ' +
      '<button type="button" class="btn btn-sm" id="ex-tamper">Simular tamper</button> ' +
      '<button type="button" class="btn btn-sm" id="ex-label">Carrier label</button> ' +
      '<button type="button" class="btn btn-sm" id="ex-track">Carrier track</button> ' +
      '<button type="button" class="btn btn-sm btn-primary" id="ex-replay">Replay</button></div>' +
      '<div class="ts-insp-section"><h4>CONSIGNMENTS</h4>' +
      '<button type="button" class="btn btn-sm" id="ex-cons">+ Consignment</button>' +
      (cons.map(c => '<div class="ts-kv"><span>' + esc(c.reference) + '</span><b>' + esc(c.status) + ' · ' + (c.shipmentIds || []).length + ' ships</b></div>').join('') ||
        '<div class="ts-empty">Sin consignments</div>') +
      '</div>' +
      '<div class="ts-insp-section"><h4>TOPOLOGY</h4>' +
      '<button type="button" class="btn btn-sm btn-primary" id="ex-topo-seed">Seed topology</button> ' +
      '<span class="muted small">' + (topo.nodes || []).length + ' nodes · ' + (topo.links || []).length + ' links</span>' +
      '<div id="ex-topo-canvas-wrap"><canvas id="ex-topo-canvas" width="480" height="280" style="width:100%;background:#060b18;border-radius:8px;margin-top:8px"></canvas></div></div>' +
      '<div class="ts-insp-section"><h4>AI ASSISTANT</h4>' +
      '<div style="display:flex;gap:6px"><input id="ex-ai-q" class="input" style="flex:1" placeholder="¿Cuántos envíos? ¿Alertas? ¿Riesgo?" />' +
      '<button type="button" class="btn btn-sm btn-primary" id="ex-ai-send">Preguntar</button></div>' +
      '<div id="ex-ai-ans" class="muted small" style="margin-top:8px;min-height:2em"></div></div>' +
      '<div class="ts-insp-section"><h4>WEBHOOKS</h4>' +
      '<button type="button" class="btn btn-sm" id="ex-wh">+ Webhook test.site</button></div>' +
      '<div class="ts-insp-section"><h4>RBAC</h4>' +
      '<div class="muted small">Tu rol: <b>' + esc(roles.myRole || '—') + '</b></div>' +
      ((roles.roles || []).map(r => '<div class="ts-kv"><span>' + esc(r.userId) + '</span><b>' + esc(r.role) + '</b></div>').join('')) +
      '</div>' +
      '<div class="ts-insp-section"><h4>CARRIERS</h4>' +
      ((carriers || []).map(c => '<div class="ts-kv"><span>' + esc(c.code) + '</span><b>' + esc(c.name) + ' · ETA ~' + c.etaHours + 'h</b></div>').join('')) +
      '</div>' +
      '<div class="ts-insp-section"><h4>GIS MAP LAYERS</h4>' +
      '<button type="button" class="btn btn-sm" id="ex-gis-layers">Dibujar rutas/geofences en mapa</button></div>';

    bindExtra(id);
    drawTopology(topo);
  }

  function drawTopology(topo) {
    const canvas = document.getElementById('ex-topo-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#060b18';
    ctx.fillRect(0, 0, w, h);
    const nodes = topo.nodes || [];
    const links = topo.links || [];
    const byId = {};
    for (const n of nodes) byId[n.id] = n;
    // links
    ctx.strokeStyle = 'rgba(94,234,212,0.35)';
    ctx.lineWidth = 1.5;
    for (const l of links) {
      const a = byId[l.from], b = byId[l.to];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // nodes
    for (const n of nodes) {
      const colors = { network: '#60a5fa', gateway: '#fbbf24', host: '#34d399', device: '#f472b6' };
      ctx.fillStyle = colors[n.type] || '#94a3b8';
      ctx.beginPath();
      ctx.arc(n.x, n.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(n.name || n.type, n.x, n.y + 24);
    }
  }

  function bindExtra(id) {
    const on = (eid, fn) => { const el = document.getElementById(eid); if (el) el.addEventListener('click', fn); };
    on('ex-pod', async () => {
      const s = selectedShip();
      if (!s) return log('Seleccioná un envío', 'warn');
      const name = prompt('Nombre del receptor:', 'Receptor');
      if (!name) return;
      try {
        const r = await api('/shipments/' + s.id + '/pod', {
          method: 'POST',
          body: JSON.stringify({ recipientName: name, signature: 'signed:' + name, notes: 'POD via Tracking Studio' }),
        });
        log('POD registrado · ' + r.recipientName + ' · envío → DELIVERED');
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-custody', async () => {
      const s = selectedShip();
      if (!s) return log('Seleccioná un envío', 'warn');
      try {
        await api('/shipments/' + s.id + '/custody', {
          method: 'POST',
          body: JSON.stringify({ action: 'HANDOFF', fromParty: 'Warehouse', toParty: 'Carrier', notes: 'Handoff registrado' }),
        });
        log('Custody handoff OK');
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-eseal', async () => {
      const s = selectedShip();
      if (!s) return log('Seleccioná un envío', 'warn');
      try {
        const r = await api('/shipments/' + s.id + '/eseal', { method: 'POST', body: '{}' });
        log('e-Seal creado: ' + r.sealCode);
        window._lastEseal = r.id;
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-tamper', async () => {
      let sealId = window._lastEseal;
      if (!sealId) {
        const s = selectedShip();
        if (!s) return log('Creá un e-Seal primero', 'warn');
        const seals = await api('/shipments/' + s.id + '/eseal').catch(() => ({ seals: [] }));
        sealId = seals.seals && seals.seals[0] && seals.seals[0].id;
      }
      if (!sealId) return log('Sin e-Seal', 'warn');
      try {
        await api('/eseal/' + sealId + '/tamper', { method: 'POST', body: JSON.stringify({ note: 'Simulated breach' }) });
        log('e-Seal TAMPERED · alerta critical generada', 'warn');
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-label', async () => {
      const s = selectedShip();
      if (!s) return log('Seleccioná un envío', 'warn');
      const carrier = prompt('Carrier (UPS, DHL, FEDEX, CORREO, ANDREANI, SIM):', 'DHL');
      try {
        const r = await api('/shipments/' + s.id + '/carrier/label', {
          method: 'POST', body: JSON.stringify({ carrier: carrier || 'SIM' }),
        });
        log('Label: ' + r.trackingNumber + ' · ' + r.carrier);
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-track', async () => {
      const s = selectedShip();
      if (!s) return log('Seleccioná un envío', 'warn');
      try {
        const r = await api('/shipments/' + s.id + '/carrier/track', { method: 'POST', body: '{}' });
        log('Track ' + r.carrier + ': ' + r.status + ' · ' + (r.events || []).length + ' eventos');
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-replay', async () => {
      const s = selectedShip();
      if (!s) return log('Seleccioná un envío', 'warn');
      try {
        const r = await api('/shipments/' + s.id + '/replay', { method: 'POST', body: '{}' });
        log('Replay session: ' + r.totalFrames + ' frames · ' + Math.round((r.durationMs || 0) / 1000) + 's span');
        window._replay = r;
        playReplay(r);
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-cons', async () => {
      try {
        const s = selectedShip();
        const r = await api('/projects/' + id + '/consignments', {
          method: 'POST',
          body: JSON.stringify({
            reference: 'CONS-' + Date.now().toString(36).toUpperCase(),
            shipmentIds: s ? [s.id] : [],
            shipper: { name: 'Shipper Demo' },
            consignee: { name: 'Consignee Demo' },
          }),
        });
        log('Consignment: ' + r.reference);
        renderExtra();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-topo-seed', async () => {
      try {
        const r = await api('/projects/' + id + '/topology/seed', { method: 'POST', body: '{}' });
        log('Topology seeded: ' + r.nodes.length + ' nodes');
        drawTopology(r);
        renderExtra();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-ai-send', async () => {
      const input = document.getElementById('ex-ai-q');
      const ans = document.getElementById('ex-ai-ans');
      if (!input || !input.value.trim()) return;
      try {
        const r = await api('/projects/' + id + '/ai', {
          method: 'POST', body: JSON.stringify({ message: input.value }),
        });
        if (ans) ans.textContent = r.answer;
        log('AI: ' + r.answer.slice(0, 120));
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-wh', async () => {
      const url = prompt('Webhook URL:', 'https://httpbin.org/post');
      if (!url) return;
      try {
        const wh = await api('/projects/' + id + '/webhooks', {
          method: 'POST', body: JSON.stringify({ url, events: ['alert', 'status', 'test'] }),
        });
        log('Webhook creado: ' + wh.id.slice(0, 8));
        const d = await api('/webhooks/' + wh.id + '/test', { method: 'POST', body: '{}' });
        log('Test delivery: ' + (d.ok ? 'OK' : 'FAIL') + ' status=' + d.status + (d.error ? ' ' + d.error : ''));
      } catch (e) { log(e.message, 'error'); }
    });
    on('ex-gis-layers', () => {
      enhanceMap();
      log('Capas GIS (rutas/geofences) dibujadas en mapa');
      // switch to map view
      if (window.TrackingStudio && window.TrackingStudio.state) {
        window.TrackingStudio.state.view = 'map';
      }
      const mapPane = document.getElementById('ts-map-pane');
      if (mapPane) {
        document.querySelectorAll('#tracking .ts-pane').forEach(p => p.classList.add('hidden'));
        mapPane.classList.remove('hidden');
      }
      setTimeout(enhanceMap, 200);
    });
  }

  function playReplay(session) {
    const frames = session.frames || [];
    if (!frames.length) return log('Sin frames de telemetría', 'warn');
    let i = 0;
    log('Replay start · ' + frames.length + ' frames');
    const iv = setInterval(() => {
      if (i >= frames.length) {
        clearInterval(iv);
        log('Replay fin');
        return;
      }
      const f = frames[i];
      if (i % 5 === 0 || i === frames.length - 1) {
        log('Replay [' + i + '/' + frames.length + '] ' +
          (f.lat != null ? f.lat.toFixed(4) + ',' + f.lon.toFixed(4) : '') +
          (f.temperature != null ? ' T=' + f.temperature : '') +
          (f.battery != null ? ' Bat=' + f.battery : ''));
      }
      i++;
    }, 200);
  }

  // Patch shell
  function tryPatch() {
    const section = document.getElementById('tracking');
    if (!section || !section.dataset.tsReady) return false;
    const toolbar = section.querySelector('.ts-toolbar-actions');
    if (toolbar && !document.getElementById('ts-btn-extra-view')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-primary';
      btn.id = 'ts-btn-extra-view';
      btn.textContent = 'Extra';
      toolbar.appendChild(btn);
      btn.addEventListener('click', () => {
        section.querySelectorAll('.ts-pane').forEach(p => p.classList.add('hidden'));
        let pane = document.getElementById('ts-extra-pane');
        if (!pane) {
          const main = section.querySelector('.ts-main');
          pane = document.createElement('div');
          pane.id = 'ts-extra-pane';
          pane.className = 'ts-pane';
          pane.innerHTML = '<div id="ts-extra-body"></div>';
          main.appendChild(pane);
        }
        pane.classList.remove('hidden');
        renderExtra();
      });
    }
    return true;
  }

  const iv = setInterval(() => { if (tryPatch()) clearInterval(iv); }, 500);
  setTimeout(() => clearInterval(iv), 15000);
  document.addEventListener('iphub:section', (e) => {
    if (e.detail === 'tracking') setTimeout(tryPatch, 400);
  });
  window.TrackingExtra = { render: renderExtra, enhanceMap: enhanceMap };
})();
