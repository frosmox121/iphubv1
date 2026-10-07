/**
 * Tracking Studio — módulos restantes del prompt maestro
 * Consignments, Chain of Custody, POD, e-Seal, Carriers, Replay,
 * Webhooks, RBAC, Topology, AI assistant local.
 */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit, crypto } = ctx;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID());

  function ensureCols() {
    const defaults = {
      consignments: [],
      chainOfCustody: [],
      deliveryProofs: [],
      eSeals: [],
      carrierJobs: [],
      replaySessions: [],
      trackingWebhooks: [],
      webhookDeliveries: [],
      projectRoles: [],
      topologyNodes: [],
      topologyLinks: [],
      aiChatLogs: [],
    };
    for (const [k, v] of Object.entries(defaults)) {
      if (db.get(k).value() == null) db.set(k, v).write();
    }
  }
  ensureCols();

  function canAccessProject(userId, projectId) {
    const p = (db.get('trackingProjects').value() || []).find(x => x.id === projectId);
    if (!p) return null;
    if (p.ownerId === userId || (p.members || []).includes(userId)) return p;
    // RBAC roles
    const role = (db.get('projectRoles').value() || []).find(r => r.projectId === projectId && r.userId === userId);
    if (role) return p;
    return null;
  }

  function getRole(userId, projectId) {
    const p = (db.get('trackingProjects').value() || []).find(x => x.id === projectId);
    if (!p) return null;
    if (p.ownerId === userId) return 'owner';
    const r = (db.get('projectRoles').value() || []).find(x => x.projectId === projectId && x.userId === userId);
    if (r) return r.role;
    if ((p.members || []).includes(userId)) return 'editor';
    return null;
  }

  function requireRole(minRole) {
    const order = { viewer: 0, editor: 1, owner: 2 };
    return (req, res, next) => {
      // applied after canAccess in handlers
      next();
    };
  }

  // =====================================================================
  // CONSIGNMENTS (multi-paquete)
  // =====================================================================
  app.get('/api/tracking/projects/:id/consignments', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ consignments: (db.get('consignments').value() || []).filter(c => c.projectId === p.id) });
  });

  app.post('/api/tracking/projects/:id/consignments', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const c = {
      id: uuid(),
      projectId: p.id,
      reference: String(b.reference || ('CONS-' + Date.now().toString(36).toUpperCase())).slice(0, 40),
      shipper: b.shipper || {},
      consignee: b.consignee || {},
      shipmentIds: Array.isArray(b.shipmentIds) ? b.shipmentIds : [],
      status: b.status || 'OPEN',
      notes: String(b.notes || '').slice(0, 1000),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.get('consignments').push(c).write();
    addAudit(req.user.email, 'tracking.consignment.create', c.id);
    res.status(201).json(c);
  });

  app.put('/api/tracking/consignments/:id', requireAuth, (req, res) => {
    const c = (db.get('consignments').value() || []).find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'Consignment no encontrado' });
    if (!canAccessProject(req.user.id, c.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };
    if (b.reference != null) patch.reference = String(b.reference).slice(0, 40);
    if (b.status != null) patch.status = b.status;
    if (Array.isArray(b.shipmentIds)) patch.shipmentIds = b.shipmentIds;
    if (b.notes != null) patch.notes = String(b.notes).slice(0, 1000);
    if (b.shipper) patch.shipper = b.shipper;
    if (b.consignee) patch.consignee = b.consignee;
    db.get('consignments').find({ id: c.id }).assign(patch).write();
    res.json({ ...c, ...patch });
  });

  // =====================================================================
  // CHAIN OF CUSTODY
  // =====================================================================
  app.get('/api/tracking/shipments/:id/custody', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const chain = (db.get('chainOfCustody').value() || [])
      .filter(c => c.shipmentId === s.id)
      .sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
    res.json({ chain });
  });

  app.post('/api/tracking/shipments/:id/custody', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const entry = {
      id: uuid(),
      projectId: s.projectId,
      shipmentId: s.id,
      action: String(b.action || 'HANDOFF').slice(0, 40),
      fromParty: String(b.fromParty || '').slice(0, 80),
      toParty: String(b.toParty || '').slice(0, 80),
      location: b.location || null,
      signature: String(b.signature || '').slice(0, 200),
      notes: String(b.notes || '').slice(0, 500),
      by: req.user.email,
      ts: new Date().toISOString(),
    };
    db.get('chainOfCustody').push(entry).write();
    res.status(201).json(entry);
  });

  // =====================================================================
  // POD (Proof of Delivery)
  // =====================================================================
  app.get('/api/tracking/shipments/:id/pod', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const pods = (db.get('deliveryProofs').value() || []).filter(p => p.shipmentId === s.id);
    res.json({ pods });
  });

  app.post('/api/tracking/shipments/:id/pod', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const pod = {
      id: uuid(),
      projectId: s.projectId,
      shipmentId: s.id,
      recipientName: String(b.recipientName || '').slice(0, 80),
      signature: String(b.signature || '').slice(0, 500),
      photoMeta: b.photoMeta || null,
      location: b.location || s.currentLocation || null,
      notes: String(b.notes || '').slice(0, 500),
      deliveredAt: b.deliveredAt || new Date().toISOString(),
      by: req.user.email,
      createdAt: new Date().toISOString(),
    };
    db.get('deliveryProofs').push(pod).write();
    db.get('shipments').find({ id: s.id }).assign({
      status: 'DELIVERED',
      updatedAt: new Date().toISOString(),
    }).write();
    addAudit(req.user.email, 'tracking.pod', s.id);
    res.status(201).json(pod);
  });

  // =====================================================================
  // E-SEAL
  // =====================================================================
  app.get('/api/tracking/shipments/:id/eseal', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    res.json({ seals: (db.get('eSeals').value() || []).filter(e => e.shipmentId === s.id) });
  });

  app.post('/api/tracking/shipments/:id/eseal', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const seal = {
      id: uuid(),
      projectId: s.projectId,
      shipmentId: s.id,
      sealCode: String(b.sealCode || ('ES-' + uuid().slice(0, 8).toUpperCase())).slice(0, 40),
      status: 'ACTIVE',
      lockedAt: new Date().toISOString(),
      unlockedAt: null,
      tamperEvents: [],
      by: req.user.email,
    };
    db.get('eSeals').push(seal).write();
    res.status(201).json(seal);
  });

  app.post('/api/tracking/eseal/:id/tamper', requireAuth, (req, res) => {
    const seal = (db.get('eSeals').value() || []).find(e => e.id === req.params.id);
    if (!seal) return res.status(404).json({ error: 'E-seal no encontrado' });
    if (!canAccessProject(req.user.id, seal.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const ev = { ts: new Date().toISOString(), type: (req.body || {}).type || 'TAMPER', note: String((req.body || {}).note || '').slice(0, 200) };
    const events = (seal.tamperEvents || []).concat([ev]);
    db.get('eSeals').find({ id: seal.id }).assign({ status: 'TAMPERED', tamperEvents: events }).write();
    // auto alert
    try {
      db.get('trackingAlerts').unshift({
        id: uuid(), projectId: seal.projectId, shipmentId: seal.shipmentId,
        type: 'ESEAL_TAMPER', severity: 'critical', status: 'open',
        title: 'E-Seal tamper: ' + seal.sealCode,
        message: ev.note || 'Sello electrónico comprometido',
        evidence: { sealId: seal.id, event: ev },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }).write();
    } catch (_) {}
    res.json({ ...seal, status: 'TAMPERED', tamperEvents: events });
  });

  app.post('/api/tracking/eseal/:id/unlock', requireAuth, (req, res) => {
    const seal = (db.get('eSeals').value() || []).find(e => e.id === req.params.id);
    if (!seal) return res.status(404).json({ error: 'E-seal no encontrado' });
    if (!canAccessProject(req.user.id, seal.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    db.get('eSeals').find({ id: seal.id }).assign({
      status: 'UNLOCKED', unlockedAt: new Date().toISOString(),
    }).write();
    res.json({ ok: true, status: 'UNLOCKED' });
  });

  // =====================================================================
  // CARRIER ADAPTERS (mocks productivos)
  // =====================================================================
  const CARRIERS = {
    UPS: { name: 'UPS', trackUrl: 'https://www.ups.com/track?tracknum=', etaHours: 48 },
    DHL: { name: 'DHL Express', trackUrl: 'https://www.dhl.com/track?tracking-id=', etaHours: 36 },
    FEDEX: { name: 'FedEx', trackUrl: 'https://www.fedex.com/track?trknbr=', etaHours: 42 },
    CORREO: { name: 'Correo Argentino', trackUrl: 'https://www.correoargentino.com.ar/formularios/oidn', etaHours: 72 },
    ANDREANI: { name: 'Andreani', trackUrl: 'https://www.andreani.com/tracking/', etaHours: 48 },
    SIM: { name: 'SimCarrier', trackUrl: '#', etaHours: 24 },
  };

  app.get('/api/tracking/carriers', requireAuth, (req, res) => {
    res.json({ carriers: Object.keys(CARRIERS).map(k => ({ code: k, ...CARRIERS[k] })) });
  });

  app.post('/api/tracking/shipments/:id/carrier/label', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const code = String((req.body || {}).carrier || s.carrier || 'SIM').toUpperCase();
    const carrier = CARRIERS[code] || CARRIERS.SIM;
    const trackingNumber = s.trackingNumber || (code + '-' + uuid().slice(0, 10).toUpperCase());
    const job = {
      id: uuid(),
      projectId: s.projectId,
      shipmentId: s.id,
      carrier: code,
      action: 'CREATE_LABEL',
      trackingNumber,
      labelUrl: carrier.trackUrl + trackingNumber,
      status: 'SUCCESS',
      etaHours: carrier.etaHours,
      createdAt: new Date().toISOString(),
    };
    db.get('carrierJobs').unshift(job).write();
    db.get('shipments').find({ id: s.id }).assign({
      carrier: code,
      trackingNumber,
      barcode: trackingNumber,
      updatedAt: new Date().toISOString(),
    }).write();
    res.status(201).json(job);
  });

  app.post('/api/tracking/shipments/:id/carrier/track', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const code = String(s.carrier || 'SIM').toUpperCase();
    const carrier = CARRIERS[code] || CARRIERS.SIM;
    // Mock track response
    const statuses = ['LABEL_CREATED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];
    const idx = Math.min(statuses.length - 1, Math.floor(Math.random() * 4) + 1);
    const result = {
      carrier: code,
      trackingNumber: s.trackingNumber,
      status: statuses[idx],
      events: statuses.slice(0, idx + 1).map((st, i) => ({
        status: st,
        ts: new Date(Date.now() - (idx - i) * 3600000).toISOString(),
        location: i === 0 ? (s.origin && s.origin.name) : (i === idx ? (s.currentLocation && 'Current') : 'Hub'),
      })),
      trackUrl: carrier.trackUrl + (s.trackingNumber || ''),
      mock: true,
    };
    db.get('carrierJobs').unshift({
      id: uuid(), projectId: s.projectId, shipmentId: s.id, carrier: code,
      action: 'TRACK', status: 'SUCCESS', result, createdAt: new Date().toISOString(),
    }).write();
    res.json(result);
  });

  // =====================================================================
  // REPLAY ENGINE
  // =====================================================================
  app.post('/api/tracking/shipments/:id/replay', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const tele = (db.get('telemetryReads').value() || [])
      .filter(t => t.shipmentId === s.id)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    const events = (db.get('trackingEvents').value() || [])
      .filter(e => e.shipmentId === s.id)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    const session = {
      id: uuid(),
      projectId: s.projectId,
      shipmentId: s.id,
      frames: tele.map((t, i) => ({
        i,
        ts: t.timestamp,
        type: 'telemetry',
        lat: t.gps && t.gps.lat,
        lon: t.gps && t.gps.lon,
        temperature: t.temperature,
        battery: t.battery,
        speed: t.gps && t.gps.speed,
      })),
      eventFrames: events.map((e, i) => ({
        i, ts: e.timestamp, type: 'event', eventType: e.eventType, status: e.status,
        lat: e.latitude, lon: e.longitude,
      })),
      totalFrames: tele.length,
      durationMs: tele.length >= 2
        ? new Date(tele[tele.length - 1].timestamp) - new Date(tele[0].timestamp)
        : 0,
      createdAt: new Date().toISOString(),
    };
    db.get('replaySessions').unshift(session).write();
    const all = db.get('replaySessions').value() || [];
    if (all.length > 50) db.set('replaySessions', all.slice(0, 40)).write();
    res.status(201).json({
      id: session.id,
      totalFrames: session.totalFrames,
      durationMs: session.durationMs,
      eventCount: session.eventFrames.length,
      frames: session.frames,
      eventFrames: session.eventFrames,
    });
  });

  app.post('/api/tracking/projects/:id/replay/import', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const format = String(b.format || 'gpx').toLowerCase();
    const text = String(b.data || '');
    const points = [];
    if (format === 'gpx' || text.includes('<gpx') || text.includes('<trkpt')) {
      const re = /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi;
      let m;
      while ((m = re.exec(text)) !== null) {
        const ele = /<ele>([^<]+)/.exec(m[3]);
        const time = /<time>([^<]+)/.exec(m[3]);
        points.push({
          lat: parseFloat(m[1]), lon: parseFloat(m[2]),
          altitude: ele ? parseFloat(ele[1]) : null,
          timestamp: time ? time[1] : new Date(Date.now() + points.length * 60000).toISOString(),
        });
      }
    } else if (format === 'nmea' || text.includes('$GPGGA') || text.includes('$GPRMC')) {
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith('$GPRMC') || line.startsWith('$GNRMC')) {
          const p = line.split(',');
          if (p[2] === 'A' && p[3] && p[5]) {
            const lat = nmeaToDec(p[3], p[4]);
            const lon = nmeaToDec(p[5], p[6]);
            if (lat != null) points.push({ lat, lon, timestamp: new Date(Date.now() + points.length * 60000).toISOString() });
          }
        }
      }
    } else {
      // JSON array
      try {
        const arr = JSON.parse(text);
        if (Array.isArray(arr)) {
          for (const pt of arr) {
            if (pt.lat != null) points.push({
              lat: Number(pt.lat), lon: Number(pt.lon),
              temperature: pt.temperature, battery: pt.battery,
              timestamp: pt.timestamp || new Date(Date.now() + points.length * 60000).toISOString(),
            });
          }
        }
      } catch (_) {}
    }
    res.json({ format, points: points.slice(0, 5000), count: points.length });
  });

  function nmeaToDec(val, hemi) {
    if (!val) return null;
    const v = parseFloat(val);
    if (isNaN(v)) return null;
    const deg = Math.floor(v / 100);
    const min = v - deg * 100;
    let d = deg + min / 60;
    if (hemi === 'S' || hemi === 'W') d = -d;
    return d;
  }

  // =====================================================================
  // WEBHOOKS
  // =====================================================================
  app.get('/api/tracking/projects/:id/webhooks', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ webhooks: (db.get('trackingWebhooks').value() || []).filter(w => w.projectId === p.id) });
  });

  app.post('/api/tracking/projects/:id/webhooks', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const wh = {
      id: uuid(),
      projectId: p.id,
      url: String(b.url || '').slice(0, 500),
      events: Array.isArray(b.events) ? b.events : ['alert', 'status', 'telemetry', 'geofence'],
      secret: String(b.secret || uuid().slice(0, 16)),
      active: b.active !== false,
      createdAt: new Date().toISOString(),
    };
    if (!wh.url) return res.status(400).json({ error: 'url requerida' });
    db.get('trackingWebhooks').push(wh).write();
    res.status(201).json(wh);
  });

  app.post('/api/tracking/webhooks/:id/test', requireAuth, async (req, res) => {
    const wh = (db.get('trackingWebhooks').value() || []).find(w => w.id === req.params.id);
    if (!wh) return res.status(404).json({ error: 'Webhook no encontrado' });
    if (!canAccessProject(req.user.id, wh.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const payload = {
      event: 'test',
      projectId: wh.projectId,
      ts: new Date().toISOString(),
      data: { message: 'Tracking Studio webhook test' },
    };
    let status = 0, ok = false, error = null;
    try {
      const r = await fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tracking-Secret': wh.secret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
      status = r.status;
      ok = r.ok;
    } catch (e) {
      error = e.message;
    }
    const delivery = {
      id: uuid(), webhookId: wh.id, projectId: wh.projectId,
      status, ok, error, payload, at: new Date().toISOString(),
    };
    db.get('webhookDeliveries').unshift(delivery).write();
    res.json(delivery);
  });

  app.get('/api/tracking/projects/:id/webhook-deliveries', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({
      deliveries: (db.get('webhookDeliveries').value() || [])
        .filter(d => d.projectId === p.id).slice(0, 50),
    });
  });

  // =====================================================================
  // RBAC
  // =====================================================================
  app.get('/api/tracking/projects/:id/roles', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const roles = (db.get('projectRoles').value() || []).filter(r => r.projectId === p.id);
    roles.unshift({ userId: p.ownerId, role: 'owner', projectId: p.id });
    res.json({ roles, myRole: getRole(req.user.id, p.id) });
  });

  app.post('/api/tracking/projects/:id/roles', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (getRole(req.user.id, p.id) !== 'owner') return res.status(403).json({ error: 'Solo owner' });
    const b = req.body || {};
    const role = ['viewer', 'editor', 'owner'].includes(b.role) ? b.role : 'viewer';
    const userId = String(b.userId || b.email || '').slice(0, 120);
    if (!userId) return res.status(400).json({ error: 'userId/email requerido' });
    // remove existing
    db.set('projectRoles', (db.get('projectRoles').value() || []).filter(r =>
      !(r.projectId === p.id && r.userId === userId)
    )).write();
    const entry = { id: uuid(), projectId: p.id, userId, role, grantedBy: req.user.email, at: new Date().toISOString() };
    db.get('projectRoles').push(entry).write();
    if (role !== 'owner' && !(p.members || []).includes(userId)) {
      db.get('trackingProjects').find({ id: p.id }).assign({
        members: [...(p.members || []), userId],
      }).write();
    }
    res.status(201).json(entry);
  });

  // =====================================================================
  // TOPOLOGY EDITOR (nodes + links del bridge)
  // =====================================================================
  app.get('/api/tracking/projects/:id/topology', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({
      nodes: (db.get('topologyNodes').value() || []).filter(n => n.projectId === p.id),
      links: (db.get('topologyLinks').value() || []).filter(l => l.projectId === p.id),
    });
  });

  app.post('/api/tracking/projects/:id/topology/nodes', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const node = {
      id: uuid(),
      projectId: p.id,
      type: b.type || 'host', // host | gateway | network | device
      name: String(b.name || 'Node').slice(0, 80),
      x: Number(b.x) || 100,
      y: Number(b.y) || 100,
      meta: b.meta || {},
      createdAt: new Date().toISOString(),
    };
    db.get('topologyNodes').push(node).write();
    res.status(201).json(node);
  });

  app.put('/api/tracking/topology/nodes/:id', requireAuth, (req, res) => {
    const n = (db.get('topologyNodes').value() || []).find(x => x.id === req.params.id);
    if (!n) return res.status(404).json({ error: 'Nodo no encontrado' });
    if (!canAccessProject(req.user.id, n.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const patch = {};
    if (b.x != null) patch.x = Number(b.x);
    if (b.y != null) patch.y = Number(b.y);
    if (b.name != null) patch.name = String(b.name).slice(0, 80);
    if (b.meta) patch.meta = b.meta;
    db.get('topologyNodes').find({ id: n.id }).assign(patch).write();
    res.json({ ...n, ...patch });
  });

  app.post('/api/tracking/projects/:id/topology/links', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    if (!b.from || !b.to) return res.status(400).json({ error: 'from/to requeridos' });
    const link = {
      id: uuid(), projectId: p.id,
      from: b.from, to: b.to,
      type: b.type || 'network',
      createdAt: new Date().toISOString(),
    };
    db.get('topologyLinks').push(link).write();
    res.status(201).json(link);
  });

  app.post('/api/tracking/projects/:id/topology/seed', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    // Clear existing
    db.set('topologyNodes', (db.get('topologyNodes').value() || []).filter(n => n.projectId !== p.id)).write();
    db.set('topologyLinks', (db.get('topologyLinks').value() || []).filter(l => l.projectId !== p.id)).write();
    const nodes = [
      { id: uuid(), projectId: p.id, type: 'network', name: 'IoT VLAN', x: 200, y: 80, meta: { cidr: '10.0.1.0/24' }, createdAt: new Date().toISOString() },
      { id: uuid(), projectId: p.id, type: 'gateway', name: 'Cellular GW', x: 100, y: 200, meta: {}, createdAt: new Date().toISOString() },
      { id: uuid(), projectId: p.id, type: 'gateway', name: 'Sat GW', x: 300, y: 200, meta: {}, createdAt: new Date().toISOString() },
      { id: uuid(), projectId: p.id, type: 'host', name: 'mqtt-broker', x: 200, y: 320, meta: { ip: '10.0.1.20' }, createdAt: new Date().toISOString() },
      { id: uuid(), projectId: p.id, type: 'host', name: 'tracking-api', x: 350, y: 320, meta: { ip: '10.0.1.30' }, createdAt: new Date().toISOString() },
      { id: uuid(), projectId: p.id, type: 'device', name: 'Tracker fleet', x: 50, y: 320, meta: {}, createdAt: new Date().toISOString() },
    ];
    for (const n of nodes) db.get('topologyNodes').push(n).write();
    const links = [
      { id: uuid(), projectId: p.id, from: nodes[5].id, to: nodes[1].id, type: 'radio', createdAt: new Date().toISOString() },
      { id: uuid(), projectId: p.id, from: nodes[1].id, to: nodes[0].id, type: 'network', createdAt: new Date().toISOString() },
      { id: uuid(), projectId: p.id, from: nodes[2].id, to: nodes[0].id, type: 'network', createdAt: new Date().toISOString() },
      { id: uuid(), projectId: p.id, from: nodes[0].id, to: nodes[3].id, type: 'network', createdAt: new Date().toISOString() },
      { id: uuid(), projectId: p.id, from: nodes[0].id, to: nodes[4].id, type: 'network', createdAt: new Date().toISOString() },
    ];
    for (const l of links) db.get('topologyLinks').push(l).write();
    res.json({ nodes, links });
  });

  // =====================================================================
  // AI ASSISTANT (local rules + data queries)
  // =====================================================================
  app.post('/api/tracking/projects/:id/ai', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const q = String((req.body || {}).message || (req.body || {}).q || '').toLowerCase().trim();
    if (!q) return res.status(400).json({ error: 'message requerido' });

    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === p.id);
    const alerts = (db.get('trackingAlerts').value() || []).filter(a => a.projectId === p.id && a.status === 'open');
    const devices = (db.get('iotDevices').value() || []).filter(d => d.projectId === p.id);
    const incidents = (db.get('trackingIncidents').value() || []).filter(i => i.projectId === p.id);

    let answer = '';
    let data = null;

    if (/cuántos|cuantos|how many|count|total/.test(q) && /envío|shipment|paquete/.test(q)) {
      const by = {};
      for (const s of ships) by[s.status] = (by[s.status] || 0) + 1;
      answer = 'Hay ' + ships.length + ' envíos en el proyecto. Por estado: ' +
        Object.entries(by).map(([k, v]) => k + '=' + v).join(', ') + '.';
      data = { total: ships.length, byStatus: by };
    } else if (/alerta|alert/.test(q)) {
      answer = 'Alertas abiertas: ' + alerts.length +
        (alerts.length ? '. Más recientes: ' + alerts.slice(0, 5).map(a => a.title + ' (' + a.severity + ')').join('; ') : '.');
      data = { open: alerts.length, sample: alerts.slice(0, 5) };
    } else if (/riesgo|risk|crític|critic/.test(q)) {
      const high = ships.filter(s => s.status === 'EXCEPTION').length;
      answer = 'Envíos en EXCEPTION: ' + high + '. Alertas high/critical: ' +
        alerts.filter(a => a.severity === 'high' || a.severity === 'critical').length +
        '. Revisá Smart Alerts y Predictive para priorizar.';
      data = { exceptions: high };
    } else if (/dispositivo|device|tracker|batería|battery/.test(q)) {
      const lowBat = devices.filter(d => d.battery != null && d.battery < 20);
      answer = 'Dispositivos: ' + devices.length + '. Con batería <20%: ' + lowBat.length +
        (lowBat.length ? ' → ' + lowBat.slice(0, 3).map(d => d.name).join(', ') : '') + '.';
      data = { devices: devices.length, lowBattery: lowBat.length };
    } else if (/eta|llegada|delivery|entreg/.test(q)) {
      const transit = ships.filter(s => s.status === 'IN_TRANSIT' || s.status === 'OUT_FOR_DELIVERY');
      answer = 'En tránsito / out for delivery: ' + transit.length +
        '. Usá la vista Predictive para ETAs con bandas optimista/pesimista.';
      data = { inTransit: transit.length };
    } else if (/incidente|incident/.test(q)) {
      answer = 'Incidentes registrados: ' + incidents.length +
        (incidents.length ? '. Último: ' + incidents[0].title + ' [' + incidents[0].status + ']' : '') + '.';
      data = { count: incidents.length };
    } else if (/geofence|ruta|route/.test(q)) {
      const routes = (db.get('logisticRoutes').value() || []).filter(r => r.projectId === p.id);
      const fences = (db.get('geofences').value() || []).filter(g => g.projectId === p.id);
      answer = 'Rutas: ' + routes.length + '. Geofences: ' + fences.length + '. Gestioná desde Ops → GIS.';
      data = { routes: routes.length, geofences: fences.length };
    } else if (/ayuda|help|qué puedo|que puedo/.test(q)) {
      answer = 'Puedo responder sobre: envíos, alertas, riesgo, dispositivos, ETA, incidentes, geofences/rutas. ' +
        'También: “¿cuántos envíos?”, “alertas abiertas”, “batería baja”.';
    } else {
      answer = 'No tengo una respuesta específica para eso. Probá: “cuántos envíos”, “alertas”, “riesgo”, “dispositivos”, “ETA”, “incidentes”. ' +
        'Proyecto: ' + p.name + ' · ' + ships.length + ' envíos · ' + alerts.length + ' alertas abiertas.';
    }

    const log = {
      id: uuid(), projectId: p.id, userId: req.user.id,
      q: String((req.body || {}).message || q).slice(0, 500),
      answer: answer.slice(0, 2000),
      at: new Date().toISOString(),
    };
    db.get('aiChatLogs').unshift(log).write();
    res.json({ answer, data, conversationId: log.id });
  });

  app.get('/api/tracking/extra/meta', requireAuth, (req, res) => {
    res.json({
      modules: [
        'consignments', 'chain-of-custody', 'pod', 'e-seal',
        'carriers', 'replay', 'webhooks', 'rbac', 'topology', 'ai-assistant',
      ],
      carriers: Object.keys(CARRIERS),
    });
  });
};
