/**
 * Tracking Studio — Fase 1 + 2 + 3
 * Shell IDE + telemetría/workers + analítica predictiva + alertas.
 */
(function () {
  'use strict';

  const API = '/api/tracking';
  let state = {
    projects: [],
    activeProject: null,
    shipments: [],
    selectedShipment: null,
    events: [],
    telemetry: [],
    devices: [],
    alerts: [],
    alertRules: [],
    alertGroups: [],
    smartSummary: null,
    analytics: null,
    projectAnalytics: null,
    dashboard: null,
    predictive: null,
    stats: null,
    mode: 'SIMULATED',
    view: 'map', // map | list | events | devices | resources | alerts | analytics | dashboard | rules | smart | predictive
    workerStats: { generated: 0, batches: 0, dropped: 0, eps: 0, workers: 0 },
  };

  // ---------- Web Worker pool (browser) ----------
  const workerPool = {
    workers: new Map(),
    queue: [],
    maxQueue: 10000,
    totals: { generated: 0, pushed: 0, dropped: 0, batches: 0, errors: 0 },
    _rate: [],
    _flushT: null,
    _eps() {
      const now = Date.now();
      this._rate = this._rate.filter(t => now - t < 1000);
      return this._rate.length;
    },
    start(id, config) {
      this.stop(id);
      const w = new Worker('/tracking-worker.js');
      const entry = { worker: w, config: config || {}, stats: {} };
      w.onmessage = (e) => this._onMsg(id, e.data);
      w.onerror = (err) => {
        this.totals.errors++;
        logConsole('Worker error: ' + (err.message || err), 'error');
      };
      this.workers.set(id, entry);
      w.postMessage({ type: 'start', config: config || {} });
      this._ensureFlush();
      this._refreshUi();
      return id;
    },
    stop(id) {
      const e = this.workers.get(id);
      if (!e) return;
      try { e.worker.postMessage({ type: 'stop' }); e.worker.terminate(); } catch (_) {}
      this.workers.delete(id);
      this._refreshUi();
    },
    stopAll() {
      for (const id of [...this.workers.keys()]) this.stop(id);
      this.queue = [];
    },
    _onMsg(id, msg) {
      const e = this.workers.get(id);
      if (!e || !msg) return;
      if (msg.type === 'batch' && Array.isArray(msg.readings)) {
        e.stats = msg.stats || {};
        this.totals.generated += msg.readings.length;
        this.totals.batches++;
        for (let i = 0; i < msg.readings.length; i++) this._rate.push(Date.now());
        if (this.queue.length + msg.readings.length > this.maxQueue) {
          const drop = this.queue.length + msg.readings.length - this.maxQueue;
          this.queue.splice(0, drop);
          this.totals.dropped += drop;
        }
        this.queue.push(...msg.readings);
        state.workerStats = {
          generated: this.totals.generated,
          batches: this.totals.batches,
          dropped: this.totals.dropped,
          eps: this._eps(),
          workers: this.workers.size,
          queue: this.queue.length,
        };
        this._refreshUi();
      } else if (msg.type === 'started') {
        logConsole('Worker ' + id + ' iniciado · interval ' + (msg.cfg && msg.cfg.intervalMs) + 'ms');
      } else if (msg.type === 'stopped') {
        logConsole('Worker ' + id + ' detenido · generados ' + ((msg.stats && msg.stats.generated) || 0));
      }
    },
    _ensureFlush() {
      if (this._flushT) return;
      this._flushT = setInterval(() => this._flush(), 500);
    },
    async _flush() {
      if (!this.queue.length) return;
      const byShip = new Map();
      const take = this.queue.splice(0, 1500);
      for (const r of take) {
        if (!r.shipmentId) { this.totals.dropped++; continue; }
        if (!byShip.has(r.shipmentId)) byShip.set(r.shipmentId, []);
        byShip.get(r.shipmentId).push(r);
      }
      for (const [sid, readings] of byShip) {
        try {
          await api('/shipments/' + sid + '/telemetry', {
            method: 'POST',
            body: JSON.stringify({ readings }),
          });
          this.totals.pushed += readings.length;
        } catch (err) {
          this.totals.errors++;
          if (this.queue.length < this.maxQueue) this.queue.unshift(...readings.slice(0, 200));
          else this.totals.dropped += readings.length;
          logConsole('Push telemetría falló: ' + err.message, 'error');
        }
      }
      state.workerStats = {
        generated: this.totals.generated,
        batches: this.totals.batches,
        dropped: this.totals.dropped,
        pushed: this.totals.pushed,
        eps: this._eps(),
        workers: this.workers.size,
        queue: this.queue.length,
      };
      this._refreshUi();
    },
    _refreshUi() {
      try { renderResources(); } catch (_) {}
    },
  };

  function token() {
    try { return localStorage.getItem('iphub_token') || sessionStorage.getItem('iphub_token') || ''; } catch (_) { return ''; }
  }
  function headers(json) {
    const h = { Authorization: 'Bearer ' + token() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  async function api(path, opts) {
    const r = await fetch(API + path, Object.assign({ headers: headers(!!(opts && opts.body)) }, opts || {}));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }
  function logConsole(msg, level) {
    const el = document.getElementById('ts-console-log');
    if (!el) return;
    const line = document.createElement('div');
    line.className = 'ts-log-line ts-log-' + (level || 'info');
    const t = new Date().toLocaleTimeString();
    line.textContent = '[' + t + '] ' + msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 200) el.removeChild(el.firstChild);
  }
  function modeBadge(m) {
    const map = { REAL: 'ts-mode-real', SIMULATED: 'ts-mode-sim', REPLAY: 'ts-mode-replay', HYBRID: 'ts-mode-hybrid' };
    return '<span class="ts-mode-badge ' + (map[m] || 'ts-mode-sim') + '">' + (m || 'SIMULATED') + '</span>';
  }
  function statusClass(st) {
    if (st === 'DELIVERED') return 'ts-st-ok';
    if (st === 'EXCEPTION' || st === 'RETURNED' || st === 'CANCELLED') return 'ts-st-bad';
    if (st === 'IN_TRANSIT' || st === 'OUT_FOR_DELIVERY') return 'ts-st-run';
    return 'ts-st-idle';
  }

  // ---------- Load ----------
  async function loadProjects() {
    try {
      const data = await api('/projects');
      state.projects = data.projects || [];
      renderExplorer();
      if (!state.activeProject && state.projects.length) {
        await selectProject(state.projects[0].id);
      } else if (state.activeProject) {
        const still = state.projects.find(p => p.id === state.activeProject.id);
        if (!still) { state.activeProject = null; renderWorkspace(); }
      }
      logConsole('Proyectos cargados: ' + state.projects.length);
    } catch (e) {
      logConsole('Error cargando proyectos: ' + e.message, 'error');
    }
  }

  async function selectProject(id) {
    try {
      const p = await api('/projects/' + id);
      state.activeProject = p;
      state.mode = p.mode || 'SIMULATED';
      state.selectedShipment = null;
      state.events = [];
      state.telemetry = [];
      state.analytics = null;
      const [ships, stats, devices, alerts, pa, dash, rules, smart, pred] = await Promise.all([
        api('/projects/' + id + '/shipments'),
        api('/projects/' + id + '/stats'),
        api('/projects/' + id + '/devices').catch(() => ({ devices: [] })),
        api('/projects/' + id + '/alerts').catch(() => ({ alerts: [] })),
        api('/projects/' + id + '/analytics/summary').catch(() => null),
        api('/projects/' + id + '/analytics/dashboard').catch(() => null),
        api('/projects/' + id + '/alert-rules').catch(() => ({ rules: [] })),
        api('/projects/' + id + '/alerts/intelligent').catch(() => null),
        api('/projects/' + id + '/analytics/predictive').catch(() => null),
      ]);
      state.shipments = ships.shipments || [];
      state.stats = stats;
      state.devices = devices.devices || [];
      state.alerts = alerts.alerts || [];
      state.projectAnalytics = pa;
      state.dashboard = dash;
      state.predictive = pred;
      state.alertRules = rules.rules || [];
      if (smart) {
        state.alertGroups = smart.groups || [];
        state.smartSummary = smart.summary || null;
        const ids = new Set(state.alerts.map(a => a.id));
        for (const a of (smart.alerts || [])) {
          if (!ids.has(a.id)) state.alerts.push(a);
        }
      }
      renderExplorer();
      renderWorkspace();
      renderInspector();
      updateModeIndicator();
      const openA = state.alerts.filter(a => a.status === 'open').length;
      logConsole('Proyecto activo: ' + p.name + ' · ' + state.shipments.length + ' envíos · ' + openA + ' alertas abiertas');
    } catch (e) {
      logConsole('Error abriendo proyecto: ' + e.message, 'error');
    }
  }

  async function selectShipment(id) {
    try {
      const s = await api('/shipments/' + id);
      state.selectedShipment = s;
      const [ev, te, an, al] = await Promise.all([
        api('/shipments/' + id + '/events?limit=200'),
        api('/shipments/' + id + '/telemetry?limit=200'),
        api('/shipments/' + id + '/analytics').catch(() => null),
        api('/shipments/' + id + '/alerts').catch(() => ({ alerts: [] })),
      ]);
      state.events = ev.events || [];
      state.telemetry = te.telemetry || [];
      state.analytics = an;
      // merge shipment alerts into view while keeping project list
      if (al.alerts) {
        const others = state.alerts.filter(a => a.shipmentId !== id);
        state.alerts = others.concat(al.alerts);
      }
      renderWorkspace();
      renderInspector();
      const risk = an && an.risk ? an.risk.score : '—';
      logConsole('Envío ' + s.trackingNumber + ' · risk ' + risk + ' · ' + state.events.length + ' eventos · ' + state.telemetry.length + ' lecturas');
    } catch (e) {
      logConsole('Error cargando envío: ' + e.message, 'error');
    }
  }

  async function evaluateSelected() {
    if (!state.selectedShipment) return alert('Seleccioná un envío');
    try {
      const r = await api('/shipments/' + state.selectedShipment.id + '/evaluate', { method: 'POST', body: '{}' });
      logConsole('Evaluación: ' + (r.alerts || []).length + ' alertas nuevas · risk ' + (r.risk && r.risk.score));
      await selectShipment(state.selectedShipment.id);
      if (state.activeProject) {
        const al = await api('/projects/' + state.activeProject.id + '/alerts').catch(() => ({ alerts: [] }));
        state.alerts = al.alerts || [];
        state.projectAnalytics = await api('/projects/' + state.activeProject.id + '/analytics/summary').catch(() => null);
      }
      state.view = 'alerts';
      renderWorkspace();
    } catch (e) {
      logConsole('Error evaluación: ' + e.message, 'error');
    }
  }

  async function ackAlert(id, status) {
    try {
      await api('/alerts/' + id, { method: 'PATCH', body: JSON.stringify({ status: status || 'acknowledged' }) });
      logConsole('Alerta ' + id.slice(0, 8) + ' → ' + (status || 'acknowledged'));
      if (state.activeProject) {
        const al = await api('/projects/' + state.activeProject.id + '/alerts');
        state.alerts = al.alerts || [];
        const smart = await api('/projects/' + state.activeProject.id + '/alerts/intelligent').catch(() => null);
        if (smart) {
          state.alertGroups = smart.groups || [];
          state.smartSummary = smart.summary || null;
        }
        renderWorkspace();
      }
    } catch (e) {
      logConsole('Error alerta: ' + e.message, 'error');
    }
  }

  async function evaluateSmartSelected() {
    if (!state.selectedShipment) return alert('Seleccioná un envío');
    try {
      const r = await api('/shipments/' + state.selectedShipment.id + '/evaluate-smart', { method: 'POST', body: '{}' });
      logConsole('Smart evaluate: ' + (r.alerts || []).length + ' nuevas · ' + (r.groups || []).length + ' grupos · ' + (r.escalated || []).length + ' escaladas');
      if (r.firedConditions && r.firedConditions.length) logConsole('Condiciones: ' + r.firedConditions.join(', '));
      await selectProject(state.activeProject.id);
      state.view = 'smart';
      renderWorkspace();
    } catch (e) {
      logConsole('Error smart evaluate: ' + e.message, 'error');
    }
  }

  async function evaluateSmartProject() {
    if (!state.activeProject) return;
    try {
      const r = await api('/projects/' + state.activeProject.id + '/evaluate-smart', { method: 'POST', body: '{}' });
      logConsole('Smart project: ' + r.shipmentsEvaluated + ' envíos · ' + r.newAlerts + ' alertas · ' + r.groups + ' grupos');
      await selectProject(state.activeProject.id);
      state.view = 'smart';
      renderWorkspace();
    } catch (e) {
      logConsole('Error: ' + e.message, 'error');
    }
  }

  async function toggleRule(id, enabled) {
    try {
      await api('/alert-rules/' + id, { method: 'PUT', body: JSON.stringify({ enabled: !!enabled }) });
      logConsole('Regla ' + id.slice(0, 8) + ' → ' + (enabled ? 'ON' : 'OFF'));
      if (state.activeProject) {
        const rules = await api('/projects/' + state.activeProject.id + '/alert-rules');
        state.alertRules = rules.rules || [];
        renderWorkspace();
      }
    } catch (e) {
      logConsole('Error regla: ' + e.message, 'error');
    }
  }

  async function addCustomRule() {
    if (!state.activeProject) return;
    const name = prompt('Nombre de la regla:', 'Custom risk');
    if (!name) return;
    const condition = prompt('Condición (RISK_ABOVE, BATTERY_BELOW, TEMP_OUT_OF_RANGE, IMPACT_ABOVE, NO_TELEMETRY_MINUTES, ...):', 'RISK_ABOVE');
    const threshold = prompt('Umbral (número, vacío si no aplica):', '50');
    try {
      await api('/projects/' + state.activeProject.id + '/alert-rules', {
        method: 'POST',
        body: JSON.stringify({
          name,
          condition: condition || 'RISK_ABOVE',
          threshold: threshold === '' ? null : Number(threshold),
          severity: 'medium',
          cooldownMinutes: 15,
          escalateAfterMinutes: 30,
          escalateTo: 'high',
        }),
      });
      logConsole('Regla creada: ' + name);
      const rules = await api('/projects/' + state.activeProject.id + '/alert-rules');
      state.alertRules = rules.rules || [];
      state.view = 'rules';
      renderWorkspace();
    } catch (e) {
      logConsole('Error creando regla: ' + e.message, 'error');
    }
  }

  // ---------- Create ----------
  async function createProject() {
    const name = prompt('Nombre del proyecto de Tracking Studio:', 'European Cold Chain 2026');
    if (!name) return;
    try {
      const p = await api('/projects', {
        method: 'POST',
        body: JSON.stringify({ name, mode: 'SIMULATED', description: '' }),
      });
      logConsole('Proyecto creado: ' + p.name);
      await loadProjects();
      await selectProject(p.id);
    } catch (e) {
      logConsole('Error creando proyecto: ' + e.message, 'error');
      alert(e.message);
    }
  }

  async function createShipment() {
    if (!state.activeProject) return alert('Seleccioná un proyecto primero');
    const tn = prompt('Tracking number (vacío = auto):', '');
    const originLat = -34.6037, originLon = -58.3816;
    const destLat = -33.4489, destLon = -70.6693;
    try {
      const data = await api('/projects/' + state.activeProject.id + '/shipments', {
        method: 'POST',
        body: JSON.stringify({
          trackingNumber: tn || undefined,
          origin: { name: 'Buenos Aires Hub', lat: originLat, lon: originLon },
          destination: { name: 'Santiago Hub', lat: destLat, lon: destLon },
          currentLocation: { name: 'Buenos Aires Hub', lat: originLat, lon: originLon },
          carrier: 'DemoCarrier',
          serviceLevel: 'express',
          priority: 'high',
          weight: 12.5,
          temperatureRequired: { min: 2, max: 8, target: 5 },
          mode: state.activeProject.mode || 'SIMULATED',
        }),
      });
      logConsole('Envío creado: ' + data.shipment.trackingNumber);
      await selectProject(state.activeProject.id);
      await selectShipment(data.shipment.id);
    } catch (e) {
      logConsole('Error creando envío: ' + e.message, 'error');
      alert(e.message);
    }
  }

  async function addTelemetrySample() {
    if (!state.selectedShipment) return alert('Seleccioná un envío');
    const s = state.selectedShipment;
    const loc = s.currentLocation || s.origin || { lat: -34.6, lon: -58.4 };
    const lat = Number(loc.lat) + (Math.random() - 0.5) * 0.05;
    const lon = Number(loc.lon) + (Math.random() - 0.5) * 0.05;
    try {
      await api('/shipments/' + s.id + '/telemetry', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: 'tracker-demo-001',
          gps: { lat, lon, altitude: 50, speed: 60 + Math.random() * 20 },
          temperature: 4 + Math.random() * 2,
          humidity: 55 + Math.random() * 10,
          light: 0,
          impactG: 0.1 + Math.random() * 0.3,
          battery: 80 + Math.random() * 15,
          signal: -70 - Math.random() * 15,
          source: 'SIMULATED',
        }),
      });
      logConsole('Telemetría inyectada → ' + lat.toFixed(4) + ', ' + lon.toFixed(4));
      await selectShipment(s.id);
    } catch (e) {
      logConsole('Error telemetría: ' + e.message, 'error');
    }
  }

  async function advanceStatus() {
    if (!state.selectedShipment) return;
    const order = ['LABEL_CREATED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_FACILITY', 'OUT_FOR_DELIVERY', 'DELIVERED'];
    const cur = state.selectedShipment.status;
    const i = order.indexOf(cur);
    const next = order[Math.min(i + 1, order.length - 1)];
    if (next === cur) return logConsole('Ya está en estado final', 'warn');
    try {
      await api('/shipments/' + state.selectedShipment.id, {
        method: 'PUT',
        body: JSON.stringify({ status: next, source: 'MANUAL' }),
      });
      logConsole('Estado → ' + next);
      await selectShipment(state.selectedShipment.id);
      if (state.activeProject) await selectProject(state.activeProject.id);
    } catch (e) {
      logConsole('Error estado: ' + e.message, 'error');
    }
  }

  async function createDevice() {
    if (!state.activeProject) return alert('Seleccioná un proyecto');
    const name = prompt('Nombre del dispositivo IoT:', 'Tracker GPS-001');
    if (!name) return;
    try {
      const d = await api('/projects/' + state.activeProject.id + '/devices', {
        method: 'POST',
        body: JSON.stringify({
          name,
          type: 'MULTI',
          shipmentId: state.selectedShipment ? state.selectedShipment.id : null,
          sensorConfig: {
            intervalMs: 1000,
            noise: 0.03,
            pattern: 'route',
            batteryDrainPerHour: 0.5,
            baseTemp: 5,
            failureRate: 0,
          },
        }),
      });
      logConsole('Dispositivo creado: ' + d.name + ' · ' + d.imei);
      await selectProject(state.activeProject.id);
      state.view = 'devices';
      renderWorkspace();
    } catch (e) {
      logConsole('Error dispositivo: ' + e.message, 'error');
      alert(e.message);
    }
  }

  function startWorkerForSelection() {
    if (!state.selectedShipment) return alert('Seleccioná un envío para asociar el worker');
    const s = state.selectedShipment;
    const origin = s.origin || { lat: -34.6037, lon: -58.3816 };
    const dest = s.destination || { lat: -33.4489, lon: -70.6693 };
    const device = state.devices.find(d => d.shipmentId === s.id) || state.devices[0];
    const sc = (device && device.sensorConfig) || {};
    const id = 'w-' + (device ? device.id.slice(0, 8) : s.id.slice(0, 8));
    workerPool.start(id, {
      deviceId: device ? device.id : 'demo-device',
      shipmentId: s.id,
      intervalMs: Number(sc.intervalMs) || 500,
      batchSize: 25,
      noise: Number(sc.noise) || 0.03,
      pattern: sc.pattern || 'route',
      startLat: Number(origin.lat),
      startLon: Number(origin.lon),
      endLat: Number(dest.lat),
      endLon: Number(dest.lon),
      baseTemp: Number(sc.baseTemp) || 5,
      batteryDrainPerHour: Number(sc.batteryDrainPerHour) || 0.5,
      failureRate: Number(sc.failureRate) || 0,
      seed: Date.now() % 100000,
      battery: device ? Number(device.battery) || 100 : 100,
    });
    logConsole('Worker de telemetría arrancado → ' + id + ' · envío ' + s.trackingNumber);
    state.view = 'resources';
    renderWorkspace();
  }

  function stopAllWorkers() {
    workerPool.stopAll();
    logConsole('Todos los workers detenidos');
    renderResources();
  }

  async function tryElectronWorkers() {
    if (!window.iphub || typeof window.iphub.call !== 'function') {
      logConsole('Electron IPC no disponible — usando Web Workers del navegador', 'warn');
      return false;
    }
    try {
      const res = await window.iphub.call('teleResources');
      if (res && !res.error) {
        logConsole('Motor Electron OK · workers max ' + res.maxWorkers + ' · heap ' + Math.round((res.heapUsed || 0) / 1048576) + ' MB');
        return true;
      }
    } catch (_) {}
    return false;
  }

  // ---------- Render ----------
  function renderExplorer() {
    const el = document.getElementById('ts-explorer-list');
    if (!el) return;
    if (!state.projects.length) {
      el.innerHTML = '<div class="ts-empty">Sin proyectos. Creá uno para empezar.</div>';
      return;
    }
    el.innerHTML = state.projects.map(p => {
      const active = state.activeProject && state.activeProject.id === p.id;
      return '<div class="ts-tree-item' + (active ? ' active' : '') + '" data-pid="' + p.id + '">' +
        '<span class="ts-tree-ico">P</span> ' +
        '<span class="ts-tree-label">' + esc(p.name) + '</span>' +
        '<span class="ts-tree-meta">' + (p.shipmentCount || 0) + '</span></div>';
    }).join('');
    el.querySelectorAll('[data-pid]').forEach(n => {
      n.addEventListener('click', () => selectProject(n.getAttribute('data-pid')));
    });

    const shipEl = document.getElementById('ts-ship-list');
    if (!shipEl) return;
    if (!state.activeProject) {
      shipEl.innerHTML = '<div class="ts-empty">Abrí un proyecto</div>';
      return;
    }
    if (!state.shipments.length) {
      shipEl.innerHTML = '<div class="ts-empty">Sin envíos en este proyecto</div>';
      return;
    }
    shipEl.innerHTML = state.shipments.map(s => {
      const sel = state.selectedShipment && state.selectedShipment.id === s.id;
      return '<div class="ts-tree-item' + (sel ? ' active' : '') + '" data-sid="' + s.id + '">' +
        '<span class="ts-tree-ico">S</span> ' +
        '<span class="ts-tree-label">' + esc(s.trackingNumber) + '</span>' +
        '<span class="ts-st ' + statusClass(s.status) + '">' + esc(s.status) + '</span></div>';
    }).join('');
    shipEl.querySelectorAll('[data-sid]').forEach(n => {
      n.addEventListener('click', () => selectShipment(n.getAttribute('data-sid')));
    });
  }

  function renderWorkspace() {
    const title = document.getElementById('ts-ws-title');
    if (title) {
      title.textContent = state.activeProject
        ? (state.selectedShipment ? state.selectedShipment.trackingNumber : state.activeProject.name)
        : 'Tracking Studio';
    }
    const panes = ['map', 'list', 'events', 'devices', 'resources', 'alerts', 'analytics', 'dashboard', 'rules', 'smart', 'predictive'];
    for (const v of panes) {
      const el = document.getElementById('ts-' + v + '-pane');
      if (el) el.classList.toggle('hidden', state.view !== v);
    }
    if (state.view === 'map') drawMap();
    if (state.view === 'list') renderList();
    if (state.view === 'events') renderEventsPane();
    if (state.view === 'devices') renderDevices();
    if (state.view === 'resources') renderResources();
    if (state.view === 'alerts') renderAlerts();
    if (state.view === 'analytics') renderAnalytics();
    if (state.view === 'dashboard') renderDashboard();
    if (state.view === 'rules') renderRules();
    if (state.view === 'smart') renderSmartCenter();
    if (state.view === 'predictive') renderPredictive();
  }

  function chartForecast(canvas, history, forecast, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#060b18';
    ctx.fillRect(0, 0, w, h);
    const hist = (history || []).map(p => (typeof p === 'number' ? p : p.v));
    const fut = (forecast || []).map(p => p.v);
    if (hist.length < 2 && fut.length < 1) {
      ctx.fillStyle = '#8b98b8';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Sin datos para proyectar', w / 2, h / 2);
      return;
    }
    const all = hist.concat(fut);
    let min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    if (min === max) { min -= 1; max += 1; }
    const pad = 28;
    const range = max - min;
    const total = Math.max(2, all.length);
    function xy(i, v) {
      return {
        x: pad + (i / (total - 1)) * (w - pad * 2),
        y: h - pad - ((v - min) / range) * (h - pad * 2),
      };
    }
    // grid
    ctx.strokeStyle = 'rgba(94,234,212,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad + ((h - pad * 2) * i) / 4;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }
    // history line
    const histColor = opts.color || '#22d3ee';
    ctx.strokeStyle = histColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    hist.forEach((v, i) => {
      const p = xy(i, v);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    // forecast dashed
    if (fut.length && hist.length) {
      ctx.strokeStyle = opts.forecastColor || '#fbbf24';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      const start = xy(hist.length - 1, hist[hist.length - 1]);
      ctx.moveTo(start.x, start.y);
      fut.forEach((v, i) => {
        const p = xy(hist.length + i, v);
        ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      // confidence band rough
      ctx.fillStyle = 'rgba(251,191,36,0.1)';
      ctx.beginPath();
      fut.forEach((v, i) => {
        const conf = (forecast[i] && forecast[i].confidence) || 0.5;
        const spread = (max - min) * 0.08 * (1.2 - conf);
        const p = xy(hist.length + i, v + spread);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      for (let i = fut.length - 1; i >= 0; i--) {
        const conf = (forecast[i] && forecast[i].confidence) || 0.5;
        const spread = (max - min) * 0.08 * (1.2 - conf);
        const p = xy(hist.length + i, fut[i] - spread);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
    }
    // separator
    if (hist.length) {
      const sep = xy(hist.length - 1, min);
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(sep.x, pad);
      ctx.lineTo(sep.x, h - pad);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#8b98b8';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(max * 100) / 100), 4, pad + 4);
    ctx.fillText(String(Math.round(min * 100) / 100), 4, h - pad);
    if (opts.label) {
      ctx.fillStyle = histColor;
      ctx.font = '11px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(opts.label, w - pad, 14);
    }
  }

  async function refreshPredictive() {
    if (!state.activeProject) return;
    try {
      state.predictive = await api('/projects/' + state.activeProject.id + '/analytics/predictive');
      if (state.view === 'predictive') renderPredictive();
      logConsole('Predictive dashboard actualizado');
    } catch (e) {
      logConsole('Error predictive: ' + e.message, 'error');
    }
  }

  function renderPredictive() {
    const el = document.getElementById('ts-predictive-body');
    if (!el) return;
    const d = state.predictive;
    if (!d || !d.kpis) {
      el.innerHTML = '<div class="ts-empty">Sin datos predictivos. Generá telemetría y Refrescá.</div>';
      return;
    }
    const k = d.kpis;
    const fc = d.forecasts || {};

    el.innerHTML =
      '<div class="ts-dash-toolbar"><span class="muted small">Predictivo · ' +
      esc((d.generatedAt || '').replace('T', ' ').slice(0, 19)) +
      '</span> <button type="button" class="btn btn-sm" id="ts-pred-refresh">Refrescar</button></div>' +
      '<div class="ts-res-grid">' +
      '<div class="ts-res-card"><h4>P(EXCEPCIÓN) MEDIA</h4><div class="ts-res-val">' + k.avgExceptionProbability + '%</div></div>' +
      '<div class="ts-res-card"><h4>LIKELY EXCEPTIONS</h4><div class="ts-res-val" style="color:var(--danger)">' + k.likelyExceptions + '</div></div>' +
      '<div class="ts-res-card"><h4>HIGH RISK</h4><div class="ts-res-val">' + k.highRiskCount + '</div></div>' +
      '<div class="ts-res-card"><h4>ETA PROMEDIO</h4><div class="ts-res-val">' + (k.avgEtaMinutes != null ? k.avgEtaMinutes + 'm' : '—') + '</div></div>' +
      '<div class="ts-res-card"><h4>TEMP SLOPE</h4><div class="ts-res-val">' + (Math.round((k.tempTrendSlope || 0) * 1000) / 1000) + '</div><div class="muted small">R² ' + (k.tempR2 || 0) + '</div></div>' +
      '<div class="ts-res-card"><h4>VOL TREND</h4><div class="ts-res-val">' + (Math.round((k.volumeTrendSlope || 0) * 100) / 100) + '</div></div>' +
      '</div>' +
      '<div class="ts-dash-charts">' +
      '<div class="ts-chart-card"><h4>Temperatura · historial + forecast</h4><canvas id="ts-pred-temp" width="340" height="180"></canvas></div>' +
      '<div class="ts-chart-card"><h4>Volumen telemetría · forecast</h4><canvas id="ts-pred-vol" width="340" height="180"></canvas></div>' +
      '<div class="ts-chart-card"><h4>Risk score · proyección</h4><canvas id="ts-pred-risk" width="340" height="180"></canvas></div>' +
      '<div class="ts-chart-card"><h4>Delivery funnel (próximas horas)</h4><canvas id="ts-pred-funnel" width="340" height="180"></canvas></div>' +
      '</div>' +
      '<div class="ts-dash-tables">' +
      '<div class="ts-insp-section"><h4>WHAT-IF SCENARIOS</h4>' +
      ((d.scenarios || []).map(s =>
        '<div class="ts-alert-row"><div class="ts-alert-head"><strong>' + esc(s.name) + '</strong> ' +
        '<span class="muted small">impact +' + s.impact + '</span></div>' +
        '<div class="muted small">' + esc(s.description) + '</div>' +
        '<div class="ts-kv"><span>Expected exceptions</span><b>' + s.expectedExceptions + '</b></div>' +
        '<div class="ts-kv"><span>Avg risk</span><b>' + s.avgRisk + '</b></div></div>'
      ).join('')) +
      '</div>' +
      '<div class="ts-insp-section"><h4>TOP PREDICCIONES POR RIESGO</h4>' +
      ((d.topPredictions || []).slice(0, 10).map(pr =>
        '<div class="ts-kv"><span>' + esc(pr.trackingNumber) + ' · ' + esc(pr.status) + '</span><b>' +
        'P(exc) ' + Math.round((pr.exceptionProbability && pr.exceptionProbability.probability || 0) * 100) + '%' +
        ' · risk ' + pr.riskScore +
        (pr.eta && pr.eta.etaMinutes != null ? ' · ETA ' + pr.eta.etaMinutes + 'm [' + (pr.eta.etaOptimistic || '—') + '–' + (pr.eta.etaPessimistic || '—') + ']' : '') +
        '</b></div>'
      ).join('') || '<div class="ts-empty">—</div>') +
      '</div></div>';

    const btn = document.getElementById('ts-pred-refresh');
    if (btn) btn.addEventListener('click', refreshPredictive);

    requestAnimationFrame(() => {
      const t = fc.temperature || {};
      const c1 = document.getElementById('ts-pred-temp');
      if (c1) chartForecast(c1, t.history, t.forecast, { color: '#f87171', forecastColor: '#fb923c', label: '°C' });

      const v = fc.volume || {};
      const c2 = document.getElementById('ts-pred-vol');
      if (c2) chartForecast(c2, v.history, v.forecast, { color: '#22d3ee', forecastColor: '#67e8f9', label: 'vol' });

      const r = fc.risk || {};
      const c3 = document.getElementById('ts-pred-risk');
      if (c3) chartForecast(c3, r.history, r.forecast, { color: '#a78bfa', forecastColor: '#c4b5fd', label: 'risk' });

      const funnel = (d.deliveryFunnel || []).map(f => ({ label: f.horizonHours + 'h', v: f.expectedDeliveries, color: '#34d399' }));
      const c4 = document.getElementById('ts-pred-funnel');
      if (c4) chartBars(c4, funnel, { label: 'deliveries' });
    });
  }

  function renderRules() {
    const el = document.getElementById('ts-rules-body');
    if (!el) return;
    const rules = state.alertRules || [];
    if (!rules.length) {
      el.innerHTML = '<div class="ts-empty">Sin reglas. Se crean automáticamente al abrir el proyecto.</div>';
      return;
    }
    el.innerHTML =
      '<div class="ts-dash-toolbar"><span class="muted small">' + rules.length + ' reglas</span>' +
      '<button type="button" class="btn btn-sm btn-primary" id="ts-btn-add-rule">+ Regla</button></div>' +
      rules.map(r =>
        '<div class="ts-alert-row">' +
        '<div class="ts-alert-head">' +
        '<span class="ts-st ' + (r.enabled ? 'ts-st-ok' : 'ts-st-idle') + '">' + (r.enabled ? 'ON' : 'OFF') + '</span> ' +
        '<strong>' + esc(r.name) + '</strong> ' +
        '<span class="muted small">' + esc(r.condition) + (r.threshold != null ? ' @ ' + r.threshold : '') + '</span> ' +
        '<span class="ts-st ' + sevClass(r.severity) + '">' + esc(r.severity) + '</span>' +
        (r.composite ? ' <span class="muted small">COMPOSITE</span>' : '') +
        '</div>' +
        '<div class="muted small">Cooldown ' + (r.cooldownMinutes || 0) + ' min' +
        (r.escalateAfterMinutes ? ' · Escalate @ ' + r.escalateAfterMinutes + 'm → ' + esc(r.escalateTo || 'critical') : '') +
        (r.compositeRules && r.compositeRules.length ? ' · ' + r.compositeRules.join(' + ') : '') +
        '</div>' +
        '<div class="ts-alert-actions">' +
        '<button type="button" class="btn btn-sm" data-rule-toggle="' + r.id + '" data-en="' + (r.enabled ? '0' : '1') + '">' +
        (r.enabled ? 'Desactivar' : 'Activar') + '</button></div></div>'
      ).join('');
    const addBtn = document.getElementById('ts-btn-add-rule');
    if (addBtn) addBtn.addEventListener('click', addCustomRule);
    el.querySelectorAll('[data-rule-toggle]').forEach(btn => {
      btn.addEventListener('click', () => toggleRule(btn.getAttribute('data-rule-toggle'), btn.getAttribute('data-en') === '1'));
    });
  }

  function renderSmartCenter() {
    const el = document.getElementById('ts-smart-body');
    if (!el) return;
    const sum = state.smartSummary || {};
    const groups = state.alertGroups || [];
    const smartAlerts = (state.alerts || []).filter(a => a.intelligent).slice(0, 50);
    el.innerHTML =
      '<div class="ts-res-grid">' +
      '<div class="ts-res-card"><h4>OPEN SMART</h4><div class="ts-res-val">' + (sum.open || 0) + '</div></div>' +
      '<div class="ts-res-card"><h4>ESCALADAS</h4><div class="ts-res-val">' + (sum.escalated || 0) + '</div></div>' +
      '<div class="ts-res-card"><h4>CRITICAL</h4><div class="ts-res-val" style="color:var(--danger)">' + (sum.critical || 0) + '</div></div>' +
      '<div class="ts-res-card"><h4>GRUPOS</h4><div class="ts-res-val">' + (sum.groups || groups.length) + '</div></div>' +
      '</div>' +
      '<div class="ts-dash-toolbar">' +
      '<span class="muted small">Centro de alertas inteligentes</span>' +
      '<span><button type="button" class="btn btn-sm" id="ts-btn-smart-ship">Evaluate envío</button> ' +
      '<button type="button" class="btn btn-sm btn-primary" id="ts-btn-smart-proj">Evaluate proyecto</button></span></div>' +
      '<div class="ts-insp-section"><h4>GRUPOS CORRELACIONADOS</h4>' +
      (groups.length ? groups.map(g =>
        '<div class="ts-alert-row">' +
        '<div class="ts-alert-head"><span class="ts-st ' + sevClass(g.severity) + '">' + esc(g.severity) + '</span> ' +
        '<strong>' + esc(g.title) + '</strong> <span class="muted small">' + ((g.alertIds || []).length) + ' alertas</span></div>' +
        '<div class="ts-alert-msg">' + esc(g.insight || '') + '</div></div>'
      ).join('') : '<div class="ts-empty">Sin grupos. Varias alertas en el mismo envío se correlacionan automáticamente.</div>') +
      '</div>' +
      '<div class="ts-insp-section"><h4>ALERTAS INTELIGENTES</h4>' +
      (smartAlerts.length ? smartAlerts.map(a =>
        '<div class="ts-alert-row">' +
        '<div class="ts-alert-head">' +
        '<span class="ts-st ' + sevClass(a.severity) + '">' + esc(a.severity) + '</span> ' +
        (a.escalated ? '<span class="ts-st ts-st-bad">ESCALADA</span> ' : '') +
        '<strong>' + esc(a.title) + '</strong> ' +
        '<span class="muted small">' + esc(a.type) + '</span></div>' +
        '<div class="ts-alert-msg">' + esc(a.message) + '</div>' +
        (a.recommendedAction ? '<div class="muted small">→ ' + esc(a.recommendedAction) + '</div>' : '') +
        '<div class="ts-alert-actions"><span class="ts-st ' + (a.status === 'open' ? 'ts-st-run' : 'ts-st-ok') + '">' + esc(a.status) + '</span> ' +
        (a.status === 'open' ? '<button type="button" class="btn btn-sm" data-ack="' + a.id + '">Ack</button> ' +
          '<button type="button" class="btn btn-sm" data-res="' + a.id + '">Resolver</button>' : '') +
        '</div></div>'
      ).join('') : '<div class="ts-empty">Sin alertas inteligentes aún. Usá Evaluate envío/proyecto tras generar telemetría.</div>') +
      '</div>';
    const bs = document.getElementById('ts-btn-smart-ship');
    const bp = document.getElementById('ts-btn-smart-proj');
    if (bs) bs.addEventListener('click', evaluateSmartSelected);
    if (bp) bp.addEventListener('click', evaluateSmartProject);
    el.querySelectorAll('[data-ack]').forEach(btn => {
      btn.addEventListener('click', () => ackAlert(btn.getAttribute('data-ack'), 'acknowledged'));
    });
    el.querySelectorAll('[data-res]').forEach(btn => {
      btn.addEventListener('click', () => ackAlert(btn.getAttribute('data-res'), 'resolved'));
    });
  }

  function renderDevices() {
    const el = document.getElementById('ts-devices-body');
    if (!el) return;
    if (!state.devices.length) {
      el.innerHTML = '<div class="ts-empty">Sin dispositivos IoT. Creá uno con el botón + Device.</div>';
      return;
    }
    el.innerHTML = '<table class="ts-table"><thead><tr>' +
      '<th>Nombre</th><th>Tipo</th><th>IMEI</th><th>Status</th><th>Batería</th><th>Envío</th><th>Protocolo</th>' +
      '</tr></thead><tbody>' +
      state.devices.map(d => {
        const ship = state.shipments.find(s => s.id === d.shipmentId);
        return '<tr data-did="' + d.id + '">' +
          '<td>' + esc(d.name) + '</td>' +
          '<td>' + esc(d.type) + '</td>' +
          '<td class="mono">' + esc(d.imei) + '</td>' +
          '<td><span class="ts-st ' + (d.status === 'ONLINE' ? 'ts-st-ok' : 'ts-st-idle') + '">' + esc(d.status) + '</span></td>' +
          '<td>' + (d.battery != null ? Number(d.battery).toFixed(0) + '%' : '—') + '</td>' +
          '<td>' + esc(ship ? ship.trackingNumber : '—') + '</td>' +
          '<td>' + esc(d.protocol || '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderResources() {
    const el = document.getElementById('ts-resources-body');
    if (!el) return;
    const ws = state.workerStats || {};
    const mem = (performance && performance.memory) ? performance.memory : null;
    el.innerHTML =
      '<div class="ts-res-grid">' +
      '<div class="ts-res-card"><h4>WORKERS</h4><div class="ts-res-val">' + (ws.workers || workerPool.workers.size) + '</div><div class="muted small">activos</div></div>' +
      '<div class="ts-res-card"><h4>EVENTS/SEC</h4><div class="ts-res-val">' + (ws.eps || 0) + '</div><div class="muted small">ventana 1s</div></div>' +
      '<div class="ts-res-card"><h4>GENERADOS</h4><div class="ts-res-val">' + (ws.generated || 0) + '</div><div class="muted small">total sesión</div></div>' +
      '<div class="ts-res-card"><h4>PUSHED</h4><div class="ts-res-val">' + (ws.pushed || workerPool.totals.pushed || 0) + '</div><div class="muted small">al servidor</div></div>' +
      '<div class="ts-res-card"><h4>COLA</h4><div class="ts-res-val">' + (ws.queue != null ? ws.queue : workerPool.queue.length) + '</div><div class="muted small">backpressure</div></div>' +
      '<div class="ts-res-card"><h4>DROPPED</h4><div class="ts-res-val">' + (ws.dropped || 0) + '</div><div class="muted small">por límite</div></div>' +
      (mem ? '<div class="ts-res-card"><h4>HEAP JS</h4><div class="ts-res-val">' + Math.round(mem.usedJSHeapSize / 1048576) + ' MB</div><div class="muted small">/ ' + Math.round(mem.jsHeapSizeLimit / 1048576) + ' MB</div></div>' : '') +
      '</div>' +
      '<div class="ts-insp-section" style="margin-top:12px"><h4>WORKERS ACTIVOS</h4>' +
      ([...workerPool.workers.entries()].map(([id, e]) =>
        '<div class="ts-kv"><span>' + esc(id) + '</span><b>' + esc((e.config && e.config.pattern) || 'route') + ' · ' + ((e.stats && e.stats.generated) || 0) + ' evt</b></div>'
      ).join('') || '<div class="ts-empty">Ningún worker corriendo</div>') +
      '</div>';
  }

  function sevClass(sev) {
    if (sev === 'critical' || sev === 'high') return 'ts-st-bad';
    if (sev === 'medium') return 'ts-st-run';
    return 'ts-st-idle';
  }

  function renderAlerts() {
    const el = document.getElementById('ts-alerts-body');
    if (!el) return;
    const list = state.alerts || [];
    if (!list.length) {
      el.innerHTML = '<div class="ts-empty">Sin alertas. Generá telemetría y pulsá Evaluate, o esperá el auto-evaluate al ingest.</div>';
      return;
    }
    el.innerHTML = list.slice(0, 100).map(a => {
      return '<div class="ts-alert-row">' +
        '<div class="ts-alert-head">' +
        '<span class="ts-st ' + sevClass(a.severity) + '">' + esc(a.severity) + '</span> ' +
        '<strong>' + esc(a.title) + '</strong> ' +
        '<span class="muted small">' + esc(a.type) + '</span> ' +
        '<span class="muted small">' + esc((a.createdAt || '').replace('T', ' ').slice(0, 19)) + '</span>' +
        '</div>' +
        '<div class="ts-alert-msg">' + esc(a.message) + '</div>' +
        (a.recommendedAction ? '<div class="muted small">Acción: ' + esc(a.recommendedAction) + '</div>' : '') +
        '<div class="ts-alert-actions">' +
        '<span class="ts-st ' + (a.status === 'open' ? 'ts-st-run' : 'ts-st-ok') + '">' + esc(a.status) + '</span> ' +
        (a.status === 'open' ? '<button type="button" class="btn btn-sm" data-ack="' + a.id + '">Ack</button> ' +
          '<button type="button" class="btn btn-sm" data-res="' + a.id + '">Resolver</button>' : '') +
        '</div></div>';
    }).join('');
    el.querySelectorAll('[data-ack]').forEach(btn => {
      btn.addEventListener('click', () => ackAlert(btn.getAttribute('data-ack'), 'acknowledged'));
    });
    el.querySelectorAll('[data-res]').forEach(btn => {
      btn.addEventListener('click', () => ackAlert(btn.getAttribute('data-res'), 'resolved'));
    });
  }

  function renderAnalytics() {
    const el = document.getElementById('ts-analytics-body');
    if (!el) return;
    const pa = state.projectAnalytics;
    const an = state.analytics;
    let html = '';
    if (pa) {
      html += '<div class="ts-res-grid">' +
        '<div class="ts-res-card"><h4>ALERTAS ABIERTAS</h4><div class="ts-res-val">' + (pa.openAlerts || 0) + '</div></div>' +
        '<div class="ts-res-card"><h4>RISK PROMEDIO</h4><div class="ts-res-val">' + (pa.avgRisk || 0) + '</div></div>' +
        '<div class="ts-res-card"><h4>ENVÍOS</h4><div class="ts-res-val">' + (pa.shipmentCount || 0) + '</div></div>' +
        '</div>';
      if (pa.topRisks && pa.topRisks.length) {
        html += '<div class="ts-insp-section"><h4>TOP RISK SHIPMENTS</h4>' +
          pa.topRisks.map(r =>
            '<div class="ts-kv"><span>' + esc(r.trackingNumber) + '</span><b class="' +
            (r.score >= 50 ? 'ts-st-bad' : '') + '">' + r.score + ' (' + esc(r.band) + ')</b></div>'
          ).join('') + '</div>';
      }
      if (pa.byType && Object.keys(pa.byType).length) {
        html += '<div class="ts-insp-section"><h4>ALERTAS POR TIPO</h4>' +
          Object.keys(pa.byType).map(k =>
            '<div class="ts-kv"><span>' + esc(k) + '</span><b>' + pa.byType[k] + '</b></div>'
          ).join('') + '</div>';
      }
    }
    if (an) {
      const risk = an.risk || {};
      const eta = an.eta || {};
      const trend = an.temperatureTrend || {};
      html += '<div class="ts-insp-section"><h4>ENVÍO SELECCIONADO — ' + esc(an.trackingNumber || '') + '</h4>' +
        '<div class="ts-kv"><span>Risk score</span><b>' + (risk.score != null ? risk.score + ' / 100 (' + esc(risk.band) + ')' : '—') + '</b></div>' +
        '<div class="ts-kv"><span>ETA</span><b>' + (eta.etaMinutes != null ? Math.round(eta.etaMinutes) + ' min · ' + (eta.remainingKm || '—') + ' km' : '—') + '</b></div>' +
        '<div class="ts-kv"><span>Vel. media</span><b>' + (eta.avgSpeedKmh != null ? eta.avgSpeedKmh + ' km/h' : '—') + '</b></div>' +
        '<div class="ts-kv"><span>Confianza ETA</span><b>' + (eta.confidence != null ? Math.round(eta.confidence * 100) + '%' : '—') + '</b></div>' +
        '<div class="ts-kv"><span>Temp trend</span><b>' + (trend.risk || '—') + (trend.slope != null ? ' · slope ' + trend.slope : '') + '</b></div>' +
        '<div class="ts-kv"><span>Temp forecast</span><b>' + (trend.forecast != null ? trend.forecast + ' °C' : '—') + '</b></div>' +
        '<div class="ts-kv"><span>Anomalías</span><b>' + ((an.anomalies && an.anomalies.length) || 0) + '</b></div>' +
        '</div>';
      if (risk.factors && risk.factors.length) {
        html += '<div class="ts-insp-section"><h4>FACTORES DE RIESGO</h4>' +
          risk.factors.map(f =>
            '<div class="ts-kv"><span>' + esc(f.factor) + '</span><b>+' + f.points + ' · ' + esc(f.detail || '') + '</b></div>'
          ).join('') + '</div>';
      }
    }
    if (!html) html = '<div class="ts-empty">Abrí un proyecto y/o envío para ver analítica predictiva.</div>';
    el.innerHTML = html;
  }

  // ---------- Canvas chart helpers (sin dependencias) ----------
  function chartLine(canvas, points, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#060b18';
    ctx.fillRect(0, 0, w, h);
    if (!points || points.length < 2) {
      ctx.fillStyle = '#8b98b8';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Sin datos suficientes', w / 2, h / 2);
      return;
    }
    const pad = 28;
    const vals = points.map(p => p.v);
    let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    const range = max - min;
    ctx.strokeStyle = 'rgba(94,234,212,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad + ((h - pad * 2) * i) / 4;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }
    const color = opts.color || '#22d3ee';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p.v - min) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // fill under
    ctx.lineTo(pad + (w - pad * 2), h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = color.replace(')', ',0.12)').replace('rgb', 'rgba').replace('#22d3ee', 'rgba(34,211,238,0.12)').replace('#f87171', 'rgba(248,113,113,0.12)').replace('#a78bfa', 'rgba(167,139,250,0.12)').replace('#34d399', 'rgba(52,211,153,0.12)').replace('#fbbf24', 'rgba(251,191,36,0.12)');
    if (color.charAt(0) === '#') {
      const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.12)';
    }
    ctx.fill();
    ctx.fillStyle = '#8b98b8';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(max * 100) / 100), 4, pad + 4);
    ctx.fillText(String(Math.round(min * 100) / 100), 4, h - pad);
    if (opts.label) {
      ctx.fillStyle = color;
      ctx.font = '11px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(opts.label, w - pad, 14);
    }
  }

  function chartBars(canvas, items, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#060b18';
    ctx.fillRect(0, 0, w, h);
    if (!items || !items.length) {
      ctx.fillStyle = '#8b98b8';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Sin datos', w / 2, h / 2);
      return;
    }
    const pad = 28;
    const max = Math.max.apply(null, items.map(i => i.v)) || 1;
    const bw = (w - pad * 2) / items.length;
    items.forEach((it, i) => {
      const bh = ((it.v / max) * (h - pad * 2));
      const x = pad + i * bw + 2;
      const y = h - pad - bh;
      ctx.fillStyle = it.color || opts.color || '#818cf8';
      ctx.fillRect(x, y, Math.max(2, bw - 4), bh);
      if (bw > 28) {
        ctx.fillStyle = '#8b98b8';
        ctx.font = '9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(String(it.label || '').slice(0, 8), x + bw / 2, h - 10);
      }
    });
    if (opts.label) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(opts.label, w - pad, 14);
    }
  }

  function chartDonut(canvas, items) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#060b18';
    ctx.fillRect(0, 0, w, h);
    const total = items.reduce((a, b) => a + b.v, 0);
    if (!total) {
      ctx.fillStyle = '#8b98b8';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Sin datos', w / 2, h / 2);
      return;
    }
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 16;
    let angle = -Math.PI / 2;
    items.forEach(it => {
      const slice = (it.v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = it.color || '#22d3ee';
      ctx.fill();
      angle += slice;
    });
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#060b18';
    ctx.fill();
    ctx.fillStyle = '#e6edf7';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(String(total), cx, cy + 5);
  }

  async function refreshDashboard() {
    if (!state.activeProject) return;
    try {
      state.dashboard = await api('/projects/' + state.activeProject.id + '/analytics/dashboard');
      if (state.view === 'dashboard') renderDashboard();
      logConsole('Dashboard actualizado · ' + (state.dashboard.kpis && state.dashboard.kpis.shipments) + ' envíos');
    } catch (e) {
      logConsole('Error dashboard: ' + e.message, 'error');
    }
  }

  function renderDashboard() {
    const el = document.getElementById('ts-dashboard-body');
    if (!el) return;
    const d = state.dashboard;
    if (!d || !d.kpis) {
      el.innerHTML = '<div class="ts-empty">Sin datos de dashboard. Creá envíos y telemetría, luego Refrescar.</div>';
      return;
    }
    const k = d.kpis;
    const statusColors = {
      DELIVERED: '#34d399', EXCEPTION: '#f87171', IN_TRANSIT: '#22d3ee',
      OUT_FOR_DELIVERY: '#818cf8', PICKED_UP: '#fbbf24', LABEL_CREATED: '#64748b',
      ARRIVED_AT_FACILITY: '#a78bfa', CANCELLED: '#94a3b8', RETURNED: '#fb923c',
      CUSTOMS_CLEARANCE: '#38bdf8',
    };
    const sevColors = { critical: '#f87171', high: '#fb923c', medium: '#fbbf24', low: '#22d3ee', info: '#64748b' };

    el.innerHTML =
      '<div class="ts-dash-toolbar"><span class="muted small">Generado ' + esc((d.generatedAt || '').replace('T', ' ').slice(0, 19)) +
      '</span> <button type="button" class="btn btn-sm" id="ts-dash-refresh">Refrescar</button></div>' +
      '<div class="ts-res-grid">' +
      '<div class="ts-res-card"><h4>ENVÍOS</h4><div class="ts-res-val">' + k.shipments + '</div><div class="muted small">' + k.inTransit + ' en tránsito</div></div>' +
      '<div class="ts-res-card"><h4>OTIF PROXY</h4><div class="ts-res-val">' + k.otifProxy + '%</div><div class="muted small">' + k.delivered + ' entregados</div></div>' +
      '<div class="ts-res-card"><h4>EXCEPCIONES</h4><div class="ts-res-val" style="color:var(--danger)">' + k.exceptions + '</div></div>' +
      '<div class="ts-res-card"><h4>ALERTAS ABIERTAS</h4><div class="ts-res-val">' + k.openAlerts + '</div></div>' +
      '<div class="ts-res-card"><h4>RISK PROMEDIO</h4><div class="ts-res-val">' + k.avgRisk + '</div></div>' +
      '<div class="ts-res-card"><h4>COLD CHAIN</h4><div class="ts-res-val">' + (k.coldHealth != null ? k.coldHealth + '%' : '—') + '</div><div class="muted small">' + (k.coldBreach || 0) + ' breaches</div></div>' +
      '<div class="ts-res-card"><h4>TELEMETRÍA</h4><div class="ts-res-val">' + k.telemetryCount + '</div></div>' +
      '<div class="ts-res-card"><h4>DEVICES</h4><div class="ts-res-val">' + k.devices + '</div><div class="muted small">' + k.deviceOnline + ' online</div></div>' +
      '</div>' +
      '<div class="ts-dash-charts">' +
      '<div class="ts-chart-card"><h4>Estados de envío</h4><canvas id="ts-chart-status" width="320" height="180"></canvas></div>' +
      '<div class="ts-chart-card"><h4>Alertas por severidad</h4><canvas id="ts-chart-sev" width="320" height="180"></canvas></div>' +
      '<div class="ts-chart-card"><h4>Temperatura (serie)</h4><canvas id="ts-chart-temp" width="320" height="180"></canvas></div>' +
      '<div class="ts-chart-card"><h4>Volumen telemetría</h4><canvas id="ts-chart-vol" width="320" height="180"></canvas></div>' +
      '<div class="ts-chart-card"><h4>Alertas en el tiempo</h4><canvas id="ts-chart-alert-ts" width="320" height="180"></canvas></div>' +
      '<div class="ts-chart-card"><h4>Risk score histórico</h4><canvas id="ts-chart-risk" width="320" height="180"></canvas></div>' +
      '</div>' +
      '<div class="ts-dash-tables">' +
      '<div class="ts-insp-section"><h4>TOP RISK</h4>' +
      ((d.topRisks || []).slice(0, 8).map(r =>
        '<div class="ts-kv"><span>' + esc(r.trackingNumber) + ' · ' + esc(r.status) + '</span><b>' + r.score + ' (' + esc(r.band) + ')' +
        (r.etaMinutes != null ? ' · ETA ' + Math.round(r.etaMinutes) + 'm' : '') + '</b></div>'
      ).join('') || '<div class="ts-empty">—</div>') +
      '</div>' +
      '<div class="ts-insp-section"><h4>CARRIERS</h4>' +
      ((d.carrierPerf || []).map(c =>
        '<div class="ts-kv"><span>' + esc(c.carrier) + '</span><b>' + c.successRate + '% · ' + c.delivered + '/' + c.total +
        (c.exception ? ' · ' + c.exception + ' exc' : '') + '</b></div>'
      ).join('') || '<div class="ts-empty">—</div>') +
      '</div>' +
      '<div class="ts-insp-section"><h4>ALERTAS POR TIPO</h4>' +
      (Object.keys(d.byType || {}).map(k =>
        '<div class="ts-kv"><span>' + esc(k) + '</span><b>' + d.byType[k] + '</b></div>'
      ).join('') || '<div class="ts-empty">Sin alertas abiertas</div>') +
      '</div></div>';

    const btn = document.getElementById('ts-dash-refresh');
    if (btn) btn.addEventListener('click', refreshDashboard);

    // Draw charts after DOM paint
    requestAnimationFrame(() => {
      const statusItems = Object.keys(d.byStatus || {}).map(k => ({
        label: k.replace(/_/g, ' ').slice(0, 10),
        v: d.byStatus[k],
        color: statusColors[k] || '#64748b',
      }));
      const c1 = document.getElementById('ts-chart-status');
      if (c1) chartBars(c1, statusItems, { label: 'status' });

      const sevItems = Object.keys(d.bySeverity || {}).filter(k => d.bySeverity[k] > 0).map(k => ({
        label: k, v: d.bySeverity[k], color: sevColors[k] || '#64748b',
      }));
      const c2 = document.getElementById('ts-chart-sev');
      if (c2) {
        if (sevItems.length) chartDonut(c2, sevItems);
        else chartBars(c2, [{ label: 'none', v: 0 }], {});
      }

      const temps = (d.series && d.series.temperature || []).map(p => ({ v: p.v }));
      const c3 = document.getElementById('ts-chart-temp');
      if (c3) chartLine(c3, temps, { color: '#f87171', label: '°C' });

      const vols = (d.series && d.series.volume || []).map(p => ({ v: p.v }));
      const c4 = document.getElementById('ts-chart-vol');
      if (c4) chartLine(c4, vols, { color: '#22d3ee', label: 'evt/h' });

      const alts = (d.series && d.series.alerts || []).map(p => ({ v: p.total }));
      const c5 = document.getElementById('ts-chart-alert-ts');
      if (c5) chartLine(c5, alts, { color: '#fbbf24', label: 'alerts/day' });

      const risks = (d.series && d.series.risk || []).map(p => ({ v: p.score }));
      const c6 = document.getElementById('ts-chart-risk');
      if (c6) chartLine(c6, risks, { color: '#a78bfa', label: 'risk' });
    });
  }

  function renderList() {
    const el = document.getElementById('ts-list-body');
    if (!el) return;
    if (!state.shipments.length) {
      el.innerHTML = '<tr><td colspan="6" class="ts-empty">Sin envíos</td></tr>';
      return;
    }
    el.innerHTML = state.shipments.map(s => {
      const loc = s.currentLocation || {};
      return '<tr data-sid="' + s.id + '" class="' + (state.selectedShipment && state.selectedShipment.id === s.id ? 'active' : '') + '">' +
        '<td>' + esc(s.trackingNumber) + '</td>' +
        '<td><span class="ts-st ' + statusClass(s.status) + '">' + esc(s.status) + '</span></td>' +
        '<td>' + esc(s.carrier || '—') + '</td>' +
        '<td>' + (loc.lat != null ? Number(loc.lat).toFixed(3) + ', ' + Number(loc.lon).toFixed(3) : '—') + '</td>' +
        '<td>' + esc((s.origin && s.origin.name) || '—') + '</td>' +
        '<td>' + esc((s.destination && s.destination.name) || '—') + '</td></tr>';
    }).join('');
    el.querySelectorAll('[data-sid]').forEach(n => {
      n.addEventListener('click', () => selectShipment(n.getAttribute('data-sid')));
    });
  }

  function renderEventsPane() {
    const el = document.getElementById('ts-events-body');
    if (!el) return;
    if (!state.selectedShipment) {
      el.innerHTML = '<div class="ts-empty">Seleccioná un envío para ver eventos</div>';
      return;
    }
    if (!state.events.length) {
      el.innerHTML = '<div class="ts-empty">Sin eventos</div>';
      return;
    }
    el.innerHTML = state.events.slice().reverse().map(e => {
      return '<div class="ts-event-row">' +
        '<span class="ts-event-ts">' + esc((e.timestamp || '').replace('T', ' ').slice(0, 19)) + '</span>' +
        '<span class="ts-event-type">' + esc(e.eventType) + '</span>' +
        '<span class="ts-event-src">' + esc(e.source) + '</span>' +
        '<span class="ts-event-loc">' + (e.latitude != null ? Number(e.latitude).toFixed(4) + ', ' + Number(e.longitude).toFixed(4) : '—') + '</span>' +
        '<span class="ts-event-hash" title="hash">' + esc((e.hash || '').slice(0, 8)) + '</span></div>';
    }).join('');
  }

  function renderInspector() {
    const el = document.getElementById('ts-inspector-body');
    if (!el) return;
    if (state.selectedShipment) {
      const s = state.selectedShipment;
      const loc = s.currentLocation || {};
      const temp = s.temperatureRequired || {};
      const lastTe = state.telemetry.length ? state.telemetry[state.telemetry.length - 1] : null;
      el.innerHTML =
        '<div class="ts-insp-section"><h4>SHIPMENT</h4>' +
        '<div class="ts-kv"><span>Tracking</span><b>' + esc(s.trackingNumber) + '</b></div>' +
        '<div class="ts-kv"><span>Status</span><b class="' + statusClass(s.status) + '">' + esc(s.status) + '</b></div>' +
        '<div class="ts-kv"><span>Mode</span>' + modeBadge(s.mode) + '</div>' +
        '<div class="ts-kv"><span>Carrier</span><b>' + esc(s.carrier || '—') + '</b></div>' +
        '<div class="ts-kv"><span>Weight</span><b>' + (s.weight || 0) + ' kg</b></div>' +
        '<div class="ts-kv"><span>Priority</span><b>' + esc(s.priority || '—') + '</b></div></div>' +
        '<div class="ts-insp-section"><h4>LOCATION</h4>' +
        '<div class="ts-kv"><span>Current</span><b>' + (loc.lat != null ? Number(loc.lat).toFixed(4) + ', ' + Number(loc.lon).toFixed(4) : '—') + '</b></div>' +
        '<div class="ts-kv"><span>Origin</span><b>' + esc((s.origin && s.origin.name) || '—') + '</b></div>' +
        '<div class="ts-kv"><span>Destination</span><b>' + esc((s.destination && s.destination.name) || '—') + '</b></div></div>' +
        '<div class="ts-insp-section"><h4>COLD CHAIN</h4>' +
        '<div class="ts-kv"><span>Required</span><b>' + (temp.min != null ? temp.min + ' – ' + temp.max + ' °C' : '—') + '</b></div>' +
        '<div class="ts-kv"><span>Last temp</span><b>' + (lastTe && lastTe.temperature != null ? lastTe.temperature.toFixed(1) + ' °C' : '—') + '</b></div>' +
        '<div class="ts-kv"><span>Humidity</span><b>' + (lastTe && lastTe.humidity != null ? lastTe.humidity.toFixed(0) + ' %' : '—') + '</b></div>' +
        '<div class="ts-kv"><span>Battery</span><b>' + (lastTe && lastTe.battery != null ? lastTe.battery.toFixed(0) + ' %' : '—') + '</b></div></div>' +
        '<div class="ts-insp-section"><h4>EVENTS</h4>' +
        '<div class="ts-kv"><span>Count</span><b>' + state.events.length + '</b></div>' +
        '<div class="ts-kv"><span>Telemetry</span><b>' + state.telemetry.length + '</b></div></div>';
      if (state.analytics && state.analytics.risk) {
        const r = state.analytics.risk;
        const eta = state.analytics.eta || {};
        el.innerHTML +=
          '<div class="ts-insp-section"><h4>RISK / PREDICT</h4>' +
          '<div class="ts-kv"><span>Score</span><b>' + r.score + ' (' + esc(r.band) + ')</b></div>' +
          '<div class="ts-kv"><span>ETA</span><b>' + (eta.etaMinutes != null ? Math.round(eta.etaMinutes) + ' min' : '—') + '</b></div>' +
          '<div class="ts-kv"><span>Open alerts</span><b>' + (state.analytics.openAlerts || 0) + '</b></div></div>';
      }
    } else if (state.activeProject && state.stats) {
      const st = state.stats;
      const pa = state.projectAnalytics || {};
      el.innerHTML =
        '<div class="ts-insp-section"><h4>PROJECT</h4>' +
        '<div class="ts-kv"><span>Name</span><b>' + esc(state.activeProject.name) + '</b></div>' +
        '<div class="ts-kv"><span>Mode</span>' + modeBadge(st.mode) + '</div>' +
        '<div class="ts-kv"><span>Shipments</span><b>' + st.shipmentCount + '</b></div>' +
        '<div class="ts-kv"><span>Events</span><b>' + st.eventCount + '</b></div>' +
        '<div class="ts-kv"><span>Telemetry</span><b>' + st.telemetryCount + '</b></div>' +
        '<div class="ts-kv"><span>Open alerts</span><b>' + (pa.openAlerts != null ? pa.openAlerts : '—') + '</b></div>' +
        '<div class="ts-kv"><span>Avg risk</span><b>' + (pa.avgRisk != null ? pa.avgRisk : '—') + '</b></div></div>' +
        '<div class="ts-insp-section"><h4>BY STATUS</h4>' +
        Object.keys(st.byStatus || {}).filter(k => st.byStatus[k] > 0).map(k =>
          '<div class="ts-kv"><span>' + esc(k) + '</span><b>' + st.byStatus[k] + '</b></div>'
        ).join('') + '</div>';
    } else {
      el.innerHTML = '<div class="ts-empty">Seleccioná un proyecto o envío</div>';
    }
  }

  function updateModeIndicator() {
    const el = document.getElementById('ts-mode-indicator');
    if (!el) return;
    el.innerHTML = modeBadge(state.mode || 'SIMULATED');
  }

  // ---------- Basic canvas map ----------
  function drawMap() {
    const canvas = document.getElementById('ts-map-canvas');
    if (!canvas) return;
    const parent = canvas.parentElement;
    const w = parent.clientWidth || 800;
    const h = parent.clientHeight || 400;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#060b18';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(94,234,212,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    const points = [];
    for (const s of state.shipments) {
      const loc = s.currentLocation || s.origin;
      if (loc && loc.lat != null && loc.lon != null) {
        points.push({ lat: Number(loc.lat), lon: Number(loc.lon), s, selected: state.selectedShipment && state.selectedShipment.id === s.id });
      }
      if (s.origin && s.origin.lat != null) points.push({ lat: Number(s.origin.lat), lon: Number(s.origin.lon), kind: 'origin', s });
      if (s.destination && s.destination.lat != null) points.push({ lat: Number(s.destination.lat), lon: Number(s.destination.lon), kind: 'dest', s });
    }
    // Add telemetry path for selected
    if (state.selectedShipment && state.telemetry.length) {
      for (const t of state.telemetry) {
        if (t.gps && t.gps.lat != null) points.push({ lat: t.gps.lat, lon: t.gps.lon, kind: 'tele', s: state.selectedShipment });
      }
    }

    if (!points.length) {
      ctx.fillStyle = '#8b98b8';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Sin ubicaciones GPS. Creá un envío o inyectá telemetría.', w / 2, h / 2);
      return;
    }

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
    }
    const pad = 0.15;
    const dLat = Math.max(0.01, maxLat - minLat) * (1 + pad);
    const dLon = Math.max(0.01, maxLon - minLon) * (1 + pad);
    const cLat = (minLat + maxLat) / 2;
    const cLon = (minLon + maxLon) / 2;
    function toXY(lat, lon) {
      const x = ((lon - (cLon - dLon / 2)) / dLon) * (w - 40) + 20;
      const y = ((cLat + dLat / 2 - lat) / dLat) * (h - 40) + 20;
      return { x, y };
    }

    // Draw planned/actual routes for selected
    if (state.selectedShipment) {
      const s = state.selectedShipment;
      if (s.origin && s.destination) {
        const a = toXY(s.origin.lat, s.origin.lon);
        const b = toXY(s.destination.lat, s.destination.lon);
        ctx.strokeStyle = 'rgba(129,140,248,0.45)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (Array.isArray(s.actualRoute) && s.actualRoute.length > 1) {
        ctx.strokeStyle = 'rgba(34,211,238,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        s.actualRoute.forEach((pt, i) => {
          const xy = toXY(pt.lat, pt.lon);
          if (i === 0) ctx.moveTo(xy.x, xy.y); else ctx.lineTo(xy.x, xy.y);
        });
        ctx.stroke();
      }
    }

    // Markers
    for (const p of points) {
      const xy = toXY(p.lat, p.lon);
      let color = '#22d3ee';
      let r = 5;
      if (p.kind === 'origin') { color = '#34d399'; r = 6; }
      else if (p.kind === 'dest') { color = '#f87171'; r = 6; }
      else if (p.kind === 'tele') { color = 'rgba(251,191,36,0.5)'; r = 2; }
      else if (p.selected) { color = '#fbbf24'; r = 8; }
      ctx.beginPath();
      ctx.arc(xy.x, xy.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (p.selected) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Legend
    ctx.fillStyle = '#8b98b8';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('Origen', 16, h - 36);
    ctx.fillStyle = '#34d399'; ctx.beginPath(); ctx.arc(10, h - 40, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8b98b8'; ctx.fillText('Destino', 16, h - 20);
    ctx.fillStyle = '#f87171'; ctx.beginPath(); ctx.arc(10, h - 24, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8b98b8'; ctx.fillText('Actual / ruta', 90, h - 36);
    ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(84, h - 40, 4, 0, Math.PI * 2); ctx.fill();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- Init shell HTML if section exists ----------
  function ensureShell() {
    const section = document.getElementById('tracking');
    if (!section || section.dataset.tsReady) return;
    section.dataset.tsReady = '1';
    section.innerHTML =
      '<div class="ts-ide">' +
      '  <div class="ts-topbar">' +
      '    <div class="ts-topbar-left"><strong>TRACKING STUDIO</strong> <span class="muted small">Logística · IoT · Analítica</span></div>' +
      '    <div class="ts-topbar-right" id="ts-mode-indicator"></div>' +
      '  </div>' +
      '  <div class="ts-body">' +
      '    <aside class="ts-explorer">' +
      '      <div class="ts-panel-head">PROJECT EXPLORER' +
      '        <button type="button" class="btn btn-sm btn-primary" id="ts-btn-new-project" title="Nuevo proyecto">+</button>' +
      '      </div>' +
      '      <div id="ts-explorer-list" class="ts-panel-body"></div>' +
      '      <div class="ts-panel-head">SHIPMENTS' +
      '        <button type="button" class="btn btn-sm" id="ts-btn-new-shipment" title="Nuevo envío">+</button>' +
      '      </div>' +
      '      <div id="ts-ship-list" class="ts-panel-body"></div>' +
      '    </aside>' +
      '    <main class="ts-main">' +
      '      <div class="ts-toolbar">' +
      '        <span id="ts-ws-title">Tracking Studio</span>' +
      '        <div class="ts-toolbar-actions">' +
      '          <span class="ts-tb-group muted small">Vista</span>' +
      '          <button type="button" class="btn btn-sm" data-ts-view="map">Mapa</button>' +
      '          <button type="button" class="btn btn-sm" data-ts-view="list">Envíos</button>' +
      '          <button type="button" class="btn btn-sm" data-ts-view="events">Eventos</button>' +
      '          <button type="button" class="btn btn-sm" data-ts-view="devices">Devices</button>' +
      '          <span class="ts-tb-group muted small">Analítica</span>' +
      '          <button type="button" class="btn btn-sm" data-ts-view="alerts">Alertas</button>' +
      '          <button type="button" class="btn btn-sm" data-ts-view="smart">Smart</button>' +
      '          <button type="button" class="btn btn-sm" data-ts-view="dashboard">KPIs</button>' +
      '          <button type="button" class="btn btn-sm btn-primary" data-ts-view="predictive">Predictivo</button>' +
      '          <span class="ts-tb-group muted small">Más</span>' +
      '          <button type="button" class="btn btn-sm" data-ts-view="rules">Reglas</button>' +
      '          <button type="button" class="btn btn-sm" data-ts-view="resources">Recursos</button>' +
      '          <button type="button" class="btn btn-sm" data-ts-view="analytics">Analytics</button>' +
      '          <button type="button" class="btn btn-sm" id="ts-btn-device">+ Device</button>' +
      '          <button type="button" class="btn btn-sm" id="ts-btn-telemetry">+ Sample</button>' +
      '          <button type="button" class="btn btn-sm btn-primary" id="ts-btn-worker">Start Worker</button>' +
      '          <button type="button" class="btn btn-sm" id="ts-btn-stop-workers">Stop Workers</button>' +
      '          <button type="button" class="btn btn-sm" id="ts-btn-evaluate">Evaluate</button>' +
      '          <button type="button" class="btn btn-sm btn-primary" id="ts-btn-smart-eval">Smart Eval</button>' +
      '          <button type="button" class="btn btn-sm" id="ts-btn-advance">Avanzar estado</button>' +
      '        </div>' +
      '      </div>' +
      '      <div id="ts-map-pane" class="ts-pane"><canvas id="ts-map-canvas"></canvas></div>' +
      '      <div id="ts-list-pane" class="ts-pane hidden">' +
      '        <table class="ts-table"><thead><tr><th>Tracking</th><th>Status</th><th>Carrier</th><th>Location</th><th>Origin</th><th>Destination</th></tr></thead>' +
      '        <tbody id="ts-list-body"></tbody></table>' +
      '      </div>' +
      '      <div id="ts-events-pane" class="ts-pane hidden"><div id="ts-events-body"></div></div>' +
      '      <div id="ts-devices-pane" class="ts-pane hidden"><div id="ts-devices-body"></div></div>' +
      '      <div id="ts-resources-pane" class="ts-pane hidden"><div id="ts-resources-body"></div></div>' +
      '      <div id="ts-alerts-pane" class="ts-pane hidden"><div id="ts-alerts-body"></div></div>' +
      '      <div id="ts-analytics-pane" class="ts-pane hidden"><div id="ts-analytics-body"></div></div>' +
      '      <div id="ts-dashboard-pane" class="ts-pane hidden"><div id="ts-dashboard-body"></div></div>' +
      '      <div id="ts-rules-pane" class="ts-pane hidden"><div id="ts-rules-body"></div></div>' +
      '      <div id="ts-smart-pane" class="ts-pane hidden"><div id="ts-smart-body"></div></div>' +
      '      <div id="ts-predictive-pane" class="ts-pane hidden"><div id="ts-predictive-body"></div></div>' +
      '    </main>' +
      '    <aside class="ts-inspector">' +
      '      <div class="ts-panel-head">INSPECTOR</div>' +
      '      <div id="ts-inspector-body" class="ts-panel-body"></div>' +
      '    </aside>' +
      '  </div>' +
      '  <div class="ts-console">' +
      '    <div class="ts-panel-head">CONSOLE / ALERTS / ENGINE</div>' +
      '    <div id="ts-console-log" class="ts-console-log"></div>' +
      '  </div>' +
      '</div>';

    document.getElementById('ts-btn-new-project').addEventListener('click', createProject);
    document.getElementById('ts-btn-new-shipment').addEventListener('click', createShipment);
    document.getElementById('ts-btn-telemetry').addEventListener('click', addTelemetrySample);
    document.getElementById('ts-btn-advance').addEventListener('click', advanceStatus);
    document.getElementById('ts-btn-device').addEventListener('click', createDevice);
    document.getElementById('ts-btn-worker').addEventListener('click', startWorkerForSelection);
    document.getElementById('ts-btn-stop-workers').addEventListener('click', stopAllWorkers);
    document.getElementById('ts-btn-evaluate').addEventListener('click', evaluateSelected);
    document.getElementById('ts-btn-smart-eval').addEventListener('click', evaluateSmartSelected);
    section.querySelectorAll('[data-ts-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.view = btn.getAttribute('data-ts-view');
        renderWorkspace();
      });
    });
    window.addEventListener('resize', () => { if (state.view === 'map') drawMap(); });
    tryElectronWorkers();
  }

  function onSectionShow() {
    ensureShell();
    updateModeIndicator();
    loadProjects();
  }

  // Hook into app navigation
  function tryInit() {
    ensureShell();
    const section = document.getElementById('tracking');
    if (!section) return;
    // Observe when section becomes active
    const obs = new MutationObserver(() => {
      if (section.classList.contains('active')) onSectionShow();
    });
    obs.observe(section, { attributes: true, attributeFilter: ['class'] });
    if (section.classList.contains('active')) onSectionShow();

    // Also listen hash / custom events
    document.addEventListener('iphub:section', (e) => {
      if (e.detail === 'tracking') onSectionShow();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }

  // Export for app.js routing if needed
  window.TrackingStudio = {
    refresh: loadProjects,
    selectProject,
    state,
    workerPool,
    startWorker: startWorkerForSelection,
    stopWorkers: stopAllWorkers,
  };
})();
