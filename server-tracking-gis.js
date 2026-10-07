/**
 * Tracking Studio — Fase 4 (fases.txt): Mapa GIS + rutas + geofences
 */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit, crypto } = ctx;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID());

  function ensureCols() {
    for (const k of ['logisticRoutes', 'geofences', 'geofenceEvents']) {
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

  const MODES = ['Road', 'Rail', 'Sea', 'Air', 'Intermodal', 'LastMile'];
  const GF_TYPES = ['Circle', 'Polygon', 'Corridor', 'Restricted', 'ColdChain', 'Custom'];

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toR = d => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function pointInCircle(lat, lon, center, radiusKm) {
    return haversineKm(lat, lon, center.lat, center.lon) <= radiusKm;
  }

  function pointInPolygon(lat, lon, polygon) {
    // ray casting
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lon, yi = polygon[i].lat;
      const xj = polygon[j].lon, yj = polygon[j].lat;
      const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // ---------- Routes ----------
  app.get('/api/tracking/projects/:id/routes', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const list = (db.get('logisticRoutes').value() || []).filter(r => r.projectId === p.id);
    res.json({ routes: list });
  });

  app.post('/api/tracking/projects/:id/routes', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const origin = b.origin || { name: 'Origin', lat: -34.6, lon: -58.4 };
    const destination = b.destination || { name: 'Destination', lat: -33.4, lon: -70.6 };
    const waypoints = Array.isArray(b.waypoints) ? b.waypoints : [];
    let distance = 0;
    const pts = [origin, ...waypoints, destination];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].lat != null && pts[i].lat != null) {
        distance += haversineKm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
      }
    }
    const route = {
      id: uuid(),
      projectId: p.id,
      name: String(b.name || 'Route').slice(0, 80),
      mode: MODES.includes(b.mode) ? b.mode : 'Road',
      origin,
      destination,
      waypoints,
      distanceKm: Math.round(distance * 10) / 10,
      etaMinutes: Number(b.etaMinutes) || Math.round((distance / 60) * 60),
      estimatedCost: Number(b.estimatedCost) || 0,
      carrier: String(b.carrier || '').slice(0, 80),
      risk: Number(b.risk) || 20,
      status: b.status || 'planned',
      shipmentIds: Array.isArray(b.shipmentIds) ? b.shipmentIds : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.get('logisticRoutes').push(route).write();
    addAudit(req.user.email, 'tracking.route.create', route.id);
    res.status(201).json(route);
  });

  app.put('/api/tracking/routes/:id', requireAuth, (req, res) => {
    const r = (db.get('logisticRoutes').value() || []).find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Ruta no encontrada' });
    if (!canAccessProject(req.user.id, r.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };
    if (b.name != null) patch.name = String(b.name).slice(0, 80);
    if (MODES.includes(b.mode)) patch.mode = b.mode;
    if (b.origin) patch.origin = b.origin;
    if (b.destination) patch.destination = b.destination;
    if (Array.isArray(b.waypoints)) patch.waypoints = b.waypoints;
    if (b.status != null) patch.status = b.status;
    if (b.carrier != null) patch.carrier = String(b.carrier).slice(0, 80);
    if (Array.isArray(b.shipmentIds)) patch.shipmentIds = b.shipmentIds;
    db.get('logisticRoutes').find({ id: r.id }).assign(patch).write();
    res.json({ ...r, ...patch });
  });

  app.delete('/api/tracking/routes/:id', requireAuth, (req, res) => {
    const r = (db.get('logisticRoutes').value() || []).find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Ruta no encontrada' });
    if (!canAccessProject(req.user.id, r.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    db.get('logisticRoutes').remove({ id: r.id }).write();
    res.json({ ok: true });
  });

  // ---------- Geofences ----------
  app.get('/api/tracking/projects/:id/geofences', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ geofences: (db.get('geofences').value() || []).filter(g => g.projectId === p.id) });
  });

  app.post('/api/tracking/projects/:id/geofences', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const gf = {
      id: uuid(),
      projectId: p.id,
      name: String(b.name || 'Geofence').slice(0, 80),
      type: GF_TYPES.includes(b.type) ? b.type : 'Circle',
      center: b.center || { lat: -34.6, lon: -58.4 },
      radiusKm: Number(b.radiusKm) || 5,
      polygon: Array.isArray(b.polygon) ? b.polygon : [],
      rules: b.rules || { onEnter: true, onExit: true, onDwell: false, maxSpeed: null, maxTemp: null },
      active: b.active !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.get('geofences').push(gf).write();
    addAudit(req.user.email, 'tracking.geofence.create', gf.id);
    res.status(201).json(gf);
  });

  app.put('/api/tracking/geofences/:id', requireAuth, (req, res) => {
    const g = (db.get('geofences').value() || []).find(x => x.id === req.params.id);
    if (!g) return res.status(404).json({ error: 'Geofence no encontrada' });
    if (!canAccessProject(req.user.id, g.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };
    if (b.name != null) patch.name = String(b.name).slice(0, 80);
    if (GF_TYPES.includes(b.type)) patch.type = b.type;
    if (b.center) patch.center = b.center;
    if (b.radiusKm != null) patch.radiusKm = Number(b.radiusKm);
    if (Array.isArray(b.polygon)) patch.polygon = b.polygon;
    if (b.rules) patch.rules = Object.assign({}, g.rules, b.rules);
    if (b.active != null) patch.active = !!b.active;
    db.get('geofences').find({ id: g.id }).assign(patch).write();
    res.json({ ...g, ...patch });
  });

  app.delete('/api/tracking/geofences/:id', requireAuth, (req, res) => {
    const g = (db.get('geofences').value() || []).find(x => x.id === req.params.id);
    if (!g) return res.status(404).json({ error: 'Geofence no encontrada' });
    if (!canAccessProject(req.user.id, g.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    db.get('geofences').remove({ id: g.id }).write();
    res.json({ ok: true });
  });

  // Evaluate geofences for a shipment location
  app.post('/api/tracking/shipments/:id/check-geofences', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const loc = (req.body && req.body.lat != null) ? req.body : (s.currentLocation || {});
    if (loc.lat == null) return res.status(400).json({ error: 'Sin ubicación' });

    const fences = (db.get('geofences').value() || []).filter(g => g.projectId === s.projectId && g.active);
    const events = [];
    for (const g of fences) {
      let inside = false;
      if (g.type === 'Circle' || g.type === 'ColdChain' || g.type === 'Restricted') {
        inside = pointInCircle(Number(loc.lat), Number(loc.lon), g.center, g.radiusKm || 5);
      } else if ((g.type === 'Polygon' || g.type === 'Custom') && g.polygon && g.polygon.length >= 3) {
        inside = pointInPolygon(Number(loc.lat), Number(loc.lon), g.polygon);
      }
      const prev = (db.get('geofenceEvents').value() || [])
        .filter(e => e.geofenceId === g.id && e.shipmentId === s.id)
        .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))[0];
      const wasInside = prev ? prev.inside : false;
      if (inside && !wasInside && g.rules && g.rules.onEnter) {
        const ev = {
          id: uuid(), projectId: s.projectId, shipmentId: s.id, geofenceId: g.id,
          eventType: 'ENTER', inside: true, ts: new Date().toISOString(),
          lat: loc.lat, lon: loc.lon, geofenceName: g.name,
        };
        db.get('geofenceEvents').unshift(ev).write();
        events.push(ev);
      } else if (!inside && wasInside && g.rules && g.rules.onExit) {
        const ev = {
          id: uuid(), projectId: s.projectId, shipmentId: s.id, geofenceId: g.id,
          eventType: 'EXIT', inside: false, ts: new Date().toISOString(),
          lat: loc.lat, lon: loc.lon, geofenceName: g.name,
        };
        db.get('geofenceEvents').unshift(ev).write();
        events.push(ev);
      } else if (inside) {
        // update state
        db.get('geofenceEvents').unshift({
          id: uuid(), projectId: s.projectId, shipmentId: s.id, geofenceId: g.id,
          eventType: 'DWELL', inside: true, ts: new Date().toISOString(),
          lat: loc.lat, lon: loc.lon, geofenceName: g.name,
        }).write();
      }
    }
    // trim
    const all = db.get('geofenceEvents').value() || [];
    if (all.length > 3000) db.set('geofenceEvents', all.slice(0, 2500)).write();
    res.json({ events, checked: fences.length });
  });

  app.get('/api/tracking/projects/:id/geofence-events', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const list = (db.get('geofenceEvents').value() || [])
      .filter(e => e.projectId === p.id)
      .slice(0, 200);
    res.json({ events: list });
  });

  // GIS map payload: shipments + routes + geofences positions
  app.get('/api/tracking/projects/:id/gis', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === p.id);
    const routes = (db.get('logisticRoutes').value() || []).filter(r => r.projectId === p.id);
    const fences = (db.get('geofences').value() || []).filter(g => g.projectId === p.id);
    res.json({
      markers: ships.map(s => ({
        id: s.id,
        type: 'shipment',
        trackingNumber: s.trackingNumber,
        status: s.status,
        lat: s.currentLocation && s.currentLocation.lat,
        lon: s.currentLocation && s.currentLocation.lon,
        origin: s.origin,
        destination: s.destination,
        actualRoute: (s.actualRoute || []).slice(-100),
      })),
      routes,
      geofences: fences,
    });
  });

  app.get('/api/tracking/gis/meta', requireAuth, (req, res) => {
    res.json({
      phase: '4-gis',
      routeModes: MODES,
      geofenceTypes: GF_TYPES,
      features: ['routes', 'geofences', 'enter-exit-dwell', 'gis-payload'],
    });
  });
};
