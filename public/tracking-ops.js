/**
 * Tracking Studio — UI ops: Bridge VL, GIS, Sim/Snapshots, Incidentes/Reportes
 * Extiende window.TrackingStudio cuando está disponible.
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
    if (window.TrackingStudio && window.TrackingStudio.state) {
      const el = document.getElementById('ts-console-log');
      if (!el) return;
      const line = document.createElement('div');
      line.className = 'ts-log-line ts-log-' + (level || 'info');
      line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
  }
  function projectId() {
    return window.TrackingStudio && window.TrackingStudio.state && window.TrackingStudio.state.activeProject
      ? window.TrackingStudio.state.activeProject.id : null;
  }

  async function renderOps() {
    const el = document.getElementById('ts-ops-body');
    if (!el) return;
    const pid = projectId();
    if (!pid) {
      el.innerHTML = '<div class="ts-empty">Abrí un proyecto primero</div>';
      return;
    }
    let bridge = {}, routes = [], fences = [], snaps = [], sims = [], incidents = [], reports = [];
    try {
      bridge = await api('/bridge/status').catch(() => ({ status: 'DISCONNECTED' }));
      routes = (await api('/projects/' + pid + '/routes').catch(() => ({ routes: [] }))).routes || [];
      fences = (await api('/projects/' + pid + '/geofences').catch(() => ({ geofences: [] }))).geofences || [];
      snaps = (await api('/projects/' + pid + '/snapshots').catch(() => ({ snapshots: [] }))).snapshots || [];
      sims = (await api('/projects/' + pid + '/simulations').catch(() => ({ runs: [] }))).runs || [];
      incidents = (await api('/projects/' + pid + '/incidents').catch(() => ({ incidents: [] }))).incidents || [];
      reports = (await api('/projects/' + pid + '/reports').catch(() => ({ reports: [] }))).reports || [];
    } catch (e) {
      log('Ops load: ' + e.message, 'error');
    }

    el.innerHTML =
      '<div class="ts-res-grid">' +
      '<div class="ts-res-card"><h4>BRIDGE VL</h4><div class="ts-res-val" style="font-size:1rem">' + esc(bridge.status || '—') + '</div>' +
      '<div class="muted small">' + esc(bridge.transport || '') + (bridge.latencyMs != null ? ' · ' + Number(bridge.latencyMs).toFixed(1) + 'ms' : '') + '</div></div>' +
      '<div class="ts-res-card"><h4>ROUTES</h4><div class="ts-res-val">' + routes.length + '</div></div>' +
      '<div class="ts-res-card"><h4>GEOFENCES</h4><div class="ts-res-val">' + fences.length + '</div></div>' +
      '<div class="ts-res-card"><h4>SNAPSHOTS</h4><div class="ts-res-val">' + snaps.length + '</div></div>' +
      '<div class="ts-res-card"><h4>INCIDENTES</h4><div class="ts-res-val">' + incidents.length + '</div></div>' +
      '<div class="ts-res-card"><h4>REPORTES</h4><div class="ts-res-val">' + reports.length + '</div></div>' +
      '</div>' +
      '<div class="ts-dash-toolbar"><span class="muted small">Ops · Bridge / GIS / Sim / Incidents</span></div>' +
      '<div class="ts-insp-section"><h4>VIRTUAL LAB BRIDGE</h4>' +
      '<button type="button" class="btn btn-sm btn-primary" id="ops-bridge-connect">Connect MOCK</button> ' +
      '<button type="button" class="btn btn-sm" id="ops-bridge-disconnect">Disconnect</button> ' +
      '<button type="button" class="btn btn-sm" id="ops-bridge-fail">Simulate GW fail</button> ' +
      '<button type="button" class="btn btn-sm" id="ops-bridge-restore">Restore</button></div>' +
      '<div class="ts-insp-section"><h4>GIS</h4>' +
      '<button type="button" class="btn btn-sm btn-primary" id="ops-route-create">+ Ruta demo</button> ' +
      '<button type="button" class="btn btn-sm" id="ops-gf-create">+ Geofence 5km</button> ' +
      '<button type="button" class="btn btn-sm" id="ops-gf-check">Check geofences</button></div>' +
      '<div class="ts-insp-section"><h4>SIM / SNAPSHOTS</h4>' +
      '<button type="button" class="btn btn-sm btn-primary" id="ops-sim">Simular 10 envíos</button> ' +
      '<button type="button" class="btn btn-sm" id="ops-stress">Stress 1k</button> ' +
      '<button type="button" class="btn btn-sm" id="ops-snap">Crear snapshot</button></div>' +
      '<div class="ts-insp-section"><h4>INCIDENTES / REPORTES / CODE</h4>' +
      '<button type="button" class="btn btn-sm btn-primary" id="ops-inc-alerts">Incident desde alertas</button> ' +
      '<button type="button" class="btn btn-sm" id="ops-report">Generar reporte</button> ' +
      '<button type="button" class="btn btn-sm" id="ops-codescan">Code scan</button></div>' +
      '<div class="ts-insp-section"><h4>SNAPSHOTS</h4>' +
      (snaps.map(s => '<div class="ts-kv"><span>' + esc(s.name) + '</span><b>' + s.shipmentCount + ' ships · ' +
        '<button type="button" class="btn btn-sm" data-restore="' + s.id + '">Restore</button></b></div>').join('') ||
        '<div class="ts-empty">Sin snapshots</div>') +
      '</div>' +
      '<div class="ts-insp-section"><h4>INCIDENTES</h4>' +
      (incidents.slice(0, 8).map(i =>
        '<div class="ts-kv"><span>' + esc(i.title) + '</span><b>' + esc(i.status) + ' · ' + esc(i.severity) + '</b></div>'
      ).join('') || '<div class="ts-empty">Sin incidentes</div>') +
      '</div>' +
      '<div class="ts-insp-section"><h4>ÚLTIMAS SIMULACIONES</h4>' +
      (sims.slice(0, 5).map(r =>
        '<div class="ts-kv"><span>' + esc(r.name) + '</span><b>' + esc(r.type) + ' · ' +
        ((r.result && r.result.eventsPerSec) || 0) + ' evt/s</b></div>'
      ).join('') || '<div class="ts-empty">—</div>') +
      '</div>';

    bind(pid);
  }

  function bind(pid) {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('ops-bridge-connect', async () => {
      try {
        const r = await api('/bridge/connect', { method: 'POST', body: JSON.stringify({ transport: 'MOCK' }) });
        log('Bridge CONNECTED · ' + r.transport + ' · hosts ' + r.virtualHosts);
        renderOps();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ops-bridge-disconnect', async () => {
      try { await api('/bridge/disconnect', { method: 'POST', body: '{}' }); log('Bridge DISCONNECTED'); renderOps(); }
      catch (e) { log(e.message, 'error'); }
    });
    on('ops-bridge-fail', async () => {
      try {
        const r = await api('/bridge/simulate-failure', { method: 'POST', body: JSON.stringify({ target: 'gateway' }) });
        log('Failure: ' + (r.effects || []).join('; '), 'warn');
        renderOps();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ops-bridge-restore', async () => {
      try { await api('/bridge/simulate-restore', { method: 'POST', body: '{}' }); log('Bridge restored'); renderOps(); }
      catch (e) { log(e.message, 'error'); }
    });
    on('ops-route-create', async () => {
      try {
        const r = await api('/projects/' + pid + '/routes', {
          method: 'POST',
          body: JSON.stringify({
            name: 'BA → Santiago Road',
            mode: 'Road',
            origin: { name: 'Buenos Aires', lat: -34.6037, lon: -58.3816 },
            destination: { name: 'Santiago', lat: -33.4489, lon: -70.6693 },
            carrier: 'DemoCarrier',
          }),
        });
        log('Ruta creada: ' + r.name + ' · ' + r.distanceKm + ' km');
        renderOps();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ops-gf-create', async () => {
      try {
        const g = await api('/projects/' + pid + '/geofences', {
          method: 'POST',
          body: JSON.stringify({
            name: 'BA Hub 5km',
            type: 'Circle',
            center: { lat: -34.6037, lon: -58.3816 },
            radiusKm: 5,
          }),
        });
        log('Geofence: ' + g.name);
        renderOps();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ops-gf-check', async () => {
      const st = window.TrackingStudio && window.TrackingStudio.state;
      if (!st || !st.selectedShipment) return log('Seleccioná un envío', 'warn');
      try {
        const r = await api('/shipments/' + st.selectedShipment.id + '/check-geofences', { method: 'POST', body: '{}' });
        log('Geofence check: ' + r.events.length + ' eventos · ' + r.checked + ' fences');
      } catch (e) { log(e.message, 'error'); }
    });
    on('ops-sim', async () => {
      try {
        const r = await api('/projects/' + pid + '/simulate', {
          method: 'POST',
          body: JSON.stringify({ shipmentCount: 10, telemetryPerShip: 5, name: 'Demo sim' }),
        });
        log('Sim OK · ' + r.result.telemetry + ' tele · ' + r.result.eventsPerSec + ' evt/s');
        if (window.TrackingStudio && window.TrackingStudio.refresh) window.TrackingStudio.refresh();
        renderOps();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ops-stress', async () => {
      try {
        const r = await api('/projects/' + pid + '/stress', {
          method: 'POST',
          body: JSON.stringify({ profile: '1k' }),
        });
        log('Stress OK · ' + (r.result && r.result.telemetry) + ' tele · ' + (r.result && r.result.durationMs) + 'ms');
        renderOps();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ops-snap', async () => {
      try {
        const r = await api('/projects/' + pid + '/snapshots', {
          method: 'POST',
          body: JSON.stringify({ name: 'Snap ' + new Date().toISOString().slice(0, 16) }),
        });
        log('Snapshot: ' + r.name + ' · ' + r.shipmentCount + ' ships');
        renderOps();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ops-inc-alerts', async () => {
      try {
        const r = await api('/projects/' + pid + '/incidents/from-alerts', { method: 'POST', body: '{}' });
        if (r.created === null) log(r.message || 'Sin alertas críticas', 'warn');
        else log('Incidente: ' + r.title);
        renderOps();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ops-report', async () => {
      try {
        const r = await api('/projects/' + pid + '/reports', {
          method: 'POST',
          body: JSON.stringify({ type: 'executive', title: 'Executive report' }),
        });
        log('Reporte: ' + r.title + ' · OTIF ' + (r.summary && r.summary.otifProxy) + '%');
        renderOps();
      } catch (e) { log(e.message, 'error'); }
    });
    on('ops-codescan', async () => {
      try {
        const r = await api('/projects/' + pid + '/code-scan', { method: 'POST', body: '{}' });
        log('Code scan: ' + r.count + ' findings');
      } catch (e) { log(e.message, 'error'); }
    });
    document.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Restaurar snapshot? Reemplaza envíos/devices del proyecto.')) return;
        try {
          const r = await api('/snapshots/' + btn.getAttribute('data-restore') + '/restore', { method: 'POST', body: '{}' });
          log('Restore OK · ' + JSON.stringify(r.restored));
          if (window.TrackingStudio && window.TrackingStudio.refresh) window.TrackingStudio.refresh();
          renderOps();
        } catch (e) { log(e.message, 'error'); }
      });
    });
  }

  // Patch into Tracking Studio shell when ready
  function tryPatch() {
    const section = document.getElementById('tracking');
    if (!section || !section.dataset.tsReady) return false;
    // Add Ops button if missing
    const toolbar = section.querySelector('.ts-toolbar-actions');
    if (toolbar && !document.getElementById('ts-btn-ops-view')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-primary';
      btn.id = 'ts-btn-ops-view';
      btn.setAttribute('data-ts-view', 'ops');
      btn.textContent = 'Ops';
      toolbar.appendChild(btn);
      btn.addEventListener('click', () => {
        if (window.TrackingStudio && window.TrackingStudio.state) {
          window.TrackingStudio.state.view = 'ops';
        }
        // show pane
        section.querySelectorAll('.ts-pane').forEach(p => p.classList.add('hidden'));
        let pane = document.getElementById('ts-ops-pane');
        if (!pane) {
          const main = section.querySelector('.ts-main');
          pane = document.createElement('div');
          pane.id = 'ts-ops-pane';
          pane.className = 'ts-pane';
          pane.innerHTML = '<div id="ts-ops-body"></div>';
          main.appendChild(pane);
        }
        pane.classList.remove('hidden');
        renderOps();
      });
    }
    return true;
  }

  const iv = setInterval(() => { if (tryPatch()) clearInterval(iv); }, 500);
  setTimeout(() => clearInterval(iv), 15000);
  document.addEventListener('iphub:section', (e) => {
    if (e.detail === 'tracking') setTimeout(tryPatch, 300);
  });
  window.TrackingOps = { render: renderOps };
})();
