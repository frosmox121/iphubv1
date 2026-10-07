/**
 * Tracking Studio — Fase 1 + Fase 2
 * Persistencia: proyectos, envíos, eventos, telemetría, dispositivos IoT.
 * Motor de telemetría masiva (batch) + workers en cliente/Electron.
 */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit, crypto } = ctx;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID());

  // ---------- Colecciones (lazy ensure) ----------
  function ensureCols() {
    const defaults = {
      trackingProjects: [],
      shipments: [],
      trackingEvents: [],
      telemetryReads: [],
      iotDevices: [],
    };
    for (const [k, v] of Object.entries(defaults)) {
      if (db.get(k).value() == null) db.set(k, v).write();
    }
  }
  ensureCols();

  const STATUSES = [
    'LABEL_CREATED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_FACILITY',
    'CUSTOMS_CLEARANCE', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION',
    'RETURNED', 'CANCELLED',
  ];
  const EVENT_SOURCES = [
    'PHYSICAL_SCAN', 'RFID', 'IOT', 'GPS', 'CARRIER_API', 'WEBHOOK',
    'ESTIMATED', 'SIMULATED', 'MANUAL', 'REPLAY',
  ];
  const MODES = ['REAL', 'SIMULATED', 'REPLAY', 'HYBRID'];

  function ownProjects(userId) {
    return (db.get('trackingProjects').value() || []).filter(p => p.ownerId === userId || (p.members || []).includes(userId));
  }
  function canAccessProject(userId, projectId) {
    const p = (db.get('trackingProjects').value() || []).find(x => x.id === projectId);
    if (!p) return null;
    if (p.ownerId === userId || (p.members || []).includes(userId)) return p;
    return null;
  }
  function hashChain(prevHash, payload) {
    const h = require('crypto').createHash('sha256');
    h.update(String(prevHash || '') + JSON.stringify(payload));
    return h.digest('hex').slice(0, 32);
  }

  // ---------- Projects ----------
  app.get('/api/tracking/projects', requireAuth, (req, res) => {
    ensureCols();
    const list = ownProjects(req.user.id).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      mode: p.mode || 'SIMULATED',
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      shipmentCount: (db.get('shipments').value() || []).filter(s => s.projectId === p.id).length,
    }));
    res.json({ projects: list });
  });

  app.post('/api/tracking/projects', requireAuth, (req, res) => {
    ensureCols();
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'Nombre de proyecto requerido' });
    const now = new Date().toISOString();
    const project = {
      id: uuid(),
      ownerId: req.user.id,
      members: [],
      name,
      description: String(b.description || '').slice(0, 2000),
      mode: MODES.includes(b.mode) ? b.mode : 'SIMULATED',
      settings: typeof b.settings === 'object' && b.settings ? b.settings : {},
      createdAt: now,
      updatedAt: now,
    };
    db.get('trackingProjects').push(project).write();
    addAudit(req.user.email, 'tracking.project.create', project.id + ' ' + project.name);
    res.status(201).json(project);
  });

  app.get('/api/tracking/projects/:id', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json(p);
  });

  app.put('/api/tracking/projects/:id', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (p.ownerId !== req.user.id) return res.status(403).json({ error: 'Solo el dueño puede editar' });
    const b = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };
    if (b.name != null) patch.name = String(b.name).trim().slice(0, 120);
    if (b.description != null) patch.description = String(b.description).slice(0, 2000);
    if (MODES.includes(b.mode)) patch.mode = b.mode;
    if (typeof b.settings === 'object' && b.settings) patch.settings = b.settings;
    db.get('trackingProjects').find({ id: p.id }).assign(patch).write();
    addAudit(req.user.email, 'tracking.project.update', p.id);
    res.json({ ...p, ...patch });
  });

  app.delete('/api/tracking/projects/:id', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (p.ownerId !== req.user.id) return res.status(403).json({ error: 'Solo el dueño puede eliminar' });
    const pid = p.id;
    db.get('trackingProjects').remove({ id: pid }).write();
    // Cascada suave: marcar envíos y eventos (no borrar telemetría masiva de golpe si es enorme)
    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === pid);
    for (const s of ships) {
      db.get('shipments').remove({ id: s.id }).write();
      db.get('trackingEvents').remove({ shipmentId: s.id }).write();
      db.get('telemetryReads').remove({ shipmentId: s.id }).write();
    }
    addAudit(req.user.email, 'tracking.project.delete', pid);
    res.json({ ok: true });
  });

  // ---------- Shipments ----------
  app.get('/api/tracking/projects/:id/shipments', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const list = (db.get('shipments').value() || [])
      .filter(s => s.projectId === p.id)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json({ shipments: list });
  });

  app.post('/api/tracking/projects/:id/shipments', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const now = new Date().toISOString();
    const trackingNumber = String(b.trackingNumber || ('TRK-' + Date.now().toString(36).toUpperCase())).slice(0, 64);
    const shipment = {
      id: uuid(),
      projectId: p.id,
      trackingNumber,
      barcode: String(b.barcode || trackingNumber).slice(0, 64),
      status: STATUSES.includes(b.status) ? b.status : 'LABEL_CREATED',
      origin: b.origin || null,
      destination: b.destination || null,
      currentLocation: b.currentLocation || b.origin || null,
      plannedRoute: Array.isArray(b.plannedRoute) ? b.plannedRoute : [],
      actualRoute: Array.isArray(b.actualRoute) ? b.actualRoute : [],
      carrier: String(b.carrier || '').slice(0, 80),
      serviceLevel: String(b.serviceLevel || 'standard').slice(0, 40),
      priority: String(b.priority || 'normal').slice(0, 20),
      weight: Number(b.weight) || 0,
      volume: Number(b.volume) || 0,
      dimensions: b.dimensions || null,
      declaredValue: Number(b.declaredValue) || 0,
      riskCategory: String(b.riskCategory || 'low').slice(0, 40),
      temperatureRequired: b.temperatureRequired || null,
      mode: MODES.includes(b.mode) ? b.mode : (p.mode || 'SIMULATED'),
      metadata: typeof b.metadata === 'object' && b.metadata ? b.metadata : {},
      createdAt: now,
      updatedAt: now,
    };
    db.get('shipments').push(shipment).write();

    // Evento inicial
    const prevHash = '';
    const payload = { eventType: 'LABEL_CREATED', shipmentId: shipment.id, status: shipment.status };
    const ev = {
      id: uuid(),
      shipmentId: shipment.id,
      projectId: p.id,
      timestamp: now,
      eventType: 'LABEL_CREATED',
      latitude: shipment.origin && shipment.origin.lat != null ? Number(shipment.origin.lat) : null,
      longitude: shipment.origin && shipment.origin.lon != null ? Number(shipment.origin.lon) : null,
      source: 'MANUAL',
      confidence: 1,
      deviceId: null,
      nodeId: null,
      networkHostId: null,
      payload,
      hash: hashChain(prevHash, payload),
      previousEventHash: prevHash,
      mode: shipment.mode,
    };
    db.get('trackingEvents').push(ev).write();
    addAudit(req.user.email, 'tracking.shipment.create', shipment.id + ' ' + shipment.trackingNumber);
    res.status(201).json({ shipment, event: ev });
  });

  app.get('/api/tracking/shipments/:id', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    res.json(s);
  });

  app.put('/api/tracking/shipments/:id', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };
    if (STATUSES.includes(b.status)) patch.status = b.status;
    if (b.currentLocation != null) patch.currentLocation = b.currentLocation;
    if (b.origin != null) patch.origin = b.origin;
    if (b.destination != null) patch.destination = b.destination;
    if (Array.isArray(b.plannedRoute)) patch.plannedRoute = b.plannedRoute;
    if (Array.isArray(b.actualRoute)) patch.actualRoute = b.actualRoute;
    if (b.carrier != null) patch.carrier = String(b.carrier).slice(0, 80);
    if (b.serviceLevel != null) patch.serviceLevel = String(b.serviceLevel).slice(0, 40);
    if (b.priority != null) patch.priority = String(b.priority).slice(0, 20);
    if (b.weight != null) patch.weight = Number(b.weight) || 0;
    if (b.volume != null) patch.volume = Number(b.volume) || 0;
    if (b.dimensions != null) patch.dimensions = b.dimensions;
    if (b.declaredValue != null) patch.declaredValue = Number(b.declaredValue) || 0;
    if (b.riskCategory != null) patch.riskCategory = String(b.riskCategory).slice(0, 40);
    if (b.temperatureRequired != null) patch.temperatureRequired = b.temperatureRequired;
    if (typeof b.metadata === 'object' && b.metadata) patch.metadata = b.metadata;

    const statusChanged = patch.status && patch.status !== s.status;
    db.get('shipments').find({ id: s.id }).assign(patch).write();

    let event = null;
    if (statusChanged || b.currentLocation) {
      const lastEv = (db.get('trackingEvents').value() || [])
        .filter(e => e.shipmentId === s.id)
        .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))[0];
      const prevHash = lastEv ? lastEv.hash : '';
      const now = new Date().toISOString();
      const payload = {
        eventType: statusChanged ? patch.status : 'LOCATION_UPDATE',
        shipmentId: s.id,
        status: patch.status || s.status,
        location: patch.currentLocation || s.currentLocation,
      };
      const loc = patch.currentLocation || s.currentLocation || {};
      event = {
        id: uuid(),
        shipmentId: s.id,
        projectId: s.projectId,
        timestamp: now,
        eventType: payload.eventType,
        latitude: loc.lat != null ? Number(loc.lat) : null,
        longitude: loc.lon != null ? Number(loc.lon) : null,
        source: EVENT_SOURCES.includes(b.source) ? b.source : 'MANUAL',
        confidence: Number(b.confidence) || 1,
        deviceId: b.deviceId || null,
        nodeId: b.nodeId || null,
        networkHostId: b.networkHostId || null,
        payload,
        hash: hashChain(prevHash, payload),
        previousEventHash: prevHash,
        mode: s.mode || 'SIMULATED',
      };
      db.get('trackingEvents').push(event).write();
      if (loc.lat != null && loc.lon != null) {
        const route = Array.isArray(s.actualRoute) ? [...s.actualRoute] : [];
        route.push({ lat: Number(loc.lat), lon: Number(loc.lon), ts: now });
        db.get('shipments').find({ id: s.id }).assign({ actualRoute: route }).write();
      }
    }
    addAudit(req.user.email, 'tracking.shipment.update', s.id);
    res.json({ shipment: { ...s, ...patch }, event });
  });

  app.delete('/api/tracking/shipments/:id', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    db.get('shipments').remove({ id: s.id }).write();
    db.get('trackingEvents').remove({ shipmentId: s.id }).write();
    db.get('telemetryReads').remove({ shipmentId: s.id }).write();
    addAudit(req.user.email, 'tracking.shipment.delete', s.id);
    res.json({ ok: true });
  });

  // ---------- Tracking Events ----------
  app.get('/api/tracking/shipments/:id/events', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 500));
    const list = (db.get('trackingEvents').value() || [])
      .filter(e => e.shipmentId === s.id)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
      .slice(-limit);
    res.json({ events: list });
  });

  app.post('/api/tracking/shipments/:id/events', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const lastEv = (db.get('trackingEvents').value() || [])
      .filter(e => e.shipmentId === s.id)
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))[0];
    const prevHash = lastEv ? lastEv.hash : '';
    const now = b.timestamp ? new Date(b.timestamp).toISOString() : new Date().toISOString();
    const eventType = String(b.eventType || 'CUSTOM').slice(0, 64);
    const payload = b.payload && typeof b.payload === 'object' ? b.payload : { eventType };
    const ev = {
      id: uuid(),
      shipmentId: s.id,
      projectId: s.projectId,
      timestamp: now,
      eventType,
      latitude: b.latitude != null ? Number(b.latitude) : null,
      longitude: b.longitude != null ? Number(b.longitude) : null,
      source: EVENT_SOURCES.includes(b.source) ? b.source : 'MANUAL',
      confidence: Number(b.confidence) || 1,
      deviceId: b.deviceId || null,
      nodeId: b.nodeId || null,
      networkHostId: b.networkHostId || null,
      payload,
      hash: hashChain(prevHash, { eventType, payload, timestamp: now }),
      previousEventHash: prevHash,
      mode: s.mode || 'SIMULATED',
    };
    db.get('trackingEvents').push(ev).write();
    if (STATUSES.includes(eventType)) {
      db.get('shipments').find({ id: s.id }).assign({ status: eventType, updatedAt: now }).write();
    }
    if (ev.latitude != null && ev.longitude != null) {
      const loc = { lat: ev.latitude, lon: ev.longitude };
      const route = Array.isArray(s.actualRoute) ? [...s.actualRoute] : [];
      route.push({ lat: ev.latitude, lon: ev.longitude, ts: now });
      db.get('shipments').find({ id: s.id }).assign({ currentLocation: loc, actualRoute: route, updatedAt: now }).write();
    }
    res.status(201).json(ev);
  });

  // ---------- Telemetry ----------
  app.get('/api/tracking/shipments/:id/telemetry', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 1000));
    const list = (db.get('telemetryReads').value() || [])
      .filter(t => t.shipmentId === s.id)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
      .slice(-limit);
    res.json({ telemetry: list });
  });

  app.post('/api/tracking/shipments/:id/telemetry', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const body = req.body || {};
    // Soporta batch: { readings: [...] } o un solo objeto
    const items = Array.isArray(body.readings) ? body.readings : [body];
    if (items.length > 5000) return res.status(400).json({ error: 'Máximo 5000 lecturas por request' });
    const created = [];
    const now = new Date().toISOString();
    for (const b of items) {
      const gps = b.gps || {};
      const row = {
        id: uuid(),
        shipmentId: s.id,
        projectId: s.projectId,
        deviceId: b.deviceId || null,
        timestamp: b.timestamp ? new Date(b.timestamp).toISOString() : now,
        gps: {
          lat: gps.lat != null ? Number(gps.lat) : null,
          lon: gps.lon != null ? Number(gps.lon) : null,
          altitude: gps.altitude != null ? Number(gps.altitude) : null,
          speed: gps.speed != null ? Number(gps.speed) : null,
        },
        temperature: b.temperature != null ? Number(b.temperature) : null,
        humidity: b.humidity != null ? Number(b.humidity) : null,
        light: b.light != null ? Number(b.light) : null,
        impactG: b.impactG != null ? Number(b.impactG) : null,
        battery: b.battery != null ? Number(b.battery) : null,
        signal: b.signal != null ? Number(b.signal) : null,
        mode: s.mode || 'SIMULATED',
        source: EVENT_SOURCES.includes(b.source) ? b.source : 'IOT',
      };
      db.get('telemetryReads').push(row).write();
      created.push(row);
      // Actualizar ubicación del envío si hay GPS
      if (row.gps.lat != null && row.gps.lon != null) {
        const loc = { lat: row.gps.lat, lon: row.gps.lon };
        const route = Array.isArray(s.actualRoute) ? [...s.actualRoute] : [];
        route.push({ lat: row.gps.lat, lon: row.gps.lon, ts: row.timestamp });
        db.get('shipments').find({ id: s.id }).assign({
          currentLocation: loc,
          actualRoute: route.slice(-500),
          updatedAt: row.timestamp,
        }).write();
      }
    }
    res.status(201).json({ count: created.length, telemetry: created.length === 1 ? created[0] : created });
  });

  // ---------- Project-level events / telemetry summary ----------
  app.get('/api/tracking/projects/:id/events', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const list = (db.get('trackingEvents').value() || [])
      .filter(e => e.projectId === p.id)
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      .slice(0, limit);
    res.json({ events: list });
  });

  app.get('/api/tracking/projects/:id/stats', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === p.id);
    const byStatus = {};
    for (const st of STATUSES) byStatus[st] = 0;
    for (const s of ships) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    const events = (db.get('trackingEvents').value() || []).filter(e => e.projectId === p.id);
    const tele = (db.get('telemetryReads').value() || []).filter(t => t.projectId === p.id);
    const devices = (db.get('iotDevices').value() || []).filter(d => d.projectId === p.id);
    res.json({
      shipmentCount: ships.length,
      eventCount: events.length,
      telemetryCount: tele.length,
      deviceCount: devices.length,
      byStatus,
      mode: p.mode,
    });
  });

  // ---------- IoT Devices (Fase 2) ----------
  const DEVICE_TYPES = ['GPS', 'TEMP', 'RFID', 'BLE', 'MULTI', 'CELLULAR', 'SATELLITE'];
  const DEVICE_STATUS = ['ONLINE', 'OFFLINE', 'BUFFERING', 'LOW_BATTERY', 'ERROR'];

  app.get('/api/tracking/projects/:id/devices', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const list = (db.get('iotDevices').value() || []).filter(d => d.projectId === p.id);
    res.json({ devices: list });
  });

  app.post('/api/tracking/projects/:id/devices', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const now = new Date().toISOString();
    const device = {
      id: uuid(),
      projectId: p.id,
      name: String(b.name || 'Tracker').slice(0, 80),
      type: DEVICE_TYPES.includes(b.type) ? b.type : 'MULTI',
      imei: String(b.imei || ('35' + Date.now().toString().slice(-13))).slice(0, 20),
      mac: String(b.mac || '').slice(0, 20) || null,
      uuidBle: String(b.uuidBle || uuid()).slice(0, 40),
      epcRfid: String(b.epcRfid || '').slice(0, 40) || null,
      firmware: String(b.firmware || '1.0.0').slice(0, 20),
      battery: Number(b.battery) || 100,
      memoryBuffer: Number(b.memoryBuffer) || 0,
      protocol: String(b.protocol || 'MQTT').slice(0, 20),
      carrier: String(b.carrier || 'SIMULATED').slice(0, 40),
      gateway: b.gateway || null,
      shipmentId: b.shipmentId || null,
      virtualHostId: b.virtualHostId || null,
      lastPing: now,
      status: DEVICE_STATUS.includes(b.status) ? b.status : 'ONLINE',
      lastLocation: b.lastLocation || null,
      sensorConfig: {
        intervalMs: Number((b.sensorConfig && b.sensorConfig.intervalMs) || 2000),
        noise: Number((b.sensorConfig && b.sensorConfig.noise) || 0.03),
        pattern: String((b.sensorConfig && b.sensorConfig.pattern) || 'route'),
        batteryDrainPerHour: Number((b.sensorConfig && b.sensorConfig.batteryDrainPerHour) || 0.2),
        baseTemp: Number((b.sensorConfig && b.sensorConfig.baseTemp) || 5),
        failureRate: Number((b.sensorConfig && b.sensorConfig.failureRate) || 0),
      },
      mode: MODES.includes(b.mode) ? b.mode : (p.mode || 'SIMULATED'),
      createdAt: now,
      updatedAt: now,
    };
    db.get('iotDevices').push(device).write();
    addAudit(req.user.email, 'tracking.device.create', device.id + ' ' + device.name);
    res.status(201).json(device);
  });

  app.get('/api/tracking/devices/:id', requireAuth, (req, res) => {
    const d = (db.get('iotDevices').value() || []).find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    if (!canAccessProject(req.user.id, d.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    res.json(d);
  });

  app.put('/api/tracking/devices/:id', requireAuth, (req, res) => {
    const d = (db.get('iotDevices').value() || []).find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    if (!canAccessProject(req.user.id, d.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };
    if (b.name != null) patch.name = String(b.name).slice(0, 80);
    if (DEVICE_TYPES.includes(b.type)) patch.type = b.type;
    if (DEVICE_STATUS.includes(b.status)) patch.status = b.status;
    if (b.shipmentId !== undefined) patch.shipmentId = b.shipmentId || null;
    if (b.virtualHostId !== undefined) patch.virtualHostId = b.virtualHostId || null;
    if (b.battery != null) patch.battery = Number(b.battery);
    if (b.memoryBuffer != null) patch.memoryBuffer = Number(b.memoryBuffer);
    if (b.lastLocation != null) patch.lastLocation = b.lastLocation;
    if (b.lastPing != null) patch.lastPing = b.lastPing;
    if (b.sensorConfig && typeof b.sensorConfig === 'object') {
      patch.sensorConfig = Object.assign({}, d.sensorConfig || {}, b.sensorConfig);
    }
    if (b.firmware != null) patch.firmware = String(b.firmware).slice(0, 20);
    if (b.gateway !== undefined) patch.gateway = b.gateway;
    db.get('iotDevices').find({ id: d.id }).assign(patch).write();
    res.json({ ...d, ...patch });
  });

  app.delete('/api/tracking/devices/:id', requireAuth, (req, res) => {
    const d = (db.get('iotDevices').value() || []).find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    if (!canAccessProject(req.user.id, d.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    db.get('iotDevices').remove({ id: d.id }).write();
    addAudit(req.user.email, 'tracking.device.delete', d.id);
    res.json({ ok: true });
  });

  // Retención: limitar telemetría global para no explotar el JSON DB
  function trimTelemetry(maxTotal) {
    const all = db.get('telemetryReads').value() || [];
    if (all.length <= maxTotal) return;
    const drop = all.length - maxTotal;
    // conservar los más recientes
    const sorted = all.slice().sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    const keep = new Set(sorted.slice(drop).map(x => x.id));
    db.set('telemetryReads', all.filter(x => keep.has(x.id))).write();
  }

  // Endpoint de health del motor (workers reportan vía cliente)
  app.get('/api/tracking/engine/health', requireAuth, (req, res) => {
    const tele = db.get('telemetryReads').value() || [];
    const devices = db.get('iotDevices').value() || [];
    res.json({
      telemetryStored: tele.length,
      devices: devices.length,
      phase: 2,
      limits: { maxTelemetryStored: 100000, maxBatchPerRequest: 5000 },
    });
  });

  // Hook: tras insertar telemetría en masa, trim
  const origTelePost = null; // trim se llama desde el handler existente
  // Patch retention en el POST de telemetría ya definido: re-registrar no es trivial;
  // se aplica trim en cada POST grande vía middleware al final de cada ingest.
  app.use('/api/tracking/shipments/:id/telemetry', (req, res, next) => {
    const end = res.end;
    res.end = function () {
      try { if (req.method === 'POST') trimTelemetry(100000); } catch (_) {}
      return end.apply(this, arguments);
    };
    next();
  });

  // ---------- Meta / health ----------
  app.get('/api/tracking/meta', requireAuth, (req, res) => {
    res.json({
      statuses: STATUSES,
      eventSources: EVENT_SOURCES,
      modes: MODES,
      deviceTypes: DEVICE_TYPES,
      deviceStatuses: DEVICE_STATUS,
      phase: 2,
      features: [
        'projects', 'shipments', 'events', 'telemetry', 'basic-map',
        'iot-devices', 'telemetry-workers', 'sensor-emulation', 'resource-monitor',
      ],
    });
  });
};
