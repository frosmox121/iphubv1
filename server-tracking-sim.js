/**
 * Tracking Studio — Fase 5 (fases.txt): Simulación / stress / snapshots
 */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit, crypto } = ctx;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID());

  function ensureCols() {
    for (const k of ['trackingSnapshots', 'simulationRuns', 'scenarios']) {
      if (db.get(k).value() == null) db.set(k, []).write();
    }
  }
  ensureCols();

  function canAccessProject(userId, projectId) {
    const p = (db.get('trackingProjects').value() || []).find(x => x.id === projectId);
    if (!p) return null;
    if (p.ownerId === userId || (p.members || []).includes(userId)) return p;
    return null;
  }

  // ---------- Snapshots ----------
  app.get('/api/tracking/projects/:id/snapshots', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const list = (db.get('trackingSnapshots').value() || [])
      .filter(s => s.projectId === p.id)
      .map(s => ({
        id: s.id, name: s.name, createdAt: s.createdAt,
        shipmentCount: (s.data && s.data.shipments || []).length,
        deviceCount: (s.data && s.data.devices || []).length,
        note: s.note,
      }));
    res.json({ snapshots: list });
  });

  app.post('/api/tracking/projects/:id/snapshots', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === p.id);
    const devices = (db.get('iotDevices').value() || []).filter(d => d.projectId === p.id);
    const routes = (db.get('logisticRoutes').value() || []).filter(r => r.projectId === p.id);
    const fences = (db.get('geofences').value() || []).filter(g => g.projectId === p.id);
    const events = (db.get('trackingEvents').value() || []).filter(e => e.projectId === p.id).slice(-500);
    const snap = {
      id: uuid(),
      projectId: p.id,
      name: String(b.name || ('Snapshot ' + new Date().toISOString().slice(0, 16))).slice(0, 80),
      note: String(b.note || '').slice(0, 400),
      createdAt: new Date().toISOString(),
      data: {
        project: { id: p.id, name: p.name, mode: p.mode },
        shipments: ships,
        devices,
        routes,
        geofences: fences,
        events,
      },
    };
    db.get('trackingSnapshots').unshift(snap).write();
    const all = db.get('trackingSnapshots').value() || [];
    if (all.length > 100) db.set('trackingSnapshots', all.slice(0, 80)).write();
    addAudit(req.user.email, 'tracking.snapshot.create', snap.id);
    res.status(201).json({ id: snap.id, name: snap.name, createdAt: snap.createdAt, shipmentCount: ships.length });
  });

  app.post('/api/tracking/snapshots/:id/restore', requireAuth, (req, res) => {
    const snap = (db.get('trackingSnapshots').value() || []).find(s => s.id === req.params.id);
    if (!snap) return res.status(404).json({ error: 'Snapshot no encontrado' });
    if (!canAccessProject(req.user.id, snap.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const pid = snap.projectId;
    const data = snap.data || {};
    // Replace project entities (careful: remove then push)
    const shipIds = new Set((db.get('shipments').value() || []).filter(s => s.projectId === pid).map(s => s.id));
    for (const id of shipIds) {
      db.get('shipments').remove({ id }).write();
      db.get('trackingEvents').remove({ shipmentId: id }).write();
      db.get('telemetryReads').remove({ shipmentId: id }).write();
    }
    db.set('iotDevices', (db.get('iotDevices').value() || []).filter(d => d.projectId !== pid)).write();
    db.set('logisticRoutes', (db.get('logisticRoutes').value() || []).filter(r => r.projectId !== pid)).write();
    db.set('geofences', (db.get('geofences').value() || []).filter(g => g.projectId !== pid)).write();

    for (const s of (data.shipments || [])) db.get('shipments').push(s).write();
    for (const d of (data.devices || [])) db.get('iotDevices').push(d).write();
    for (const r of (data.routes || [])) db.get('logisticRoutes').push(r).write();
    for (const g of (data.geofences || [])) db.get('geofences').push(g).write();
    for (const e of (data.events || [])) db.get('trackingEvents').push(e).write();

    addAudit(req.user.email, 'tracking.snapshot.restore', snap.id);
    res.json({ ok: true, restored: { shipments: (data.shipments || []).length, devices: (data.devices || []).length } });
  });

  app.delete('/api/tracking/snapshots/:id', requireAuth, (req, res) => {
    const snap = (db.get('trackingSnapshots').value() || []).find(s => s.id === req.params.id);
    if (!snap) return res.status(404).json({ error: 'Snapshot no encontrado' });
    if (!canAccessProject(req.user.id, snap.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    db.get('trackingSnapshots').remove({ id: snap.id }).write();
    res.json({ ok: true });
  });

  // ---------- Scenarios ----------
  app.get('/api/tracking/projects/:id/scenarios', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ scenarios: (db.get('scenarios').value() || []).filter(s => s.projectId === p.id) });
  });

  app.post('/api/tracking/projects/:id/scenarios', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const sc = {
      id: uuid(),
      projectId: p.id,
      name: String(b.name || 'Scenario').slice(0, 80),
      description: String(b.description || '').slice(0, 500),
      parentId: b.parentId || null,
      snapshotId: b.snapshotId || null,
      config: b.config || {},
      createdAt: new Date().toISOString(),
    };
    db.get('scenarios').push(sc).write();
    res.status(201).json(sc);
  });

  // ---------- Simulation / Stress ----------
  app.post('/api/tracking/projects/:id/simulate', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const shipmentCount = Math.min(500, Math.max(1, parseInt(b.shipmentCount, 10) || 10));
    const telemetryPerShip = Math.min(100, Math.max(1, parseInt(b.telemetryPerShip, 10) || 5));
    const seed = Number(b.seed) || Date.now();
    const start = Date.now();
    let events = 0, teleCount = 0;
    const createdIds = [];

    // simple LCG
    let rng = seed % 2147483647;
    const rand = () => { rng = (rng * 48271) % 2147483647; return (rng - 1) / 2147483646; };

    for (let i = 0; i < shipmentCount; i++) {
      const origin = { name: 'Hub A', lat: -34.6 + (rand() - 0.5) * 2, lon: -58.4 + (rand() - 0.5) * 2 };
      const dest = { name: 'Hub B', lat: -33.4 + (rand() - 0.5) * 2, lon: -70.6 + (rand() - 0.5) * 2 };
      const now = new Date().toISOString();
      const ship = {
        id: uuid(),
        projectId: p.id,
        trackingNumber: 'SIM-' + seed.toString(36).toUpperCase() + '-' + i,
        barcode: 'SIM' + i,
        status: 'IN_TRANSIT',
        origin, destination: dest, currentLocation: origin,
        plannedRoute: [origin, dest], actualRoute: [origin],
        carrier: 'SimCarrier', serviceLevel: 'standard', priority: 'normal',
        weight: Math.round(rand() * 50 * 10) / 10, volume: 0, dimensions: null,
        declaredValue: 0, riskCategory: 'low',
        temperatureRequired: rand() > 0.5 ? { min: 2, max: 8, target: 5 } : null,
        mode: 'SIMULATED', metadata: { simulation: true, seed },
        createdAt: now, updatedAt: now,
      };
      db.get('shipments').push(ship).write();
      createdIds.push(ship.id);
      events++;

      for (let t = 0; t < telemetryPerShip; t++) {
        const frac = (t + 1) / (telemetryPerShip + 1);
        const lat = origin.lat + (dest.lat - origin.lat) * frac + (rand() - 0.5) * 0.02;
        const lon = origin.lon + (dest.lon - origin.lon) * frac + (rand() - 0.5) * 0.02;
        const row = {
          id: uuid(), shipmentId: ship.id, projectId: p.id,
          deviceId: 'sim-dev-' + i, timestamp: new Date(Date.now() - (telemetryPerShip - t) * 60000).toISOString(),
          gps: { lat, lon, altitude: 50, speed: 40 + rand() * 40 },
          temperature: 4 + rand() * 3, humidity: 50 + rand() * 20,
          light: 0, impactG: 0.1 + rand() * 0.2, battery: 90 - t, signal: -70,
          mode: 'SIMULATED', source: 'SIMULATED',
        };
        db.get('telemetryReads').push(row).write();
        teleCount++;
      }
      db.get('shipments').find({ id: ship.id }).assign({
        currentLocation: { lat: dest.lat * 0.3 + origin.lat * 0.7, lon: dest.lon * 0.3 + origin.lon * 0.7 },
      }).write();
    }

    const durationMs = Date.now() - start;
    const run = {
      id: uuid(),
      projectId: p.id,
      type: b.stress ? 'stress' : 'simulation',
      name: String(b.name || 'Simulation').slice(0, 80),
      config: { shipmentCount, telemetryPerShip, seed, stress: !!b.stress },
      result: { events, telemetry: teleCount, shipmentIds: createdIds, durationMs, eventsPerSec: Math.round(teleCount / Math.max(0.001, durationMs / 1000)) },
      status: 'completed',
      createdAt: new Date().toISOString(),
    };
    db.get('simulationRuns').unshift(run).write();
    addAudit(req.user.email, 'tracking.simulation', run.id + ' n=' + shipmentCount);
    res.status(201).json(run);
  });

  app.get('/api/tracking/projects/:id/simulations', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ runs: (db.get('simulationRuns').value() || []).filter(r => r.projectId === p.id).slice(0, 50) });
  });

  // Stress profiles
  app.post('/api/tracking/projects/:id/stress', requireAuth, (req, res) => {
    const profile = (req.body || {}).profile || '10k';
    const map = {
      '1k': { shipmentCount: 50, telemetryPerShip: 20 },
      '10k': { shipmentCount: 200, telemetryPerShip: 50 },
      '50k': { shipmentCount: 400, telemetryPerShip: 100 },
      custom: {
        shipmentCount: Math.min(500, parseInt((req.body || {}).shipmentCount, 10) || 100),
        telemetryPerShip: Math.min(100, parseInt((req.body || {}).telemetryPerShip, 10) || 20),
      },
    };
    const cfg = map[profile] || map['10k'];
    // Reuse simulate by mutating req
    req.body = Object.assign({}, cfg, { stress: true, name: 'Stress ' + profile, seed: Date.now() });
    // inline call - redirect logic
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    // Call same generation with capped limits for safety
    const shipmentCount = cfg.shipmentCount;
    const telemetryPerShip = cfg.telemetryPerShip;
    const seed = Date.now();
    let rng = seed % 2147483647;
    const rand = () => { rng = (rng * 48271) % 2147483647; return (rng - 1) / 2147483646; };
    const start = Date.now();
    let teleCount = 0;
    const batch = [];
    for (let i = 0; i < shipmentCount; i++) {
      const origin = { name: 'S-A', lat: -34 + rand(), lon: -58 + rand() };
      const dest = { name: 'S-B', lat: -33 + rand(), lon: -70 + rand() };
      const ship = {
        id: uuid(), projectId: p.id, trackingNumber: 'STRESS-' + i + '-' + seed.toString(36),
        barcode: 'ST' + i, status: 'IN_TRANSIT', origin, destination: dest, currentLocation: origin,
        plannedRoute: [], actualRoute: [], carrier: 'Stress', serviceLevel: 'standard', priority: 'normal',
        weight: 1, volume: 0, dimensions: null, declaredValue: 0, riskCategory: 'low',
        temperatureRequired: null, mode: 'SIMULATED', metadata: { stress: true },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      db.get('shipments').push(ship).write();
      for (let t = 0; t < Math.min(telemetryPerShip, 30); t++) {
        db.get('telemetryReads').push({
          id: uuid(), shipmentId: ship.id, projectId: p.id, deviceId: 'stress',
          timestamp: new Date().toISOString(),
          gps: { lat: origin.lat, lon: origin.lon, altitude: 0, speed: 50 },
          temperature: 5, humidity: 50, light: 0, impactG: 0.1, battery: 80, signal: -70,
          mode: 'SIMULATED', source: 'SIMULATED',
        }).write();
        teleCount++;
      }
    }
    const durationMs = Date.now() - start;
    const run = {
      id: uuid(), projectId: p.id, type: 'stress', name: 'Stress ' + profile,
      config: { profile, shipmentCount, telemetryPerShip, seed },
      result: { telemetry: teleCount, durationMs, eventsPerSec: Math.round(teleCount / Math.max(0.001, durationMs / 1000)) },
      status: 'completed', createdAt: new Date().toISOString(),
    };
    db.get('simulationRuns').unshift(run).write();
    res.status(201).json(run);
  });

  app.get('/api/tracking/sim/meta', requireAuth, (req, res) => {
    res.json({
      phase: '5-sim',
      features: ['snapshots', 'restore', 'scenarios', 'simulation', 'stress'],
      stressProfiles: ['1k', '10k', '50k', 'custom'],
      limits: { maxShipmentsPerSim: 500, maxTelemetryPerShip: 100 },
    });
  });
};
