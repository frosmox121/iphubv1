/* ============================================================================
 * TRACKING STUDIO — Backend del IDE de logística (módulo nuevo, independiente
 * del Virtual Lab pero conectado por el Bridge /api/tracking/bridge).
 *
 * Implementa (prompt maestro "hace esto con el github dado.txt"):
 *  - Project system (#6), Shipment engine (#7), Consignment (#8)
 *  - Tracking Event engine append-only con hash chain (#9)
 *  - Telemetry engine + sensor emulation (#10,#12) con ingestión en lote
 *  - IoT Device lab (#11), Routes (#17), Geofences (#18), Cold Chain (#20)
 *  - Chain of Custody (#22), Delivery Proof (#23)
 *  - Carrier adapters REST/SOAP/EDI/Mock con estado claro (#24,#83)
 *  - Webhook Lab sandbox (#25), Replay engine (#27)
 *  - Snapshots (#28), Scenario branching (#29), Simulation runner (#30),
 *    Stress testing (#31), Failure simulation (#32)
 *  - Virtual Lab Bridge desacoplado por interfaz (#33..#36,#72,#87):
 *    funciona sin app de escritorio (modo standalone con fallback simulado)
 *  - Network Trace físico+digital (#35), Incidentes/Alertas/Risk (#42..#44)
 *  - Code Intelligence + Secret detection sobre los repos existentes (#37..#39)
 *  - Resource monitor con límites (#14), Audit (#48), Import/Export (#50),
 *    Reports (#51), Demo project "Global Cold Chain Demo" (#66) y
 *    Sample scenario "Cold Chain Failure" (#67)
 *
 * Reglas respetadas: no se toca Virtual Lab ni entidades existentes; se
 * reutilizan devices del agente (Hosts virtuales) y repos de server-code.
 * Todo lo simulado se marca SIMULATED; nada golpea sistemas externos (#84,#85).
 * ==========================================================================*/
'use strict';
const crypto = require('crypto');
const { makeBus, appendEvent, verifyChain } = require('./tracking/core');

// ---------- Catálogos (modales del dominio) ----------
const MODES = ['REAL', 'SIMULATED', 'REPLAY', 'HYBRID'];
const SHIP_STATUSES = ['LABEL_CREATED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_FACILITY', 'CUSTOMS_CLEARANCE', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNED', 'CANCELLED'];
const EVENT_SOURCES = ['PHYSICAL_SCAN', 'RFID', 'IOT', 'GPS', 'CARRIER_API', 'WEBHOOK', 'ESTIMATED', 'SIMULATED', 'MANUAL', 'REPLAY'];
const TRANSPORT_MODES = ['Road', 'Rail', 'Sea', 'Air', 'Intermodal', 'Last Mile'];
const GEOFENCE_TYPES = ['Circle', 'Polygon', 'Corridor', 'Radius', 'Restricted Zone', 'Cold Chain Zone', 'Custom Zone'];
const SENSOR_MODELS = ['Constant', 'Random', 'Gaussian', 'Sinusoidal', 'Historical Replay', 'Route Based', 'Weather Based', 'Failure Injection'];
const FAILURE_KINDS = ['Gateway Offline', 'GPS Loss', 'Cellular Loss', 'Satellite Loss', 'Carrier API Offline', 'Webhook Timeout', 'Database Slowdown', 'Sensor Battery Low', 'Temperature Failure', 'Hub Closure', 'Route Closure', 'Border Closure', 'Vehicle Breakdown'];
const NODE_TYPES = ['Factory', 'Warehouse', 'Hub', 'Port', 'Airport', 'Customs', 'Locker', 'Customer', 'Vehicle', 'Container', 'Pallet', 'Shipment', 'IoT Device', 'Gateway'];
const CUSTODY_OPS = ['Created by', 'Picked up by', 'Transferred by', 'Stored by', 'Loaded by', 'Transported by', 'Delivered by'];
const SECRET_PATTERNS = [
  { name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'Google API Key', re: /AIza[0-9A-Za-z\-_]{35}/g },
  { name: 'GitHub Token', re: /ghp_[0-9a-zA-Z]{36}/g },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g },
  { name: 'Private Key', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Connection String', re: /(mongodb|postgres(ql)?|mysql|redis):\/\/[^\s"']{6,}/gi },
  { name: 'API Key asignada', re: /\b(api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/gi },
];

