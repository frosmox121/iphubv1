/**
 * Tracking Studio — Fase 6 (fases.txt): Incidentes + reportes (+ code intel básico)
 */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit, crypto } = ctx;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID());

  function ensureCols() {
    for (const k of ['trackingIncidents', 'trackingReports', 'trackingCodeFindings']) {
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

  const INCIDENT_STATUS = ['DETECTED', 'INVESTIGATING', 'CONTAINED', 'REMEDIATING', 'RESOLVED', 'CLOSED'];
  const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];

  // ---------- Incidents ----------
  app.get('/api/tracking/projects/:id/incidents', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const list = (db.get('trackingIncidents').value() || [])
      .filter(i => i.projectId === p.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ incidents: list });
  });

  app.post('/api/tracking/projects/:id/incidents', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const b = req.body || {};
    const inc = {
      id: uuid(),
      projectId: p.id,
      title: String(b.title || 'Incident').slice(0, 160),
      description: String(b.description || '').slice(0, 2000),
      severity: SEVERITIES.includes(b.severity) ? b.severity : 'medium',
      priority: String(b.priority || 'normal').slice(0, 20),
      status: INCIDENT_STATUS.includes(b.status) ? b.status : 'DETECTED',
      owner: req.user.email,
      affectedShipments: Array.isArray(b.affectedShipments) ? b.affectedShipments : [],
      affectedDevices: Array.isArray(b.affectedDevices) ? b.affectedDevices : [],
      alertIds: Array.isArray(b.alertIds) ? b.alertIds : [],
      rootCause: String(b.rootCause || '').slice(0, 1000),
      resolution: String(b.resolution || '').slice(0, 1000),
      timeline: [{ ts: new Date().toISOString(), action: 'created', by: req.user.email }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.get('trackingIncidents').unshift(inc).write();
    addAudit(req.user.email, 'tracking.incident.create', inc.id);
    res.status(201).json(inc);
  });

  app.patch('/api/tracking/incidents/:id', requireAuth, (req, res) => {
    const inc = (db.get('trackingIncidents').value() || []).find(x => x.id === req.params.id);
    if (!inc) return res.status(404).json({ error: 'Incidente no encontrado' });
    if (!canAccessProject(req.user.id, inc.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };
    if (b.title != null) patch.title = String(b.title).slice(0, 160);
    if (SEVERITIES.includes(b.severity)) patch.severity = b.severity;
    if (INCIDENT_STATUS.includes(b.status)) patch.status = b.status;
    if (b.rootCause != null) patch.rootCause = String(b.rootCause).slice(0, 1000);
    if (b.resolution != null) patch.resolution = String(b.resolution).slice(0, 1000);
    if (Array.isArray(b.affectedShipments)) patch.affectedShipments = b.affectedShipments;
    const timeline = (inc.timeline || []).concat([{
      ts: patch.updatedAt, action: b.status ? 'status:' + b.status : 'updated', by: req.user.email,
    }]);
    patch.timeline = timeline.slice(-50);
    db.get('trackingIncidents').find({ id: inc.id }).assign(patch).write();
    res.json({ ...inc, ...patch });
  });

  // Auto-create incident from open critical alerts
  app.post('/api/tracking/projects/:id/incidents/from-alerts', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const critical = (db.get('trackingAlerts').value() || []).filter(a =>
      a.projectId === p.id && a.status === 'open' && (a.severity === 'critical' || a.severity === 'high')
    );
    if (!critical.length) return res.json({ created: null, message: 'No hay alertas críticas abiertas' });
    const ships = [...new Set(critical.map(a => a.shipmentId).filter(Boolean))];
    const inc = {
      id: uuid(),
      projectId: p.id,
      title: 'Auto-incident: ' + critical.length + ' alertas críticas/high',
      description: critical.map(a => a.title).slice(0, 10).join('; '),
      severity: critical.some(a => a.severity === 'critical') ? 'critical' : 'high',
      priority: 'high',
      status: 'DETECTED',
      owner: req.user.email,
      affectedShipments: ships,
      affectedDevices: [],
      alertIds: critical.map(a => a.id),
      rootCause: '',
      resolution: '',
      timeline: [{ ts: new Date().toISOString(), action: 'auto-created-from-alerts', by: req.user.email }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.get('trackingIncidents').unshift(inc).write();
    res.status(201).json(inc);
  });

  // ---------- Reports ----------
  app.get('/api/tracking/projects/:id/reports', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ reports: (db.get('trackingReports').value() || []).filter(r => r.projectId === p.id).slice(0, 50) });
  });

  app.post('/api/tracking/projects/:id/reports', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const type = String((req.body || {}).type || 'executive').slice(0, 40);
    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === p.id);
    const alerts = (db.get('trackingAlerts').value() || []).filter(a => a.projectId === p.id);
    const incidents = (db.get('trackingIncidents').value() || []).filter(i => i.projectId === p.id);
    const tele = (db.get('telemetryReads').value() || []).filter(t => t.projectId === p.id);
    const byStatus = {};
    for (const s of ships) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    const openAlerts = alerts.filter(a => a.status === 'open').length;

    const report = {
      id: uuid(),
      projectId: p.id,
      type,
      title: String((req.body || {}).title || ('Report ' + type + ' · ' + p.name)).slice(0, 160),
      createdAt: new Date().toISOString(),
      createdBy: req.user.email,
      summary: {
        shipments: ships.length,
        byStatus,
        openAlerts,
        incidents: incidents.length,
        telemetryReads: tele.length,
        delivered: byStatus.DELIVERED || 0,
        exceptions: byStatus.EXCEPTION || 0,
        otifProxy: ships.length ? Math.round(((byStatus.DELIVERED || 0) / ships.length) * 100) : 0,
      },
      sections: [
        { name: 'Overview', content: 'Project ' + p.name + ' · mode ' + (p.mode || 'SIMULATED') },
        { name: 'Shipments', content: ships.length + ' total · ' + (byStatus.IN_TRANSIT || 0) + ' in transit · ' + (byStatus.EXCEPTION || 0) + ' exceptions' },
        { name: 'Alerts', content: openAlerts + ' open · ' + alerts.length + ' total' },
        { name: 'Incidents', content: incidents.length + ' registered' },
        { name: 'Telemetry', content: tele.length + ' readings stored' },
      ],
    };
    db.get('trackingReports').unshift(report).write();
    addAudit(req.user.email, 'tracking.report.create', report.id);
    res.status(201).json(report);
  });

  app.get('/api/tracking/reports/:id', requireAuth, (req, res) => {
    const r = (db.get('trackingReports').value() || []).find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'Reporte no encontrado' });
    if (!canAccessProject(req.user.id, r.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    res.json(r);
  });

  // ---------- Code intel básico (patrones en payloads / metadata) ----------
  app.post('/api/tracking/projects/:id/code-scan', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const findings = [];
    // Scan events payloads and shipment metadata for secret-like patterns
    const secretRe = /(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{12,}/i;
    const events = (db.get('trackingEvents').value() || []).filter(e => e.projectId === p.id).slice(0, 500);
    for (const e of events) {
      const raw = JSON.stringify(e.payload || {});
      if (secretRe.test(raw)) {
        findings.push({
          id: uuid(),
          projectId: p.id,
          type: 'SECRET_IN_PAYLOAD',
          severity: 'high',
          entity: 'event:' + e.id,
          message: 'Posible secreto en payload de evento',
          snippet: raw.slice(0, 80).replace(secretRe, '$1=****'),
          createdAt: new Date().toISOString(),
        });
      }
    }
    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === p.id);
    for (const s of ships) {
      const raw = JSON.stringify(s.metadata || {});
      if (secretRe.test(raw)) {
        findings.push({
          id: uuid(),
          projectId: p.id,
          type: 'SECRET_IN_METADATA',
          severity: 'high',
          entity: 'shipment:' + s.trackingNumber,
          message: 'Posible secreto en metadata de envío',
          snippet: '****',
          createdAt: new Date().toISOString(),
        });
      }
      if (!s.temperatureRequired && s.riskCategory === 'high') {
        findings.push({
          id: uuid(),
          projectId: p.id,
          type: 'MISSING_COLD_CHAIN_CONFIG',
          severity: 'medium',
          entity: 'shipment:' + s.trackingNumber,
          message: 'Envío high-risk sin temperatureRequired',
          snippet: '',
          createdAt: new Date().toISOString(),
        });
      }
    }
    for (const f of findings) db.get('trackingCodeFindings').unshift(f).write();
    res.json({ findings, count: findings.length });
  });

  app.get('/api/tracking/projects/:id/code-findings', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ findings: (db.get('trackingCodeFindings').value() || []).filter(f => f.projectId === p.id).slice(0, 100) });
  });

  app.get('/api/tracking/ops/meta', requireAuth, (req, res) => {
    res.json({
      phase: '6-ops',
      incidentStatuses: INCIDENT_STATUS,
      severities: SEVERITIES,
      reportTypes: ['executive', 'technical', 'incident', 'cold-chain', 'audit'],
      features: ['incidents', 'auto-incident-from-alerts', 'reports', 'code-scan'],
    });
  });
};
