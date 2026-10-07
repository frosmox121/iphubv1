/**
 * Tracking Studio — Fase 3 (fases.txt): Bridge Virtual Lab
 * Interfaz desacoplada: Tracking Studio ↔ Virtual Lab vía IPC/gRPC-ready + fallback local.
 * No acopla implementaciones internas del lab; solo contrato + estado de conexión.
 */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit, crypto } = ctx;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID());

  function ensureCols() {
    if (db.get('trackingBridge').value() == null) {
      db.set('trackingBridge', {
        status: 'DISCONNECTED',
        transport: null,
        latencyMs: null,
        virtualHosts: [],
        gateways: [],
        networks: [],
        attachments: [],
        lastSync: null,
        logs: [],
      }).write();
    }
  }
  ensureCols();

  function bridge() {
    ensureCols();
    return db.get('trackingBridge').value() || {};
  }
  function save(patch) {
    const cur = bridge();
    const next = Object.assign({}, cur, patch);
    db.set('trackingBridge', next).write();
    return next;
  }
  function log(msg, level) {
    const b = bridge();
    const logs = (b.logs || []).slice(0, 199);
    logs.unshift({ ts: new Date().toISOString(), level: level || 'info', msg: String(msg).slice(0, 300) });
    save({ logs });
  }

  // ---------- Mock lab inventory (cuando no hay lab real conectado se puede simular) ----------
  function seedMockLab() {
    return {
      virtualHosts: [
        { id: 'host-1', name: 'iot-gw-ba-01', ip: '10.0.1.10', os: 'Linux', role: 'gateway', status: 'up' },
        { id: 'host-2', name: 'mqtt-broker', ip: '10.0.1.20', os: 'Linux', role: 'broker', status: 'up' },
        { id: 'host-3', name: 'tracking-api', ip: '10.0.1.30', os: 'Linux', role: 'api', status: 'up' },
        { id: 'host-4', name: 'edge-scanner', ip: '10.0.2.15', os: 'Linux', role: 'edge', status: 'up' },
      ],
      gateways: [
        { id: 'gw-1', name: 'Cellular Gateway BA', type: 'cellular', status: 'up', hosts: ['host-1'] },
        { id: 'gw-2', name: 'Satellite Fallback', type: 'satellite', status: 'up', hosts: ['host-4'] },
      ],
      networks: [
        { id: 'net-1', name: 'IoT VLAN 40', cidr: '10.0.1.0/24', status: 'up' },
        { id: 'net-2', name: 'Edge VLAN 50', cidr: '10.0.2.0/24', status: 'up' },
      ],
    };
  }

  // Status
  app.get('/api/tracking/bridge/status', requireAuth, (req, res) => {
    const b = bridge();
    res.json({
      status: b.status || 'DISCONNECTED',
      transport: b.transport,
      latencyMs: b.latencyMs,
      virtualHosts: (b.virtualHosts || []).length,
      gateways: (b.gateways || []).length,
      networks: (b.networks || []).length,
      attachments: (b.attachments || []).length,
      lastSync: b.lastSync,
      autonomous: true, // Tracking Studio works without VL
    });
  });

  app.get('/api/tracking/bridge/logs', requireAuth, (req, res) => {
    res.json({ logs: (bridge().logs || []).slice(0, 100) });
  });

  // Connect / disconnect
  app.post('/api/tracking/bridge/connect', requireAuth, (req, res) => {
    const b = req.body || {};
    const transport = ['gRPC', 'IPC', 'WebSocket', 'MOCK'].includes(b.transport) ? b.transport : 'MOCK';
    const mock = seedMockLab();
    const state = save({
      status: 'CONNECTED',
      transport,
      latencyMs: transport === 'MOCK' ? 0.5 : (1 + Math.random() * 5),
      virtualHosts: mock.virtualHosts,
      gateways: mock.gateways,
      networks: mock.networks,
      lastSync: new Date().toISOString(),
    });
    log('Bridge connected via ' + transport, 'info');
    addAudit(req.user.email, 'tracking.bridge.connect', transport);
    res.json({
      status: state.status,
      transport: state.transport,
      latencyMs: state.latencyMs,
      virtualHosts: state.virtualHosts.length,
      gateways: state.gateways.length,
      networks: state.networks.length,
    });
  });

  app.post('/api/tracking/bridge/disconnect', requireAuth, (req, res) => {
    save({
      status: 'DISCONNECTED',
      transport: null,
      latencyMs: null,
      lastSync: new Date().toISOString(),
    });
    log('Bridge disconnected', 'warn');
    addAudit(req.user.email, 'tracking.bridge.disconnect', '');
    res.json({ status: 'DISCONNECTED' });
  });

  // Lab inventory
  app.get('/api/tracking/bridge/hosts', requireAuth, (req, res) => {
    const b = bridge();
    if (b.status !== 'CONNECTED') return res.status(503).json({ error: 'Virtual Lab offline', status: b.status });
    res.json({ hosts: b.virtualHosts || [] });
  });
  app.get('/api/tracking/bridge/gateways', requireAuth, (req, res) => {
    const b = bridge();
    if (b.status !== 'CONNECTED') return res.status(503).json({ error: 'Virtual Lab offline', status: b.status });
    res.json({ gateways: b.gateways || [] });
  });
  app.get('/api/tracking/bridge/networks', requireAuth, (req, res) => {
    const b = bridge();
    if (b.status !== 'CONNECTED') return res.status(503).json({ error: 'Virtual Lab offline', status: b.status });
    res.json({ networks: b.networks || [] });
  });

  // Attach device → virtual host/gateway
  app.post('/api/tracking/bridge/attach', requireAuth, (req, res) => {
    const b = bridge();
    if (b.status !== 'CONNECTED') return res.status(503).json({ error: 'Virtual Lab offline' });
    const body = req.body || {};
    const deviceId = body.deviceId;
    const hostId = body.hostId || null;
    const gatewayId = body.gatewayId || null;
    if (!deviceId || (!hostId && !gatewayId)) {
      return res.status(400).json({ error: 'deviceId y hostId o gatewayId requeridos' });
    }
    const device = (db.get('iotDevices').value() || []).find(d => d.id === deviceId);
    if (!device) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    const att = {
      id: uuid(),
      deviceId,
      hostId,
      gatewayId,
      shipmentId: device.shipmentId || null,
      attachedAt: new Date().toISOString(),
      status: 'active',
    };
    const attachments = (b.attachments || []).filter(a => a.deviceId !== deviceId);
    attachments.push(att);
    save({ attachments });

    if (hostId) {
      db.get('iotDevices').find({ id: deviceId }).assign({
        virtualHostId: hostId,
        gateway: gatewayId || device.gateway,
        updatedAt: new Date().toISOString(),
      }).write();
    }
    log('Attached device ' + deviceId.slice(0, 8) + ' → host ' + (hostId || '') + ' gw ' + (gatewayId || ''), 'info');
    res.status(201).json(att);
  });

  app.get('/api/tracking/bridge/attachments', requireAuth, (req, res) => {
    res.json({ attachments: bridge().attachments || [] });
  });

  // Network trace: physical route + digital route
  app.get('/api/tracking/bridge/trace/:shipmentId', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.shipmentId);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    const b = bridge();
    const device = (db.get('iotDevices').value() || []).find(d => d.shipmentId === s.id);
    const att = (b.attachments || []).find(a => a.deviceId === (device && device.id));

    const physical = [];
    if (s.origin) physical.push({ step: 1, type: 'origin', name: s.origin.name || 'Origin', lat: s.origin.lat, lon: s.origin.lon });
    if (s.currentLocation) physical.push({ step: 2, type: 'current', name: 'Current', lat: s.currentLocation.lat, lon: s.currentLocation.lon });
    if (s.destination) physical.push({ step: 3, type: 'destination', name: s.destination.name || 'Destination', lat: s.destination.lat, lon: s.destination.lon });

    const digital = [];
    if (device) digital.push({ step: 1, type: 'sensor', name: device.name, id: device.id });
    if (att && att.gatewayId) {
      const gw = (b.gateways || []).find(g => g.id === att.gatewayId);
      digital.push({ step: 2, type: 'gateway', name: gw ? gw.name : att.gatewayId, id: att.gatewayId, status: gw && gw.status });
    }
    if (att && att.hostId) {
      const host = (b.virtualHosts || []).find(h => h.id === att.hostId);
      digital.push({ step: 3, type: 'host', name: host ? host.name : att.hostId, id: att.hostId, ip: host && host.ip });
    }
    digital.push({ step: 4, type: 'api', name: 'Tracking API' });
    digital.push({ step: 5, type: 'db', name: 'Tracking DB' });

    res.json({
      shipmentId: s.id,
      trackingNumber: s.trackingNumber,
      bridgeStatus: b.status,
      physical,
      digital,
      latencyMs: b.latencyMs,
    });
  });

  // Simulate lab failure effect on logistics
  app.post('/api/tracking/bridge/simulate-failure', requireAuth, (req, res) => {
    const b = bridge();
    if (b.status !== 'CONNECTED') return res.status(503).json({ error: 'Virtual Lab offline' });
    const target = (req.body || {}).target || 'gateway';
    const effects = [];
    if (target === 'gateway' || target === 'all') {
      const gws = (b.gateways || []).map(g => ({ ...g, status: 'down' }));
      save({ gateways: gws });
      effects.push('Gateways DOWN');
      // buffer devices
      const devices = db.get('iotDevices').value() || [];
      for (const d of devices) {
        if (d.virtualHostId || d.gateway) {
          db.get('iotDevices').find({ id: d.id }).assign({
            status: 'BUFFERING',
            memoryBuffer: (d.memoryBuffer || 0) + 100,
            updatedAt: new Date().toISOString(),
          }).write();
          effects.push('Device ' + d.name + ' → BUFFERING');
        }
      }
    }
    log('Simulated failure: ' + target + ' · ' + effects.join('; '), 'warn');
    res.json({ ok: true, effects });
  });

  app.post('/api/tracking/bridge/simulate-restore', requireAuth, (req, res) => {
    const b = bridge();
    const mock = seedMockLab();
    save({ gateways: mock.gateways, virtualHosts: mock.virtualHosts, networks: mock.networks });
    const devices = db.get('iotDevices').value() || [];
    for (const d of devices) {
      if (d.status === 'BUFFERING') {
        db.get('iotDevices').find({ id: d.id }).assign({
          status: 'ONLINE',
          memoryBuffer: 0,
          updatedAt: new Date().toISOString(),
        }).write();
      }
    }
    log('Connectivity restored · buffered devices flushed', 'info');
    res.json({ ok: true, message: 'Restored' });
  });

  app.get('/api/tracking/bridge/meta', requireAuth, (req, res) => {
    res.json({
      phase: '3-bridge',
      transports: ['gRPC', 'IPC', 'WebSocket', 'MOCK'],
      features: ['connect', 'hosts', 'gateways', 'networks', 'attach', 'trace', 'failure-simulation'],
      note: 'Tracking Studio funciona sin Virtual Lab. Bridge es opcional.',
    });
  });
};