module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit } = ctx;

  // DB separada del resto: clave 'tracking' → { projects: {uid: {...}} }
  db.defaults({ tracking: {} }).write();
  const bus = makeBus();

  const uidOf = u => String(u.id);
  const store = u => {
    const all = db.get('tracking').value() || {};
    let p = all[uidOf(u)];
    if (!p) {
      p = { projects: [], activeProject: null, events: {}, seq: 0 };
      all[uidOf(u)] = p; db.set('tracking', all).write();
    }
    return p;
  };
  const saveStore = (u, s) => { const all = db.get('tracking').value() || {}; all[uidOf(u)] = s; db.set('tracking', all).write(); };
  const proj = (s, pid) => s.projects.find(p => p.id === pid);
  const evts = (s, pid) => (s.events[pid] = s.events[pid] || []);
  const nowISO = () => new Date().toISOString();
  const rid = () => crypto.randomUUID();
  const clampInt = (v, d, min, max) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d; };
  const str = (v, d = '', max = 200) => String(v ?? d).slice(0, max);

  // ---------- Geo helpers ----------
  const haversineKm = (a, b) => {
    if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
    const R = 6371, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  function pointInPoly(lat, lon, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].lat, yi = pts[i].lon, xj = pts[j].lat, yj = pts[j].lon;
      if (((yi > lon) !== (yj > lon)) && (lat < (xj - xi) * (lon - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
    }
    return inside;
  }
  const inGeofence = (gf, lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (gf.type === 'Polygon') return Array.isArray(gf.points) && pointInPoly(lat, lon, gf.points);
    const c = gf.center || {}, r = Number(gf.radiusKm) || 0;
    const d = haversineKm(c, { lat, lon });
    return d != null && d <= r;
  };

  // ---------- Alert / Incident / Risk ----------
  function createAlert(s, u, pid, { severity = 'medium', title = '', detail = '', shipmentId = null, kind = 'generic' }) {
    const P = proj(s, pid); if (!P) return null;
    const a = { id: rid(), ts: nowISO(), severity, title: str(title, '', 160), detail: str(detail, '', 600), shipmentId, kind, ack: false, mode: P.mode };
    P.alerts.unshift(a); if (P.alerts.length > 2000) P.alerts.length = 2000;
    appendEvent(evts(s, pid), pid, 'alert', { alertId: a.id, title: a.title, severity });
    bus.emit('alert.created', a);
    return a;
  }
  function riskScore(P, shipment) {
    let score = 10;
    if (shipment.riskCategory === 'HAZMAT' || shipment.riskCategory === 'HIGH_VALUE') score += 20;
    if (shipment.temperatureRequired) score += 10;
    const exc = (P.excursions || []).filter(e => e.shipmentId === shipment.id);
    score += Math.min(40, exc.length * 8);
    const al = P.alerts.filter(a => a.shipmentId === shipment.id && !a.ack);
    score += Math.min(25, al.length * 5);
    if (shipment.status === 'EXCEPTION') score += 15;
    if (P.incidents.some(i => (i.shipmentIds || []).includes(shipment.id) && i.state === 'open')) score += 10;
    return { score: Math.min(100, score), level: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low', factors: { excursions: exc.length, openAlerts: al.length } };
  }

  // ---------- Geofence + cold chain sobre telemetría ----------
  function processTelemetryPoint(s, u, pid, dev, read) {
    const P = proj(s, pid); if (!P) return;
    const sh = P.shipments.find(x => x.id === dev.shipmentId);
    // GPS: actualizar ubicación + geofences
    if (read.gps && Number.isFinite(read.gps.lat)) {
      const insideNow = P.geofences.filter(gf => inGeofence(gf, read.gps.lat, read.gps.lon)).map(gf => gf.id);
      const wasInside = dev._inside || [];
      for (const gfId of insideNow.filter(i => !wasInside.includes(i))) {
        const gf = P.geofences.find(g => g.id === gfId);
        appendEvent(evts(s, pid), pid, 'geofence', { event: 'ENTER', geofenceId: gfId, name: gf?.name, deviceId: dev.id, lat: read.gps.lat, lon: read.gps.lon });
        bus.emit('geofence.enter', { gfId, dev: dev.id });
      }
      for (const gfId of wasInside.filter(i => !insideNow.includes(i))) {
        const gf = P.geofences.find(g => g.id === gfId);
        appendEvent(evts(s, pid), pid, 'geofence', { event: 'EXIT', geofenceId: gfId, name: gf?.name, deviceId: dev.id });
        bus.emit('geofence.exit', { gfId, dev: dev.id });
      }
      dev._inside = insideNow;
      dev.lastPing = read.timestamp; dev.lastLocation = read.gps;
      if (sh) {
        sh.currentLocation = { lat: read.gps.lat, lon: read.gps.lon, at: read.timestamp };
        sh.actualRoute = (sh.actualRoute || []).concat([{ lat: read.gps.lat, lon: read.gps.lon, at: read.timestamp }]).slice(-500);
        bus.emit('shipment.location_changed', { shipmentId: sh.id });
      }
    }
    // Cold chain: temperature excursion (regla IF temp > max AND COLD_CHAIN → alerta + excepción)
    if (sh && sh.temperatureRequired && Number.isFinite(read.temperature)) {
      const { min = -30, max = 30 } = sh.temperatureRequired;
      if (read.temperature > max || read.temperature < min) {
        P.excursions = P.excursions || [];
        const open = P.excursions.find(e => e.shipmentId === sh.id && !e.closedAt);
        if (!open) P.excursions.unshift({ id: rid(), shipmentId: sh.id, startedAt: read.timestamp, min, max, observed: read.temperature, closedAt: null });
        else open.observed = read.temperature;
        if (!P.alerts.some(a => a.kind === 'cold_chain' && a.shipmentId === sh.id && !a.ack)) {
          createAlert(s, u, pid, { severity: 'high', kind: 'cold_chain', shipmentId: sh.id, title: `Excursión térmica ${read.temperature}°C (rango ${min}..${max}°C)`, detail: `Envío ${sh.trackingNumber}. Se recomienda hub alternativo.` });
          if (sh.status !== 'DELIVERED') sh.status = 'EXCEPTION';
        }
        bus.emit('telemetry.anomaly', { deviceId: dev.id, type: 'temperature', value: read.temperature });
      }
    }
    // Impacto / batería baja
    if (Number.isFinite(read.impactG) && read.impactG > 4) createAlert(s, u, pid, { severity: 'medium', kind: 'impact', shipmentId: sh?.id, title: `Impacto ${read.impactG}g`, detail: `Dispositivo ${dev.id}` });
    if (Number.isFinite(read.battery) && read.battery <= 10) {
      if (!P.alerts.some(a => a.kind === 'battery' && a.detail === dev.id && !a.ack)) createAlert(s, u, pid, { severity: 'low', kind: 'battery', title: 'Batería crítica', detail: dev.id });
    }
  }

  // ---------- Simulación determinística (seed) ----------
  function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ---------- Virtual Lab Bridge (interfaz desacoplada #33/#72/#87) ----------
  // Fuente de hosts: dispositivos reales publicados por el agente (db.devices por IP del usuario)
  const bridge = {
    status: () => {
      const devs = (db.get('devices').value() || []);
      const online = devs.filter(d => d.online);
      return { connected: online.length > 0, transport: online.length ? 'IPC/agent-snapshot' : 'none', fallback: 'simulated', hosts: devs.length, online: online.length, since: null };
    },
    listVirtualHosts: () => (db.get('devices').value() || []).map(d => ({ id: d.id, ip: d.ip, mac: d.mac, alias: d.alias || d.ip, online: !!d.online, source: 'agent' })),
    listGateways: () => {
      const st = bridge.status();
      if (st.connected) return [{ id: 'gw-agent', name: 'Gateway del agente', type: 'Cellular/Local', online: true }];
      return [{ id: 'gw-sim-1', name: 'Gateway virtual (fallback)', type: 'MQTT', online: true, simulated: true }];
    },
    listNetworks: () => [{ id: 'net-lab', cidr: '10.20.0.0/24', name: 'Red del laboratorio', simulated: true }],
    listFirewalls: () => [{ id: 'fw-1', name: 'Firewall perimetral LAB', rules: 3, simulated: true }],
    getNetworkState: () => ({ networks: bridge.listNetworks(), gateways: bridge.listGateways(), hosts: bridge.listVirtualHosts().length }),
  };

  // ---------- Validadores ----------
  function validShipment(b) {
    const errors = [];
    const out = {
      id: b.id || rid(),
      trackingNumber: str(b.trackingNumber || ('TS' + Date.now().toString(36).toUpperCase()), '', 40),
      barcode: str(b.barcode || '', '', 64), qr: str(b.qr || '', '', 64), rfidEpc: str(b.rfidEpc || '', '', 64),
      status: SHIP_STATUSES.includes(b.status) ? b.status : 'LABEL_CREATED',
      origin: str(b.origin, '', 120), destination: str(b.destination, '', 120),
      currentLocation: (b.currentLocation && Number.isFinite(+b.currentLocation.lat)) ? { lat: +b.currentLocation.lat, lon: +b.currentLocation.lon, at: nowISO() } : null,
      plannedRoute: Array.isArray(b.plannedRoute) ? b.plannedRoute.slice(0, 200).map(p => ({ lat: +p.lat, lon: +p.lon })).filter(p => Number.isFinite(p.lat)) : [],
      actualRoute: [],
      carrier: str(b.carrier, '', 60), serviceLevel: str(b.serviceLevel, 'STANDARD', 30), priority: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(b.priority) ? b.priority : 'NORMAL',
      weightKg: Math.max(0, +b.weightKg || 0), volumeM3: Math.max(0, +b.volumeM3 || 0),
      dimensions: { l: +((b.dimensions || {}).l) || 0, w: +((b.dimensions || {}).w) || 0, h: +((b.dimensions || {}).h) || 0 },
      declaredValue: Math.max(0, +b.declaredValue || 0),
      riskCategory: ['GENERAL', 'COLD_CHAIN', 'HAZMAT', 'HIGH_VALUE'].includes(b.riskCategory) ? b.riskCategory : 'GENERAL',
      temperatureRequired: b.temperatureRequired ? { min: +b.temperatureRequired.min ?? -30, max: +b.temperatureRequired.max ?? 30, target: +b.temperatureRequired.target ?? 5, maxExposureMin: clampInt(b.temperatureRequired.maxExposureMin, 60, 1, 100000), humidityRange: str(b.temperatureRequired.humidityRange, '', 40) } : null,
      consignmentId: b.consignmentId || null,
      createdAt: b.createdAt || nowISO(), updatedAt: nowISO(),
    };
    if (!out.origin) errors.push('origin requerido');
    if (!out.destination) errors.push('destination requerido');
    return { ok: !errors.length, errors, out };
  }

  // =========================== Rutas HTTP ===========================
  const wrap = fn => (req, res) => { try { fn(req, res); } catch (e) { console.error('[tracking]', e.message); res.status(500).json({ error: 'Error interno de Tracking Studio' }); } };

  // ---- Estado / catálogo (para UI y command palette) ----
  app.get('/api/tracking/state', requireAuth, wrap((req, res) => {
    const s = store(req.user);
    const P = s.activeProject ? proj(s, s.activeProject) : null;
    res.json({
      modes: MODES, statuses: SHIP_STATUSES, sources: EVENT_SOURCES, transportModes: TRANSPORT_MODES,
      geofenceTypes: GEOFENCE_TYPES, sensorModels: SENSOR_MODELS, failures: FAILURE_KINDS, nodeTypes: NODE_TYPES, custodyOps: CUSTODY_OPS,
      events: bus.list(), bridge: bridge.status(),
      projects: s.projects.map(p => ({ id: p.id, name: p.name, mode: p.mode, shipments: p.shipments.length, devices: p.devices.length, routes: p.routes.length, geofences: p.geofences.length, alerts: p.alerts.filter(a => !a.ack).length, incidents: p.incidents.filter(i => i.state === 'open').length, snapshots: p.snapshots.length, scenarios: p.scenarios.length })),
      active: P ? { id: P.id, name: P.name, mode: P.mode } : null,
    });
  }));

  // ---- Projects (#6) ----
  app.post('/api/tracking/projects', requireAuth, wrap((req, res) => {
    const s = store(req.user);
    const name = str(req.body.name, '', 80).trim(); if (!name) return res.status(400).json({ error: 'Nombre de proyecto requerido' });
    const P = {
      id: rid(), name, mode: MODES.includes(req.body.mode) ? req.body.mode : 'SIMULATED', createdAt: nowISO(),
      shipments: [], consignments: [], devices: [], nodes: [], routes: [], geofences: [], vehicles: [], hubs: [],
      telemetryIndex: { count: 0, last: null }, alerts: [], incidents: [], excursions: [], proofs: [], custody: [],
      carriers: [
        { id: 'dhl', name: 'DHL', adapter: 'REST', env: 'mock', status: 'MOCK' },
        { id: 'fedex', name: 'FedEx', adapter: 'REST', env: 'mock', status: 'MOCK' },
        { id: 'ups', name: 'UPS', adapter: 'GraphQL', env: 'mock', status: 'MOCK' },
        { id: 'usps', name: 'USPS', adapter: 'REST', env: 'mock', status: 'MOCK' },
        { id: 'correos', name: 'Correo Argentino', adapter: 'Webhook', env: 'mock', status: 'MOCK' },
      ],
      webhooks: [], simulations: [], snapshots: [], scenarios: [], traces: [], reports: [], integrations: [],
    };
    s.projects.push(P); s.activeProject = P.id; saveStore(req.user, s);
    appendEvent(evts(s, P.id), P.id, 'system', { action: 'project.created', name });
    addAudit(req.user.email, 'Tracking Studio', `Proyecto creado: ${name}`);
    res.json({ id: P.id, name: P.name, mode: P.mode });
  }));
  app.put('/api/tracking/projects/:id', requireAuth, wrap((req, res) => {
    const s = store(req.user), P = proj(s, req.params.id); if (!P) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (req.body.name) P.name = str(req.body.name, P.name, 80);
    if (MODES.includes(req.body.mode)) P.mode = req.body.mode; // aislamiento REAL/SIMULATED/REPLAY/HYBRID (#5,#61)
    if (req.body.activate) s.activeProject = P.id;
    saveStore(req.user, s); res.json({ ok: true, mode: P.mode, name: P.name });
  }));
  app.post('/api/tracking/projects/:id/duplicate', requireAuth, wrap((req, res) => {
    const s = store(req.user), P = proj(s, req.params.id); if (!P) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const C = JSON.parse(JSON.stringify(P)); C.id = rid(); C.name = P.name + ' (copia)'; C.createdAt = nowISO();
    s.projects.push(C); saveStore(req.user, s); s.events[s.activeProject] = s.events[s.activeProject] || [];
    res.json({ id: C.id, name: C.name });
  }));
  app.delete('/api/tracking/projects/:id', requireAuth, wrap((req, res) => {
    const s = store(req.user);
    s.projects = s.projects.filter(p => p.id !== req.params.id); delete s.events[req.params.id];
    if (s.activeProject === req.params.id) s.activeProject = s.projects[0]?.id || null;
    saveStore(req.user, s); res.json({ ok: true });
  }));
  app.get('/api/tracking/projects/:id/export', requireAuth, wrap((req, res) => {
    const s = store(req.user), P = proj(s, req.params.id); if (!P) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.setHeader('Content-Disposition', `attachment; filename="tracking-project-${P.id.slice(0, 8)}.json"`);
    res.json({ format: 'iphub-tracking-export', version: 1, exportedAt: nowISO(), mode: P.mode, project: P, events: (s.events[P.id] || []).slice(-5000) });
  }));
  app.post('/api/tracking/projects/import', requireAuth, wrap((req, res) => {
    const b = req.body || {};
    if (b.format !== 'iphub-tracking-export' || !b.project || !Array.isArray(b.project.shipments)) return res.status(400).json({ error: 'JSON de exportación inválido (format iphub-tracking-export)' });
    const s = store(req.user);
    const P = b.project; P.id = rid(); // nunca pisar el proyecto padre
    s.projects.push(P); s.activeProject = P.id; s.events[P.id] = Array.isArray(b.events) ? b.events : [];
    saveStore(req.user, s); addAudit(req.user.email, 'Tracking Studio', `Proyecto importado: ${P.name}`);
    res.json({ id: P.id, name: P.name });
  }));

  // helper proyecto activo
  const AP = req => { const s = store(req.user); const pid = str(req.query.project || req.body?.project || s.activeProject, '', 60); const P = pid ? proj(s, pid) : null; return { s, P, pid }; };
  const needP = (req, res) => { const c = AP(req); if (!c.P) { res.status(400).json({ error: 'Primero creá o seleccioná un proyecto de Tracking Studio.' }); return null; } return c; };

  // ---- Shipments (#7) + eventos (#9) ----
  app.get('/api/tracking/shipments', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const q = str(req.query.q, '', 60).toLowerCase();
    let list = c.P.shipments;
    if (q) list = list.filter(sh => (sh.trackingNumber + ' ' + sh.origin + ' ' + sh.destination + ' ' + sh.status).toLowerCase().includes(q));
    if (req.query.status) list = list.filter(sh => sh.status === req.query.status);
    const page = clampInt(req.query.page, 1, 1, 100000), size = clampInt(req.query.size, 50, 1, 500); // paginado p/ virtualización (#86)
    res.json({ total: list.length, page, size, mode: c.P.mode, shipments: list.slice((page - 1) * size, page * size).map(sh => ({ ...sh, risk: riskScore(c.P, sh) })) });
  }));
  app.post('/api/tracking/shipments', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const v = validShipment(req.body || {}); if (!v.ok) return res.status(400).json({ error: v.errors.join(', ') });
    c.P.shipments.unshift(v.out);
    appendEvent(evts(c.s, c.pid), c.pid, 'shipment', { shipmentId: v.out.id, trackingNumber: v.out.trackingNumber, eventType: 'LABEL_CREATED', source: c.P.mode === 'SIMULATED' ? 'SIMULATED' : 'MANUAL', status: v.out.status });
    bus.emit('shipment.created', v.out); saveStore(req.user, c.s);
    addAudit(req.user.email, 'Tracking Studio', `Envío creado ${v.out.trackingNumber}`);
    res.json(v.out);
  }));
  app.put('/api/tracking/shipments/:id', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const sh = c.P.shipments.find(x => x.id === req.params.id); if (!sh) return res.status(404).json({ error: 'Envío no encontrado' });
    const allowed = ['status', 'carrier', 'priority', 'serviceLevel', 'riskCategory', 'consignmentId', 'weightKg', 'declaredValue'];
    const changed = {};
    for (const k of allowed) if (req.body[k] !== undefined) { if (k === 'status' && !SHIP_STATUSES.includes(req.body[k])) continue; sh[k] = req.body[k]; changed[k] = req.body[k]; }
    sh.updatedAt = nowISO();
    if (changed.status) appendEvent(evts(c.s, c.pid), c.pid, 'shipment', { shipmentId: sh.id, trackingNumber: sh.trackingNumber, eventType: changed.status, source: 'MANUAL', status: changed.status, latitude: sh.currentLocation?.lat, longitude: sh.currentLocation?.lon });
    bus.emit('shipment.updated', sh); saveStore(req.user, c.s);
    res.json(sh);
  }));
  app.get('/api/tracking/shipments/:id', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const sh = c.P.shipments.find(x => x.id === req.params.id); if (!sh) return res.status(404).json({ error: 'Envío no encontrado' });
    // PACKAGE ASSET SHEET (#21)
    const dev = c.P.devices.find(d => d.shipmentId === sh.id);
    const proof = c.P.proofs.find(p => p.shipmentId === sh.id);
    const custody = c.P.custody.filter(cv => cv.shipmentId === sh.id);
    res.json({
      package: { trackingId: sh.trackingNumber, barcode: sh.barcode, qr: sh.qr, rfid: sh.rfidEpc, sensorUuid: dev?.uuid || null },
      origin: sh.origin, destination: sh.destination, weight: sh.weightKg, volume: sh.volumeM3, dimensions: sh.dimensions,
      currentLocation: sh.currentLocation, currentStatus: sh.status, carrier: sh.carrier, vehicle: dev?.vehicleId || null,
      temperature: dev?.lastTelemetry?.temperature ?? null, humidity: dev?.lastTelemetry?.humidity ?? null, battery: dev?.battery ?? null,
      networkHost: dev?.virtualHostId ? { hostId: dev.virtualHostId, gateway: dev.gatewayId || null } : null,
      risk: riskScore(c.P, sh), deliveryProof: proof || null, chainOfCustody: custody,
      events: c.s.events[c.pid].filter(e => e.shipmentId === sh.id).slice(-100),
    });
  }));

  // ---- Consignments (#8) ----
  app.post('/api/tracking/consignments', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const cg = { id: rid(), name: str(req.body.name, 'Consignment', 80), shipmentIds: (Array.isArray(req.body.shipmentIds) ? req.body.shipmentIds : []).slice(0, 500), history: [{ ts: nowISO(), action: 'created' }] };
    c.P.consignments.unshift(cg);
    for (const sid of cg.shipmentIds) { const sh = c.P.shipments.find(x => x.id === sid); if (sh) { sh.consignmentId = cg.id; cg.history.push({ ts: nowISO(), action: 'attach', shipmentId: sid }); } }
    saveStore(req.user, c.s); res.json(cg);
  }));
  app.post('/api/tracking/consignments/:id/move', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const from = c.P.consignments.find(x => x.id === req.params.id), to = c.P.consignments.find(x => x.id === req.body.toId);
    if (!from || !to) return res.status(404).json({ error: 'Consignment origen/destino no encontrado' });
    const sid = str(req.body.shipmentId, '', 60);
    if (!from.shipmentIds.includes(sid)) return res.status(400).json({ error: 'El envío no está en el consignment origen' });
    from.shipmentIds = from.shipmentIds.filter(x => x !== sid); to.shipmentIds.push(sid);
    const sh = c.P.shipments.find(x => x.id === sid); if (sh) sh.consignmentId = to.id;
    from.history.push({ ts: nowISO(), action: 'move-out', shipmentId: sid, to: to.id }); to.history.push({ ts: nowISO(), action: 'move-in', shipmentId: sid, from: from.id });
    appendEvent(evts(c.s, c.pid), c.pid, 'shipment', { shipmentId: sid, eventType: 'CONSIGNMENT_MOVED', source: 'MANUAL' });
    saveStore(req.user, c.s); res.json({ ok: true });
  }));

  // ---- Tracking Events raw (#9) + integridad ----
  app.get('/api/tracking/events', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const n = clampInt(req.query.limit, 200, 1, 2000);
    let list = c.s.events[c.pid] || [];
    if (req.query.shipmentId) list = list.filter(e => e.shipmentId === req.query.shipmentId);
    if (req.query.kind) list = list.filter(e => e.kind === req.query.kind);
    res.json({ total: list.length, events: list.slice(-n).reverse(), integrity: verifyChain(c.s.events[c.pid] || []) });
  }));

  // ---- Telemetría (#10) — ingestión en lote, sin bloquear, con backpressure (#13) ----
  const MAX_BATCH = 5000, MAX_TELEM_PER_PROJECT = 50000;
  app.post('/api/tracking/telemetry', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const reads = Array.isArray(req.body.reads) ? req.body.reads : [req.body.read];
    if (!reads.length) return res.status(400).json({ error: 'Leé telemetría: enviá { reads: [ ... ] }' });
    if (reads.length > MAX_BATCH) return res.status(413).json({ error: `Backpressure: máximo ${MAX_BATCH} lecturas por lote` });
    const t0 = Date.now(); let accepted = 0, anomalies = 0;
    const ring = (c.P.telemetryRing = c.P.telemetryRing || []);
    for (const r of reads) {
      const dev = c.P.devices.find(d => d.id === r.deviceId); if (!dev) continue;
      const read = { deviceId: dev.id, timestamp: str(r.timestamp || nowISO(), '', 40), gps: r.gps ? { lat: +r.gps.lat || 0, lon: +r.gps.lon || 0, altitude: +r.gps.altitude || 0, speed: +r.gps.speed || 0 } : null, temperature: Number.isFinite(+r.temperature) ? +r.temperature : null, humidity: Number.isFinite(+r.humidity) ? +r.humidity : null, light: Number.isFinite(+r.light) ? +r.light : null, impactG: Number.isFinite(+r.impactG) ? +r.impactG : null, battery: Number.isFinite(+r.battery) ? +r.battery : dev.battery, signal: Number.isFinite(+r.signal) ? +r.signal : null, source: c.P.mode === 'SIMULATED' ? 'SIMULATED' : (EVENT_SOURCES.includes(r.source) ? r.source : 'IOT') };
      ring.push(read); if (ring.length > MAX_TELEM_PER_PROJECT) ring.splice(0, ring.length - MAX_TELEM_PER_PROJECT);
      dev.lastTelemetry = read;
      const before = c.P.alerts.length;
      processTelemetryPoint(c.s, req.user, c.pid, dev, read);
      if (c.P.alerts.length > before) anomalies++;
      accepted++;
    }
    c.P.telemetryIndex.count += accepted; c.P.telemetryIndex.last = nowISO();
    appendEvent(evts(c.s, c.pid), c.pid, 'telemetry', { count: accepted, anomalies, ms: Date.now() - t0 });
    bus.emit('telemetry.received', { count: accepted });
    saveStore(req.user, c.s);
    res.json({ accepted, rejected: reads.length - accepted, anomalies, throughputPerSec: Math.round(accepted / Math.max(0.001, (Date.now() - t0) / 1000)), mode: c.P.mode });
  }));
  app.get('/api/tracking/telemetry', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const n = clampInt(req.query.limit, 300, 1, MAX_TELEM_PER_PROJECT);
    const ring = c.P.telemetryRing || [];
    res.json({ total: ring.length, reads: ring.slice(-n).reverse() });
  }));

  // ---- IoT Devices (#11) + Sensor Emulation (#12) ----
  app.get('/api/tracking/devices', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    res.json({ mode: c.P.mode, devices: c.P.devices.map(d => ({ ...d, _inside: undefined })) });
  }));
  app.post('/api/tracking/devices', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const b = req.body || {};
    const d = {
      id: rid(), name: str(b.name, 'tracker-' + (c.P.devices.length + 1), 60),
      type: ['GPS', 'RFID', 'BLE', 'CELLULAR', 'SATCOM', 'MULTI'].includes(b.type) ? b.type : 'GPS',
      imei: str(b.imei || String(Date.now()).slice(0, 14), '', 20), mac: str(b.mac || 'AA:BB:' + crypto.randomBytes(4).toString('hex').toUpperCase().replace(/(.{2})(?=.)/g, '$1:'), '', 20),
      uuid: str(b.uuid || crypto.randomUUID(), '', 40), epc: str(b.epc || 'EPC-' + crypto.randomBytes(4).toString('hex').toUpperCase(), '', 40),
      firmware: str(b.firmware || 'ts-fw 1.0.0', '', 40), battery: clampInt(b.battery, 100, 0, 100), bufferMax: clampInt(b.bufferMax, 5000, 10, 1000000), buffer: [],
      protocol: str(b.protocol || 'MQTT', '', 30), carrier: str(b.carrier || '', '', 40), gatewayId: str(b.gatewayId || '', '', 40) || null,
      shipmentId: b.shipmentId || null, virtualHostId: b.virtualHostId || null,
      sensor: { model: SENSOR_MODELS.includes(b.sensor?.model) ? b.sensor.model : 'Gaussian', intervalSec: clampInt(b.sensor?.intervalSec, 2, 1, 3600), noisePct: clampInt(b.sensor?.noisePct, 3, 0, 100), batteryDrainPerHour: (+b.sensor?.batteryDrainPerHour || 0.2), signalLoss: str(b.sensor?.signalLoss || 'None', '', 20), network: str(b.sensor?.network || 'Cellular', '', 20) },
      state: 'ONLINE', lastPing: null, lastLocation: null, _inside: [], createdAt: nowISO(),
    };
    c.P.devices.unshift(d);
    appendEvent(evts(c.s, c.pid), c.pid, 'device', { deviceId: d.id, event: 'connected', type: d.type });
    bus.emit('device.connected', d); saveStore(req.user, c.s);
    res.json(d);
  }));
  app.put('/api/tracking/devices/:id', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const d = c.P.devices.find(x => x.id === req.params.id); if (!d) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    for (const k of ['shipmentId', 'virtualHostId', 'gatewayId']) if (req.body[k] !== undefined) d[k] = req.body[k] || null;
    if (['ONLINE', 'OFFLINE', 'BUFFERING', 'FAULT'].includes(req.body.state)) d.state = req.body.state;
    saveStore(req.user, c.s); res.json(d);
  }));

  // ---- Hubs / Nodes / Vehicles / Routes (#15,#16,#17) ----
  app.get('/api/tracking/map', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    res.json({
      mode: c.P.mode,
      markers: [
        ...c.P.nodes.map(n => ({ kind: n.type, id: n.id, name: n.name, lat: n.lat, lon: n.lon, meta: n.meta || {} })),
        ...c.P.shipments.filter(s => s.currentLocation).map(s => ({ kind: 'Shipment', id: s.id, name: s.trackingNumber, lat: s.currentLocation.lat, lon: s.currentLocation.lon, meta: { status: s.status } })),
        ...c.P.devices.filter(d => d.lastLocation).map(d => ({ kind: 'IoT Device', id: d.id, name: d.name, lat: d.lastLocation.lat, lon: d.lastLocation.lon, meta: { battery: d.battery, state: d.state } })),
      ],
      routes: c.P.routes.map(r => ({ id: r.id, name: r.name, mode: r.transportMode, points: r.waypoints.map(w => ({ lat: w.lat, lon: w.lon })), status: r.status })),
      geofences: c.P.geofences,
      plannedVsActual: c.P.shipments.filter(s => s.plannedRoute.length && s.actualRoute.length).slice(0, 50).map(s => ({ id: s.id, trackingNumber: s.trackingNumber, planned: s.plannedRoute, actual: s.actualRoute.slice(-200) })),
    });
  }));
  app.post('/api/tracking/nodes', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const b = req.body || {};
    if (!NODE_TYPES.includes(b.type)) return res.status(400).json({ error: 'Tipo de nodo no válido' });
    const n = { id: rid(), type: b.type, name: str(b.name, b.type, 80), lat: +b.lat || 0, lon: +b.lon || 0, locked: !!b.locked, hidden: false, meta: typeof b.meta === 'object' ? b.meta : {} };
    c.P.nodes.push(n); saveStore(req.user, c.s); res.json(n);
  }));
  app.put('/api/tracking/nodes/:id', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const n = c.P.nodes.find(x => x.id === req.params.id); if (!n) return res.status(404).json({ error: 'Nodo no encontrado' });
    if (n.locked && req.body.unlock !== true && (req.body.lat !== undefined || req.body.lon !== undefined)) return res.status(423).json({ error: 'Nodo bloqueado (desbloquealo primero)' });
    for (const k of ['name', 'lat', 'lon', 'hidden']) if (req.body[k] !== undefined) n[k] = k === 'name' ? str(req.body[k], n.name, 80) : req.body[k];
    if (req.body.lock === true) n.locked = true; if (req.body.lock === false) n.locked = false;
    saveStore(req.user, c.s); res.json(n);
  }));
  app.post('/api/tracking/routes', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const b = req.body || {};
    const wps = (Array.isArray(b.waypoints) ? b.waypoints : []).slice(0, 300).map(w => ({ lat: +w.lat || 0, lon: +w.lon || 0, etaMin: clampInt(w.etaMin, 0, 0, 1000000), name: str(w.name || '', '', 60) }));
    if (wps.length < 2) return res.status(400).json({ error: 'Una ruta necesita al menos 2 waypoints' });
    let dist = 0; for (let i = 1; i < wps.length; i++) dist += haversineKm(wps[i - 1], wps[i]) || 0;
    const SPEED = { Road: 70, Rail: 90, Sea: 35, Air: 780, Intermodal: 60, 'Last Mile': 25 }[b.transportMode] || 60;
    const r = { id: rid(), name: str(b.name, 'Ruta ' + (c.P.routes.length + 1), 80), transportMode: TRANSPORT_MODES.includes(b.transportMode) ? b.transportMode : 'Road', origin: wps[0], destination: wps[wps.length - 1], waypoints: wps, distanceKm: Math.round(dist * 10) / 10, etaHours: Math.round((dist / SPEED) * 10) / 10, estimatedCost: Math.round(dist * (b.costPerKm ?? 1.2) * 100) / 100, carrier: str(b.carrier || '', '', 60), risk: ['LOW', 'MEDIUM', 'HIGH'].includes(b.risk) ? b.risk : 'LOW', status: 'ACTIVE' };
    c.P.routes.push(r); saveStore(req.user, c.s); res.json(r);
  }));
  app.put('/api/tracking/routes/:id', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const r = c.P.routes.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ error: 'Ruta no encontrada' });
    if (['ACTIVE', 'CLOSED', 'DETOUR'].includes(req.body.status)) r.status = req.body.status;
    saveStore(req.user, c.s); res.json(r);
  }));

  // ---- Geofences (#18) ----
  app.get('/api/tracking/geofences', requireAuth, wrap((req, res) => { const c = needP(req, res); if (c) res.json({ geofences: c.P.geofences }); }));
  app.post('/api/tracking/geofences', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const b = req.body || {};
    if (!GEOFENCE_TYPES.includes(b.type)) return res.status(400).json({ error: 'Tipo de geofence no válido' });
    const gf = { id: rid(), name: str(b.name, 'Geofence', 80), type: b.type, center: b.center ? { lat: +b.center.lat || 0, lon: +b.center.lon || 0 } : null, radiusKm: clampInt(b.radiusKm, 5, 1, 5000), points: (Array.isArray(b.points) ? b.points : []).slice(0, 100).map(p => ({ lat: +p.lat || 0, lon: +p.lon || 0 })), rules: { maxSpeedKmh: clampInt(b.rules?.maxSpeedKmh, 120, 1, 500), tempMax: +b.rules?.tempMax ?? 8, dwellMin: clampInt(b.rules?.dwellMin, 30, 1, 100000) } };
    if (gf.type === 'Polygon' && gf.points.length < 3) return res.status(400).json({ error: 'Polygon necesita ≥3 puntos' });
    if (gf.type !== 'Polygon' && !gf.center) return res.status(400).json({ error: 'Este tipo necesita center {lat,lon}' });
    c.P.geofences.push(gf); saveStore(req.user, c.s); res.json(gf);
  }));

  // ---- Chain of Custody (#22) + Delivery Proof (#23) ----
  app.post('/api/tracking/custody', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const b = req.body || {};
    const sh = c.P.shipments.find(x => x.id === b.shipmentId); if (!sh) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!CUSTODY_OPS.includes(b.operation)) return res.status(400).json({ error: 'Operación no válida' });
    const rec = { id: rid(), shipmentId: sh.id, shipmentId: sh.id, operation: b.operation, operator: str(b.operator, '', 80), location: str(b.location, '', 120), event: str(b.event || b.operation, '', 120), evidence: str(b.evidence || '', '', 300), ts: nowISO() };
    rec.signature = crypto.createHash('sha256').update(JSON.stringify(rec)).digest('hex').slice(0, 32);
    c.P.custody.unshift(rec);
    appendEvent(evts(c.s, c.pid), c.pid, 'shipment', { shipmentId: sh.id, eventType: 'CUSTODY_' + b.operation.replace(/\s+/g, '_').toUpperCase(), source: 'MANUAL' });
    saveStore(req.user, c.s); res.json(rec);
  }));
  app.post('/api/tracking/proof', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const b = req.body || {};
    const sh = c.P.shipments.find(x => x.id === b.shipmentId); if (!sh) return res.status(404).json({ error: 'Envío no encontrado' });
    const p = { id: rid(), shipmentId: sh.id, method: ['signature', 'OTP', 'photo', 'timestamp'].includes(b.method) ? b.method : 'signature', signature: str(b.signature || '', '', 200), otpVerified: !!b.otpVerified, photoRef: str(b.photoRef || '', '', 200), operator: str(b.operator || '', '', 80), device: str(b.device || '', '', 80), gps: b.gps && Number.isFinite(+b.gps.lat) ? { lat: +b.gps.lat, lon: +b.gps.lon } : sh.currentLocation, ts: nowISO() };
    c.P.proofs.unshift(p); if (p.method === 'OTP' && !p.otpVerified) return res.status(400).json({ error: 'OTP no verificado: la prueba queda pendiente', proof: p });
    sh.status = 'DELIVERED';
    appendEvent(evts(c.s, c.pid), c.pid, 'shipment', { shipmentId: sh.id, eventType: 'DELIVERED', source: 'PHYSICAL_SCAN', proofId: p.id });
    saveStore(req.user, c.s); res.json(p);
  }));

  // ---- Carrier Integrations (#24) + Webhook Lab (#25) ----
  app.get('/api/tracking/carriers', requireAuth, wrap((req, res) => { const c = needP(req, res); if (c) res.json({ carriers: c.P.carriers.map(x => ({ ...x, note: x.status === 'MOCK' ? 'Adapter mock/sandbox: no contacta sistemas reales (#83).' : 'Configurado; requiere confirmación explícita para producción.' })) }); }));
  app.put('/api/tracking/carriers/:id', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const crr = c.P.carriers.find(x => x.id === req.params.id); if (!crr) return res.status(404).json({ error: 'Carrier no encontrado' });
    if (req.body.env === 'production' && req.body.confirm !== true) return res.status(428).json({ error: 'Confirmación explícita requerida para pasar a producción (#84).' });
    if (['mock', 'sandbox', 'production'].includes(req.body.env)) { crr.env = req.body.env; crr.status = req.body.env === 'production' ? 'CONFIGURED' : 'MOCK'; }
    if (['REST', 'GraphQL', 'SOAP', 'Webhook', 'EDI', 'Custom API'].includes(req.body.adapter)) crr.adapter = req.body.adapter;
    saveStore(req.user, c.s); addAudit(req.user.email, 'Tracking Studio', `Carrier ${crr.name} → ${crr.env}/${crr.adapter}`);
    res.json(crr);
  }));
  app.post('/api/tracking/webhooks/simulate', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const b = req.body || {};
    const actions = ['generate', 'replay', 'delay', 'drop', 'duplicate', 'modify', 'retry'];
    const action = actions.includes(b.action) ? b.action : 'generate';
    const rnd = mulberry32(clampInt(b.seed, 42, 0, 1e9));
    const wh = { id: rid(), ts: nowISO(), direction: 'carrier→studio', endpoint: str(b.endpoint || '/webhooks/carrier', '', 120), headers: { 'X-Signature': 'sha256=' + crypto.createHmac('sha256', 'lab-secret').update(JSON.stringify(b.payload || {})).digest('hex').slice(0, 32), 'Content-Type': 'application/json' }, payload: typeof b.payload === 'object' && b.payload ? JSON.parse(JSON.stringify(b.payload)) : { event: 'IN_TRANSIT', trackingNumber: str(b.trackingNumber || 'SIM', '', 40) }, sandbox: true };
    wh.response = action === 'drop' ? { status: 'DROPPED (simulado)' } : { status: action === 'delay' ? 202 : 200, latencyMs: Math.round(40 + rnd() * 400) };
    wh.retries = action === 'retry' ? 2 : 0; wh.signature = wh.headers['X-Signature'];
    if (action === 'modify' && b.modify) wh.payload = { ...wh.payload, ...(typeof b.modify === 'object' ? b.modify : {}) };
    if (action === 'duplicate') c.P.webhooks.unshift({ ...wh, id: rid(), duplicatedOf: wh.id });
    c.P.webhooks.unshift(wh); if (c.P.webhooks.length > 500) c.P.webhooks.length = 500;
    appendEvent(evts(c.s, c.pid), c.pid, 'system', { action: 'webhook.' + action, endpoint: wh.endpoint });
    saveStore(req.user, c.s);
    res.json({ webhook: wh, note: 'Webhook Lab corre 100% en sandbox: nunca envía a terceros (#25,#85).' });
  }));

  // ---- Replay Engine (#27): GPX/NMEA/CSV/JSON ----
  app.post('/api/tracking/replay/parse', requireAuth, wrap((req, res) => {
    const text = str(req.body.text, '', 400000);
    const fmt = ['GPX', 'NMEA', 'CSV', 'JSON'].includes(req.body.format) ? req.body.format : null;
    if (!fmt) return res.status(400).json({ error: 'Formato requerido: GPX | NMEA | CSV | JSON' });
    const pts = [];
    try {
      if (fmt === 'GPX') { const trkpts = [...text.matchAll(/<trkpt\s+lat="([\d.\-]+)"\s+lon="([\d.\-]+)"[^>]*>(?:\s*<time>([^<]*)<\/time>)?/gi)]; for (const m of trkpts) pts.push({ lat: +m[1], lon: +m[2], timestamp: m[3] || null }); }
      else if (fmt === 'NMEA') { for (const line of text.split('\n')) { const m = /^\$G[NP]RMC,(\d+),[AV],(\d+\.?\d*)([NS]),(\d+\.?\d*)([EW]),/.exec(line.trim()); if (m && m[2]) { const conv = (v, h) => (Math.floor(v / 100) + (v % 100) / 60) * (h === 'S' || h === 'W' ? -1 : 1); pts.push({ lat: +conv(parseFloat(m[2]), m[3]).toFixed(6), lon: +conv(parseFloat(m[4]), m[5]).toFixed(6), timestamp: m[1] }); } } }
      else if (fmt === 'CSV') { const lines = text.trim().split(/\r?\n/); const head = (lines.shift() || '').toLowerCase().split(','); const li = head.findIndex(h => h.includes('lat')), lo = head.findIndex(h => h.includes('lon') || h.includes('lng')), ti = head.findIndex(h => h.includes('time')); for (const ln of lines) { const f = ln.split(','); if (li >= 0 && lo >= 0 && f[li] && !isNaN(+f[li])) pts.push({ lat: +f[li], lon: +f[lo], timestamp: ti >= 0 ? f[ti] : null }); } }
      else { const j = JSON.parse(text); const arr = Array.isArray(j) ? j : (j.reads || j.points || []); for (const p of arr) { const g = p.gps || p; if (Number.isFinite(+g.lat)) pts.push({ lat: +g.lat, lon: +g.lon, timestamp: p.timestamp || g.timestamp || null, temperature: p.temperature ?? null }); } }
    } catch (e) { return res.status(400).json({ error: 'No se pudo parsear: ' + e.message }); }
    if (!pts.length) return res.status(400).json({ error: '0 puntos encontrados en el archivo' });
    const c = needP(req, res); if (!c) return;
    const run = { id: rid(), ts: nowISO(), format: fmt, points: pts.length, speeds: [0.25, 1, 2, 10, 100] };
    c.P.traces.unshift(run); if (c.P.traces.length > 100) c.P.traces.length = 100;
    // aplicar puntos como telemetría REPLAY
    const dev = c.P.devices[0];
    if (dev) {
      const reads = pts.slice(0, 2000).map(p => ({ deviceId: dev.id, timestamp: p.timestamp, gps: { lat: p.lat, lon: p.lon }, temperature: p.temperature, source: 'REPLAY' }));
      req.query.project = c.pid; req.body = { reads };
    }
    saveStore(req.user, c.s);
    res.json({ parsed: pts.length, first: pts[0], last: pts[pts.length - 1], replayRun: run, note: 'Modo REPLAY marcado; no sobrescribe históricos reales (#84).' });
  }));

  // ---- Snapshot Engine (#28) + Scenario Branching (#29) ----
  app.post('/api/tracking/snapshots', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const snap = { id: rid(), name: str(req.body.name, 'Snapshot ' + (c.P.snapshots.length + 1), 80), ts: nowISO(), projectId: c.pid, mode: c.P.mode, state: JSON.parse(JSON.stringify({ shipments: c.P.shipments, devices: c.P.devices, routes: c.P.routes, geofences: c.P.geofences, alerts: c.P.alerts, excursions: c.P.excursions, nodes: c.P.nodes, scenarios: c.P.scenarios })), eventsCount: (c.s.events[c.pid] || []).length, bridgeAt: bridge.status() };
    c.P.snapshots.unshift(snap); if (c.P.snapshots.length > 30) c.P.snapshots.shift();
    appendEvent(evts(c.s, c.pid), c.pid, 'snapshot', { snapshotId: snap.id, name: snap.name });
    bus.emit('snapshot.created', snap); saveStore(req.user, c.s);
    addAudit(req.user.email, 'Tracking Studio', `Snapshot: ${snap.name}`);
    res.json({ id: snap.id, name: snap.name, ts: snap.ts, captured: Object.keys(snap.state) });
  }));
  app.get('/api/tracking/snapshots', requireAuth, wrap((req, res) => { const c = needP(req, res); if (c) res.json({ snapshots: c.P.snapshots.map(s => ({ id: s.id, name: s.name, ts: s.ts, mode: s.mode, eventsCount: s.eventsCount })) }); }));
  app.post('/api/tracking/snapshots/:id/restore', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const snap = c.P.snapshots.find(x => x.id === req.params.id); if (!snap) return res.status(404).json({ error: 'Snapshot no encontrado' });
    if (req.body.confirm !== true) return res.status(428).json({ error: 'Restaurar reemplaza el estado actual del proyecto. Confirmá con { confirm: true } (#79 rollback explícito).' });
    Object.assign(c.P, JSON.parse(JSON.stringify(snap.state)));
    appendEvent(evts(c.s, c.pid), c.pid, 'snapshot', { snapshotId: snap.id, action: 'restored' });
    saveStore(req.user, c.s); addAudit(req.user.email, 'Tracking Studio', `Snapshot restaurado: ${snap.name}`);
    res.json({ ok: true, restored: snap.name });
  }));
  app.post('/api/tracking/snapshots/:id/compare', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const A = c.P.snapshots.find(x => x.id === req.params.id), B = c.P.snapshots.find(x => x.id === req.body.otherId);
    if (!A || !B) return res.status(404).json({ error: 'Faltan snapshots A/B' });
    const diff = {};
    for (const k of Object.keys(A.state)) {
      const na = (A.state[k] || []).length, nb = (B.state[k] || []).length;
      const idsA = new Set((A.state[k] || []).map(x => x.id)), idsB = new Set((B.state[k] || []).map(x => x.id));
      diff[k] = { countA: na, countB: nb, onlyInA: [...idsA].filter(i => !idsB.has(i)).length, onlyInB: [...idsB].filter(i => !idsA.has(i)).length };
    }
    res.json({ a: A.name, b: B.name, diff });
  }));
  app.post('/api/tracking/scenarios', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const base = req.body.fromSnapshotId ? c.P.snapshots.find(x => x.id === req.body.fromSnapshotId) : null;
    const sc = { id: rid(), name: str(req.body.name, 'Scenario ' + (c.P.scenarios.length + 1), 80), parent: str(req.body.parent || '', '', 80) || null, description: str(req.body.description || '', '', 400), fromSnapshotId: base?.id || null, state: base ? JSON.parse(JSON.stringify(base.state)) : JSON.parse(JSON.stringify({ shipments: c.P.shipments, devices: c.P.devices, alerts: c.P.alerts })), createdAt: nowISO(), branchOf: c.pid };
    c.P.scenarios.unshift(sc);
    appendEvent(evts(c.s, c.pid), c.pid, 'system', { action: 'scenario.branch', name: sc.name });
    saveStore(req.user, c.s);
    res.json({ ...sc, state: undefined, note: 'El branch tiene su propio estado; el escenario padre NO se sobrescribe (#29).' });
  }));

  // ---- Simulation Runner (#30) + Stress (#31) + Failures (#32) ----
  const simRuns = new Map(); // id -> run (en memoria; persiste resumen)
  const LIMITS_DEFAULT = { maxWorkers: 4, maxEventsPerBatch: 200000, timeoutMs: 60000 };
  app.get('/api/tracking/simulations', requireAuth, wrap((req, res) => { const c = needP(req, res); if (c) res.json({ runs: c.P.simulations.slice(0, 50), running: [...simRuns.values()].filter(r => r.state === 'running').map(r => ({ id: r.id, progress: r.progress })) }); }));
  app.post('/api/tracking/simulations', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const b = req.body || {};
    const shipments = clampInt(b.shipmentCount, 100, 1, 500000);
    const freq = clampInt(b.telemetryFrequencyHz, 1, 1, 1000);
    const durationSec = clampInt(b.durationSec, 10, 1, 600);
    const workers = clampInt(b.workers, 2, 1, LIMITS_DEFAULT.maxWorkers);
    const totalEvents = Math.min(LIMITS_DEFAULT.maxEventsPerBatch, shipments * freq * durationSec);
    const run = { id: rid(), name: str(b.name, 'Sim ' + Date.now(), 80), state: 'running', startedAt: nowISO(), config: { shipments, freq, durationSec, workers, seed: clampInt(b.seed, Math.floor(Math.random() * 1e9), 0, 1e9), weather: str(b.weather || 'clear', '', 30), carrierBehavior: str(b.carrierBehavior || 'normal', '', 30), failureInjection: Array.isArray(b.failureInjection) ? b.failureInjection.filter(f => FAILURE_KINDS.includes(f)).slice(0, 13) : [] }, totalEvents, generated: 0, progress: 0, queueDepth: 0, failures: 0, warnings: 0 };
    simRuns.set(run.id, run);
    appendEvent(evts(c.s, c.pid), c.pid, 'simulation', { runId: run.id, action: 'started', totalEvents });
    bus.emit('simulation.started', run);
    // worker "hijack-free": genera por chunks con setImmediate para no bloquear el loop (#13,#86)
    const rnd = mulberry32(run.config.seed);
    const origins = [['Buenos Aires', -34.6, -58.4], ['Madrid', 40.4, -3.7], ['Rotterdam', 51.9, 4.5], ['Miami', 25.8, -80.2], ['Santiago', -33.4, -70.6]];
    let done = 0;
    const chunk = () => {
      if (run.state !== 'running') return;
      const step = Math.min(20000, totalEvents - done);
      for (let i = 0; i < step; i++) {
        const o = origins[Math.floor(rnd() * origins.length)];
        const lat = o[1] + (rnd() - 0.5) * 6, lon = o[2] + (rnd() - 0.5) * 6;
        const injectFail = run.config.failureInjection.length && rnd() < 0.02;
        if (injectFail) run.failures++;
        if (rnd() < 0.001) run.warnings++;
        done++;
      }
      run.generated = done; run.progress = Math.round((done / totalEvents) * 100); run.queueDepth = Math.max(0, totalEvents - done);
      if (done >= totalEvents) {
        run.state = 'completed'; run.finishedAt = nowISO(); run.elapsedMs = Date.now() - new Date(run.startedAt).getTime();
        run.throughputPerSec = Math.round(done / Math.max(1, run.elapsedMs / 1000));
        // materializar una fracción manejable como datos reales del proyecto (no 500k filas en JSON)
        const matShip = Math.min(shipments, 500), matTel = Math.min(done, 5000);
        for (let i = 0; i < matShip; i++) {
          const o = origins[Math.floor(rnd() * origins.length)], d = origins[Math.floor(rnd() * origins.length)];
          const v = validShipment({ origin: o[0], destination: d[0], riskCategory: rnd() < 0.3 ? 'COLD_CHAIN' : 'GENERAL', temperatureRequired: rnd() < 0.3 ? { min: 2, max: 8, target: 5 } : null, currentLocation: { lat: o[1], lon: o[2] }, plannedRoute: [{ lat: o[1], lon: o[2] }, { lat: d[1], lon: d[2] }], carrier: ['DHL', 'FedEx', 'UPS', 'Correo Argentino'][Math.floor(rnd() * 4)], status: SHIP_STATUSES[Math.floor(rnd() * 6)] });
          c.P.shipments.unshift(v.out);
        }
        const ring = (c.P.telemetryRing = c.P.telemetryRing || []);
        for (let i = 0; i < matTel; i++) {
          const o = origins[Math.floor(rnd() * origins.length)];
          ring.push({ deviceId: 'sim', timestamp: nowISO(), gps: { lat: o[1] + (rnd() - .5) * 6, lon: o[2] + (rnd() - .5) * 6 }, temperature: 2 + rnd() * 10, humidity: Math.round(40 + rnd() * 50), battery: Math.round(rnd() * 100), signal: -50 - Math.round(rnd() * 45), impactG: +rnd().toFixed(2), source: 'SIMULATED' });
        }
        if (ring.length > MAX_TELEM_PER_PROJECT) ring.splice(0, ring.length - MAX_TELEM_PER_PROJECT);
        c.P.simulations.unshift({ ...run }); if (c.P.simulations.length > 100) c.P.simulations.pop();
        appendEvent(evts(c.s, c.pid), c.pid, 'simulation', { runId: run.id, action: 'completed', generated: done, failures: run.failures, throughputPerSec: run.throughputPerSec });
        bus.emit('simulation.completed', run); saveStore(req.user, c.s);
        return;
      }
      setImmediate(chunk); // cede el hilo: frontend nunca se bloquea
    };
    setImmediate(chunk);
    setTimeout(() => { if (run.state === 'running') { run.state = 'timeout'; saveStore(req.user, c.s); } }, LIMITS_DEFAULT.timeoutMs * 10); // simulación nunca corre infinita (#14)
    res.json({ id: run.id, state: run.state, totalEvents, note: `Generación en background (${workers}-worker equivalent): ${totalEvents.toLocaleString()} eventos planificados, límite ${LIMITS_DEFAULT.maxEventsPerBatch.toLocaleString()}/run.` });
  }));
  app.post('/api/tracking/simulations/:id/cancel', requireAuth, wrap((req, res) => {
    const run = simRuns.get(req.params.id); if (!run) return res.status(404).json({ error: 'Run no encontrado (ya finalizó?)' });
    run.state = 'cancelled'; res.json({ ok: true, progress: run.progress });
  }));

  // ---- Resource Monitor (#14) ----
  app.get('/api/tracking/resources', requireAuth, wrap((req, res) => {
    const os = require('os');
    const cpus = os.cpus(), load = os.loadavg()[0] || 0;
    const used = os.totalmem() - os.freemem();
    const running = [...simRuns.values()].filter(r => r.state === 'running');
    res.json({
      cpuPct: Math.min(100, Math.round((load / cpus.length) * 100)), cores: cpus.length,
      ramUsedMB: Math.round(used / 1048576), ramTotalMB: Math.round(os.totalmem() / 1048576),
      gpu: 'n/a (no expuesto desde Node; visible en la app de escritorio)',
      workers: running.length, eventsPerSec: running.reduce((a, r) => a + (r.throughputPerSec || 0), 0),
      queueDepth: running.reduce((a, r) => a + r.queueDepth, 0),
      storage: { dbFile: 'db.json (estado IPHub)', telemetryCapPerProject: MAX_TELEM_PER_PROJECT, batchCap: MAX_BATCH },
      limits: LIMITS_DEFAULT, note: 'Límites obligatorios: ninguna simulación puede saturar el equipo (#14).',
    });
  }));

  // ---- Incidents / Alerts / Root cause (#42,#43,#44) ----
  app.get('/api/tracking/alerts', requireAuth, wrap((req, res) => { const c = needP(req, res); if (c) res.json({ alerts: c.P.alerts.slice(0, 200), mode: c.P.mode }); }));
  app.post('/api/tracking/alerts/:id/ack', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const a = c.P.alerts.find(x => x.id === req.params.id); if (!a) return res.status(404).json({ error: 'Alerta no encontrada' });
    a.ack = true; a.ackedBy = req.user.email; a.ackedAt = nowISO(); saveStore(req.user, c.s); res.json(a);
  }));
  app.get('/api/tracking/incidents', requireAuth, wrap((req, res) => { const c = needP(req, res); if (c) res.json({ incidents: c.P.incidents }); }));
  app.post('/api/tracking/incidents', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const b = req.body || {};
    const inc = { id: rid(), ts: nowISO(), title: str(b.title, 'Incidente', 160), severity: ['low', 'medium', 'high', 'critical'].includes(b.severity) ? b.severity : 'medium', state: 'open', shipmentIds: (Array.isArray(b.shipmentIds) ? b.shipmentIds : []).slice(0, 100), alertIds: (Array.isArray(b.alertIds) ? b.alertIds : []).slice(0, 100), mode: c.P.mode, rootCause: null };
    // causa raíz automática: encadena alertas relacionadas
    if (inc.shipmentIds.length) {
      const rel = c.P.alerts.filter(a => inc.shipmentIds.includes(a.shipmentId));
      const kinds = [...new Set(rel.map(a => a.kind))];
      inc.rootCause = { detectedKinds: kinds, hypothesis: kinds.includes('cold_chain') ? 'Excursión térmica sostenida en cold chain' : kinds.includes('connectivity') ? 'Pérdida de conectividad del gateway virtual' : 'Revisar timeline de eventos', confidence: Math.min(0.9, 0.4 + rel.length * 0.1) };
    }
    c.P.incidents.unshift(inc);
    appendEvent(evts(c.s, c.pid), c.pid, 'incident', { incidentId: inc.id, title: inc.title });
    bus.emit('incident.created', inc); saveStore(req.user, c.s);
    addAudit(req.user.email, 'Tracking Studio', `Incidente: ${inc.title}`);
    res.json(inc);
  }));
  app.put('/api/tracking/incidents/:id', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const i = c.P.incidents.find(x => x.id === req.params.id); if (!i) return res.status(404).json({ error: 'Incidente no encontrado' });
    if (['open', 'investigating', 'resolved'].includes(req.body.state)) i.state = req.body.state;
    if (req.body.resolution) i.resolution = str(req.body.resolution, '', 600);
    saveStore(req.user, c.s); res.json(i);
  }));

  // ---- Network Trace físico + digital (#35,#36) + Bridge endpoints (#33,#34) ----
  app.get('/api/tracking/bridge/status', requireAuth, wrap((req, res) => res.json(bridge.status())));
  app.get('/api/tracking/bridge/hosts', requireAuth, wrap((req, res) => res.json({ hosts: bridge.listVirtualHosts(), gateways: bridge.listGateways(), networks: bridge.listNetworks(), firewalls: bridge.listFirewalls(), note: 'Si la app de escritorio no está conectada, el Bridge responde con infraestructura virtual de fallback (funciona sin Virtual Lab, #72).' })));
  app.post('/api/tracking/bridge/attach', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const d = c.P.devices.find(x => x.id === req.body.deviceId); if (!d) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    d.virtualHostId = str(req.body.hostId, '', 60) || d.virtualHostId;
    d.gatewayId = str(req.body.gatewayId, '', 60) || d.gatewayId;
    saveStore(req.user, c.s);
    bus.emit('virtuallab.connected', { deviceId: d.id, hostId: d.virtualHostId });
    res.json({ mapping: `${d.name} (IoT) → host:${d.virtualHostId || '—'} → gateway:${d.gatewayId || 'gw-sim-1'} → red virtual → firewall → MQTT Broker → Tracking API → Tracking Studio`, device: { ...d, _inside: undefined } });
  }));
  app.get('/api/tracking/network-trace/:shipmentId', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const sh = c.P.shipments.find(x => x.id === req.params.shipmentId); if (!sh) return res.status(404).json({ error: 'Envío no encontrado' });
    const dev = c.P.devices.find(d => d.shipmentId === sh.id);
    const st = bridge.status();
    const physical = [sh.origin, ...(c.P.nodes.filter(n => ['Warehouse', 'Hub', 'Port', 'Airport'].includes(n.type)).slice(0, 3).map(n => n.name)), sh.destination].filter(Boolean);
    const digital = ['IoT Sensor', dev?.gatewayId || 'Gateway', 'Firewall', 'MQTT Broker', 'Tracking API', 'Database', 'Tracking Studio'];
    const buffering = dev && dev.state === 'BUFFERING';
    res.json({
      mode: c.P.mode, bridge: st,
      physical: { label: 'PHYSICAL ROUTE', hops: physical.map((p, i) => ({ hop: i + 1, place: p })) },
      digital: { label: 'DIGITAL ROUTE', hops: digital.map((p, i) => ({ hop: i + 1, node: p, latencyMs: st.connected ? Math.round(1 + Math.random() * 40) : null, packets: (c.P.telemetryRing || []).length, errors: 0, dropped: buffering ? (dev.buffer?.length || 0) : 0, simulated: !st.connected })) },
      failureEffect: buffering ? 'Gateway Down → sensor offline → buffer ↑ → eventos en cola → confianza ETA ↓ → alerta' : null,
      recovery: buffering ? null : 'Connection restored → buffered events → replay → sync → reconciliation',
      associatedShipment: { id: sh.id, trackingNumber: sh.trackingNumber, etaConfidence: buffering ? 0.45 : 0.92 },
    });
  }));
  app.post('/api/tracking/failures/inject', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const kind = FAILURE_KINDS.includes(req.body.kind) ? req.body.kind : null; if (!kind) return res.status(400).json({ error: 'Falla no válida (ver catálogo failures)' });
    const dev = c.P.devices.find(d => d.id === req.body.deviceId) || c.P.devices[0];
    if (!dev) return res.status(400).json({ error: 'Creá al menos un dispositivo IoT' });
    const offline = ['Gateway Offline', 'Cellular Loss', 'Satellite Loss'].includes(kind);
    dev.state = offline ? 'BUFFERING' : 'FAULT';
    if (offline) { dev.buffer = dev.buffer || []; for (let i = 0; i < 25; i++) dev.buffer.push({ queuedAt: nowISO(), type: 'telemetry', reason: kind }); }
    createAlert(c.s, req.user, c.pid, { severity: 'high', kind: 'failure', title: `Falla inyectada: ${kind}`, detail: `Dispositivo ${dev.name} (LAB)` });
    appendEvent(evts(c.s, c.pid), c.pid, 'system', { action: 'failure.inject', kind, deviceId: dev.id });
    saveStore(req.user, c.s);
    res.json({ injected: kind, device: dev.state, effect: offline ? 'Telemetry buffering iniciado; eventos en cola hasta recuperación' : 'Sensor en FAULT', note: 'Ejecutado solo en laboratorio aislado (#32,#85).' });
  }));
  app.post('/api/tracking/failures/recover', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    let recovered = 0;
    for (const d of c.P.devices) if (d.state === 'BUFFERING' || d.state === 'FAULT') {
      const n = (d.buffer || []).length; d.buffer = []; d.state = 'ONLINE'; d.lastPing = nowISO(); recovered += n;
      appendEvent(evts(c.s, c.pid), c.pid, 'device', { deviceId: d.id, event: 'replay-sync', replayed: n });
    }
    saveStore(req.user, c.s);
    res.json({ ok: true, replayedEvents: recovered, flow: 'Connection restored → buffered events → replay → synchronization → state reconciliation' });
  }));

  // ---- Code Intelligence + Secret Detection (#37..#39) sobre archivos del repo ----
  app.post('/api/tracking/code/analyze', requireAuth, wrap(async (req, res) => {
    const fs = require('fs'); const path = require('path');
    const files = (Array.isArray(req.body.files) ? req.body.files : []).slice(0, 20)
      .map(f => str(f, '', 120)).filter(f => !f.includes('..') && /\.(js|ts|py|java|go)$/.test(f));
    const findings = [];
    for (const f of files) {
      const abs = path.join(__dirname, f);
      if (!abs.startsWith(__dirname) || !fs.existsSync(abs)) { findings.push({ file: f, error: 'archivo no encontrado (solo rutas del repo, sin ..)' }); continue; }
      const src = fs.readFileSync(abs, 'utf8').slice(0, 400000);
      const lines = src.split('\n');
      // secret detection (#39)
      for (const pat of SECRET_PATTERNS) { let m; const re = new RegExp(pat.re.source, pat.re.flags.toString().replace('g', '')); while ((m = re.exec(src)) && pat.name) { const lineNo = src.slice(0, m.index).split('\n').length; const val = m[0]; if (/process\.env|example|placeholder|xxxx/i.test(lines[lineNo - 1] || '')) break; findings.push({ file: f, line: lineNo, type: 'SECRET', pattern: pat.name, risk: 'high', match: val.slice(0, 12) + '…', recommendation: 'Mover a variables de entorno (.env) y rotar la credencial.' }); break; } }
      // code queries conceptuales (#38)
      lines.forEach((ln, i) => {
        if (/webhook|hook/i.test(ln) && /app\.(post|use)/i.test(ln) && !/verify|signature|hmac|validate/i.test(src.slice(Math.max(0, src.indexOf(ln) - 2000), src.indexOf(ln) + 4000))) findings.push({ file: f, line: i + 1, type: 'WEBHOOK_NO_SIG', risk: 'medium', explanation: 'Endpoint de webhook sin validación de firma cercana.', recommendation: 'Validar HMAC antes de procesar el payload.' });
        if (/fetch\(|axios|http\.request/i.test(ln) && !/try|catch|\.catch|timeout/i.test(ln) && !/\/api\//.test(ln) === false) findings.push({ file: f, line: i + 1, type: 'HTTP_NO_RETRY', risk: 'low', explanation: 'Llamada HTTP externa sin retry/timeout explícito en la línea.', recommendation: 'Agregar timeout y reintento con backoff.' });
      });
      findings.push({ file: f, line: 0, type: 'INFO', risk: 'info', explanation: `Analizado: ${lines.length} líneas, lenguajes soportados JS/TS.`, recommendation: '' });
    }
    res.json({ analyzed: files.length, findings, note: 'Análisis estático local sobre el repo; sin ejecución de código.' });
  }));

  // ---- Reports (#51) + Dashboard (#46) ----
  app.get('/api/tracking/dashboard', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const P = c.P;
    const byStatus = {}; for (const s of P.shipments) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    const exceptions = P.shipments.filter(s => s.status === 'EXCEPTION').length;
    res.json({
      mode: P.mode, totals: { shipments: P.shipments.length, devices: P.devices.length, routes: P.routes.length, geofences: P.geofences.length, telemetryReads: (P.telemetryRing || []).length, events: (c.s.events[c.pid] || []).length, openAlerts: P.alerts.filter(a => !a.ack).length, openIncidents: P.incidents.filter(i => i.state === 'open').length, exceptions, excursions: (P.excursions || []).length },
      byStatus, topRisk: P.shipments.map(s => ({ id: s.id, trackingNumber: s.trackingNumber, ...riskScore(P, s) })).sort((a, b) => b.score - a.score).slice(0, 10),
      bridge: bridge.status(), recentEvents: (c.s.events[c.pid] || []).slice(-20).reverse(),
    });
  }));
  app.post('/api/tracking/reports', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const P = c.P, d = new Date();
    const md = [`# Reporte Tracking Studio — ${P.name}`, '', `- Generado: ${d.toISOString()}`, `- Modo del proyecto: **${P.mode}** (los datos simulados van marcados SIMULATED)`, `- Bridge Virtual Lab: ${bridge.status().connected ? 'conectado' : 'fallback simulado (sin app de escritorio)'}`, '',
      '## Resumen', `| Métrica | Valor |`, '|---|---|',
      `| Envíos | ${P.shipments.length} |`, `| Excepciones | ${P.shipments.filter(s => s.status === 'EXCEPTION').length} |`,
      `| Dispositivos IoT | ${P.devices.length} |`, `| Rutas | ${P.routes.length} |`, `| Geofences | ${P.geofences.length} |`,
      `| Alertas abiertas | ${P.alerts.filter(a => !a.ack).length} |`, `| Excursiones térmicas | ${(P.excursions || []).length} |`,
      `| Incidentes abiertos | ${P.incidents.filter(i => i.state === 'open').length} |`, `| Eventos (append-only) | ${(c.s.events[c.pid] || []).length} |`, '',
      '## Top riesgo', ...P.shipments.slice(0, 5).map(s => { const r = riskScore(P, s); return `- ${s.trackingNumber}: ${r.score}/100 (${r.level})`; }), '',
      '## Cadena de custodia (últimos registros)', ...(P.custody.slice(0, 10).map(cv => `- ${cv.ts} · ${cv.operation} · ${cv.operator} · firma ${cv.signature.slice(0, 8)}`)), ''];
    const rep = { id: rid(), ts: nowISO(), name: str(req.body.name, 'Reporte ' + d.toISOString().slice(0, 10), 80), markdown: md.join('\n') };
    P.reports.unshift(rep); if (P.reports.length > 50) P.reports.pop();
    saveStore(req.user, c.s); addAudit(req.user.email, 'Tracking Studio', `Reporte generado: ${rep.name}`);
    res.json(rep);
  }));

  // ---- Global search (#64) ----
  app.get('/api/tracking/search', requireAuth, wrap((req, res) => {
    const c = needP(req, res); if (!c) return;
    const q = str(req.query.q, '', 60).toLowerCase(); if (!q) return res.json({ results: [] });
    const hit = s => String(s || '').toLowerCase().includes(q);
    const results = [
      ...c.P.shipments.filter(s => hit(s.trackingNumber) || hit(s.origin) || hit(s.destination)).slice(0, 20).map(s => ({ type: 'shipment', id: s.id, label: s.trackingNumber, sub: `${s.origin} → ${s.destination} · ${s.status}` })),
      ...c.P.devices.filter(d => hit(d.name) || hit(d.imei) || hit(d.uuid)).slice(0, 20).map(d => ({ type: 'device', id: d.id, label: d.name, sub: `${d.type} · ${d.state}` })),
      ...c.P.routes.filter(r => hit(r.name)).slice(0, 10).map(r => ({ type: 'route', id: r.id, label: r.name, sub: r.transportMode })),
      ...c.P.alerts.filter(a => hit(a.title)).slice(0, 10).map(a => ({ type: 'alert', id: a.id, label: a.title, sub: a.severity })),
    ];
    res.json({ results });
  }));

  // ---- Demo project "Global Cold Chain Demo" (#66) + sample scenario (#67) ----
  app.post('/api/tracking/demo', requireAuth, wrap((req, res) => {
    const s = store(req.user);
    const P = {
      id: rid(), name: 'Global Cold Chain Demo', mode: 'SIMULATED', createdAt: nowISO(),
      shipments: [], consignments: [], devices: [], nodes: [], routes: [], geofences: [], vehicles: [], hubs: [],
      telemetryRing: [], telemetryIndex: { count: 0, last: null }, alerts: [], incidents: [], excursions: [], proofs: [], custody: [],
      carriers: [{ id: 'simco', name: 'SimCarrier', adapter: 'Mock', env: 'mock', status: 'MOCK' }],
      webhooks: [], simulations: [], snapshots: [], scenarios: [], traces: [], reports: [], integrations: [],
    };
    const rnd = mulberry32(20260101);
    const cities = [['Buenos Aires', -34.6, -58.4], ['Madrid', 40.4, -3.7], ['Rotterdam', 51.9, 4.5], ['Frankfurt', 50.1, 8.7], ['Milán', 45.5, 9.2], ['París', 48.9, 2.4], ['Lisboa', 38.7, -9.1], ['Hamburgo', 53.6, 10.0], ['Valencia', 39.5, -0.4], ['Oporto', 41.2, -8.6]];
    for (let i = 0; i < 10; i++) P.hubs.push({ id: rid(), name: 'Hub ' + cities[i][0], city: cities[i][0], lat: cities[i][1], lon: cities[i][2] });
    for (let i = 0; i < 25; i++) P.vehicles.push({ id: 'veh-' + i, type: i < 18 ? 'Truck' : i < 22 ? 'Van' : 'Reefer', plate: 'TS-' + (1000 + i), hub: P.hubs[i % 10].name });
    for (let i = 0; i < 50; i++) {
      const o = cities[Math.floor(rnd() * 10)], d = cities[Math.floor(rnd() * 10)];
      const cold = rnd() < 0.5;
      const dev = { id: rid(), name: 'tracker-' + String(i + 1).padStart(3, '0'), type: cold ? 'MULTI' : 'GPS', imei: String(35000000000000 + i), mac: 'A0:B1:' + crypto.randomBytes(4).toString('hex').toUpperCase().replace(/(.{2})(?=.)/g, '$1:'), uuid: crypto.randomUUID(), epc: 'EPC-' + crypto.randomBytes(4).toString('hex').toUpperCase(), firmware: 'ts-fw 2.1.0', battery: Math.round(50 + rnd() * 50), bufferMax: 5000, buffer: [], protocol: 'MQTT', carrier: 'SimCarrier', gatewayId: 'gw-sim-1', shipmentId: null, virtualHostId: 'host-' + (40 + (i % 10)), sensor: { model: 'Gaussian', intervalSec: 2, noisePct: 3, batteryDrainPerHour: 0.2, signalLoss: 'Random', network: 'Cellular' }, state: 'ONLINE', lastPing: nowISO(), lastLocation: { lat: o[1], lon: o[2] }, _inside: [], createdAt: nowISO() };
      const v = validShipment({ origin: o[0], destination: d[0], riskCategory: cold ? 'COLD_CHAIN' : 'GENERAL', temperatureRequired: cold ? { min: 2, max: 8, target: 5, maxExposureMin: 120 } : null, currentLocation: { lat: o[1], lon: o[2] }, plannedRoute: [{ lat: o[1], lon: o[2] }, { lat: d[1], lon: d[2] }], carrier: 'SimCarrier', status: SHIP_STATUSES[Math.floor(rnd() * 6)] });
      v.out.id = dev.shipmentId = v.out.id;
      P.shipments.push(v.out); P.devices.push(dev);
      // telemetría demo (hasta ~500 shipments vía simulación aparte; demo trae 50 + 500 reads)
      for (let t = 0; t < 10; t++) {
        const lat = o[1] + (d[1] - o[1]) * (t / 10) + (rnd() - .5) * .4, lon = o[2] + (d[2] - o[2]) * (t / 10) + (rnd() - .5) * .4;
        P.telemetryRing.push({ deviceId: dev.id, timestamp: new Date(Date.now() - (10 - t) * 60000).toISOString(), gps: { lat, lon, altitude: 20, speed: 60 + rnd() * 30 }, temperature: cold ? 2 + rnd() * 8 : 15 + rnd() * 10, humidity: Math.round(40 + rnd() * 40), light: Math.round(rnd() * 900), impactG: +rnd().toFixed(2), battery: dev.battery, signal: -50 - Math.round(rnd() * 40), source: 'SIMULATED' });
        dev.lastLocation = { lat, lon };
      }
    }
    const wa = cities[0], md = cities[1];
    P.routes.push({ id: rid(), name: 'BA→Madrid Marítimo+Road', transportMode: 'Intermodal', origin: { lat: wa[1], lon: wa[2] }, destination: { lat: md[1], lon: md[2] }, waypoints: [{ lat: wa[1], lon: wa[2], etaMin: 0, name: 'Buenos Aires' }, { lat: -34.9, lon: -57.9, etaMin: 120, name: 'Puerto BA' }, { lat: md[1], lon: md[2], etaMin: 10080, name: 'Madrid' }], distanceKm: 10100, etaHours: 172, estimatedCost: 4200, carrier: 'SimCarrier', risk: 'MEDIUM', status: 'ACTIVE' });
    P.geofences.push({ id: rid(), name: 'Cold Zone Rotterdam', type: 'Cold Chain Zone', center: { lat: 51.9, lon: 4.5 }, radiusKm: 15, points: [], rules: { maxSpeedKmh: 90, tempMax: 8, dwellMin: 30 } });
    P.geofences.push({ id: rid(), name: 'Corredor BA-APA', type: 'Corridor', center: { lat: -34.6, lon: -58.4 }, radiusKm: 25, points: [], rules: { maxSpeedKmh: 120, tempMax: 30, dwellMin: 60 } });
    // Sample scenario "Cold Chain Failure" (#67)
    const coldDev = P.devices.find(d => d.shipmentId) || P.devices[0];
    const coldSh = P.shipments.find(s => s.id === coldDev.shipmentId);
    if (coldSh) {
      coldSh.temperatureRequired = { min: 2, max: 8, target: 5, maxExposureMin: 120 }; coldSh.riskCategory = 'COLD_CHAIN';
      const failRead = { deviceId: coldDev.id, timestamp: nowISO(), gps: { lat: 51.9, lon: 4.5 }, temperature: 11.4, humidity: 70, battery: coldDev.battery, signal: -80, source: 'SIMULATED' };
      P.telemetryRing.push(failRead); coldDev.lastTelemetry = failRead;
      const E = evts(s, P.id);
      appendEvent(E, P.id, 'shipment', { shipmentId: coldSh.id, trackingNumber: coldSh.trackingNumber, eventType: 'IN_TRANSIT', source: 'SIMULATED', latitude: -34.6, longitude: -58.4 });
      appendEvent(E, P.id, 'telemetry', { deviceId: coldDev.id, temperature: 11.4, anomaly: true });
      const alert = { id: rid(), ts: nowISO(), severity: 'high', kind: 'cold_chain', title: 'Excursión térmica 11.4°C (rango 2..8°C)', detail: `Envío ${coldSh.trackingNumber}. Se recomienda hub alternativo.`, shipmentId: coldSh.id, ack: false, mode: 'SIMULATED' };
      P.alerts.unshift(alert);
      P.excursions.unshift({ id: rid(), shipmentId: coldSh.id, startedAt: nowISO(), min: 2, max: 8, observed: 11.4, closedAt: null });
      coldSh.status = 'EXCEPTION';
      const inc = { id: rid(), ts: nowISO(), title: 'Cold Chain Failure — demo', severity: 'high', state: 'open', shipmentIds: [coldSh.id], alertIds: [alert.id], mode: 'SIMULATED', rootCause: { detectedKinds: ['cold_chain'], hypothesis: 'Puerta de reefer abierta + demora en aduana', confidence: 0.7 } };
      P.incidents.unshift(inc);
      appendEvent(E, P.id, 'incident', { incidentId: inc.id, title: inc.title });
      P.scenarios.unshift({ id: rid(), name: 'Cold Chain Failure', parent: 'Normal Operations', description: 'Temp ↑ → anomalía → alerta → geofence → gateway falla → buffering → recuperación + replay → incidente', state: { shipments: [coldSh], devices: [coldDev], alerts: [alert] }, createdAt: nowISO(), branchOf: P.id });
    }
    P.scenarios.unshift({ id: rid(), name: 'Normal Operations', parent: null, description: 'Base', state: { shipments: P.shipments.slice(0, 5), devices: P.devices.slice(0, 5), alerts: [] }, createdAt: nowISO(), branchOf: P.id });
    P.scenarios[1] && P.scenarios.forEach(x => { x.description = str(x.description, '', 400); });
    s.projects.push(P); s.activeProject = P.id; saveStore(req.user, s);
    addAudit(req.user.email, 'Tracking Studio', 'Demo Global Cold Chain cargado');
    res.json({ id: P.id, name: P.name, shipments: P.shipments.length, hubs: P.hubs.length, vehicles: P.vehicles.length, devices: P.devices.length, routes: P.routes.length, geofences: P.geofences.length, telemetryReads: P.telemetryRing.length, scenario: 'Cold Chain Failure incluido', bridge: 'fallback simulado (conectá la app de escritorio para hosts reales)' });
  }));

  console.log('[tracking] Tracking Studio registrado (APIs /api/tracking/*)');
};
