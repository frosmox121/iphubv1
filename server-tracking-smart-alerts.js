/**
 * Tracking Studio — Fase 5: Sistema de alertas inteligentes
 * - Reglas configurables por proyecto
 * - Correlación / agrupación de alertas
 * - Escalado por severidad y tiempo sin ack
 * - Supresión y cooldown
 * - Alertas compuestas (multi-señal)
 * - Centro de alertas con insights
 */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit, crypto } = ctx;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID());

  function ensureCols() {
    const defaults = {
      trackingAlertRules: [],
      trackingAlertGroups: [],
      trackingAlertEscalations: [],
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
    return null;
  }

  const RULE_CONDITIONS = [
    'TEMP_ABOVE', 'TEMP_BELOW', 'TEMP_OUT_OF_RANGE',
    'BATTERY_BELOW', 'IMPACT_ABOVE', 'HUMIDITY_ABOVE', 'HUMIDITY_BELOW',
    'SPEED_ABOVE', 'NO_TELEMETRY_MINUTES', 'RISK_ABOVE',
    'STATUS_IS', 'ROUTE_DEVIATION_KM',
  ];
  const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];

  // ---------- Default rules template ----------
  function defaultRules(projectId) {
    const now = new Date().toISOString();
    return [
      {
        id: uuid(), projectId, name: 'Cold chain excursion', enabled: true,
        condition: 'TEMP_OUT_OF_RANGE', threshold: null, severity: 'high',
        cooldownMinutes: 15, escalateAfterMinutes: 30, escalateTo: 'critical',
        composite: false, createdAt: now, updatedAt: now,
      },
      {
        id: uuid(), projectId, name: 'Battery critical', enabled: true,
        condition: 'BATTERY_BELOW', threshold: 15, severity: 'high',
        cooldownMinutes: 30, escalateAfterMinutes: 60, escalateTo: 'critical',
        composite: false, createdAt: now, updatedAt: now,
      },
      {
        id: uuid(), projectId, name: 'High impact', enabled: true,
        condition: 'IMPACT_ABOVE', threshold: 2.5, severity: 'medium',
        cooldownMinutes: 10, escalateAfterMinutes: 45, escalateTo: 'high',
        composite: false, createdAt: now, updatedAt: now,
      },
      {
        id: uuid(), projectId, name: 'Risk elevated', enabled: true,
        condition: 'RISK_ABOVE', threshold: 60, severity: 'medium',
        cooldownMinutes: 20, escalateAfterMinutes: 40, escalateTo: 'high',
        composite: false, createdAt: now, updatedAt: now,
      },
      {
        id: uuid(), projectId, name: 'Telemetry silence', enabled: true,
        condition: 'NO_TELEMETRY_MINUTES', threshold: 30, severity: 'medium',
        cooldownMinutes: 30, escalateAfterMinutes: 90, escalateTo: 'high',
        composite: false, createdAt: now, updatedAt: now,
      },
      {
        id: uuid(), projectId, name: 'Composite cold+impact', enabled: true,
        condition: 'COMPOSITE', threshold: null, severity: 'critical',
        cooldownMinutes: 20, escalateAfterMinutes: null, escalateTo: null,
        composite: true,
        compositeRules: ['TEMP_OUT_OF_RANGE', 'IMPACT_ABOVE'],
        createdAt: now, updatedAt: now,
      },
    ];
  }

  function getRules(projectId) {
    ensureCols();
    let rules = (db.get('trackingAlertRules').value() || []).filter(r => r.projectId === projectId);
    if (!rules.length) {
      rules = defaultRules(projectId);
      for (const r of rules) db.get('trackingAlertRules').push(r).write();
    }
    return rules;
  }

  function conditionMet(rule, ctxEval) {
    const { shipment, last, tele, risk, silenceMinutes, routeDeviationKm } = ctxEval;
    const th = rule.threshold;
    switch (rule.condition) {
      case 'TEMP_ABOVE':
        return last && last.temperature != null && th != null && last.temperature > th;
      case 'TEMP_BELOW':
        return last && last.temperature != null && th != null && last.temperature < th;
      case 'TEMP_OUT_OF_RANGE': {
        if (!shipment.temperatureRequired || !last || last.temperature == null) return false;
        const { min, max } = shipment.temperatureRequired;
        return (min != null && last.temperature < min) || (max != null && last.temperature > max);
      }
      case 'BATTERY_BELOW':
        return last && last.battery != null && th != null && last.battery < th;
      case 'IMPACT_ABOVE':
        return last && last.impactG != null && th != null && last.impactG > th;
      case 'HUMIDITY_ABOVE':
        return last && last.humidity != null && th != null && last.humidity > th;
      case 'HUMIDITY_BELOW':
        return last && last.humidity != null && th != null && last.humidity < th;
      case 'SPEED_ABOVE':
        return last && last.gps && last.gps.speed != null && th != null && last.gps.speed > th;
      case 'NO_TELEMETRY_MINUTES':
        return silenceMinutes != null && th != null && silenceMinutes >= th;
      case 'RISK_ABOVE':
        return risk && risk.score != null && th != null && risk.score >= th;
      case 'STATUS_IS':
        return shipment.status === rule.statusValue;
      case 'ROUTE_DEVIATION_KM':
        return routeDeviationKm != null && th != null && routeDeviationKm > th;
      case 'COMPOSITE':
        return false; // handled separately
      default:
        return false;
    }
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toR = d => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function findOpenAlert(shipmentId, ruleId) {
    return (db.get('trackingAlerts').value() || []).find(a =>
      a.shipmentId === shipmentId &&
      a.ruleId === ruleId &&
      (a.status === 'open' || a.status === 'acknowledged')
    );
  }

  function inCooldown(shipmentId, ruleId, cooldownMinutes) {
    if (!cooldownMinutes) return false;
    const recent = (db.get('trackingAlerts').value() || []).find(a =>
      a.shipmentId === shipmentId &&
      a.ruleId === ruleId &&
      Date.now() - new Date(a.createdAt).getTime() < cooldownMinutes * 60 * 1000
    );
    return !!recent;
  }

  function createSmartAlert(opts) {
    const alert = {
      id: uuid(),
      projectId: opts.projectId,
      shipmentId: opts.shipmentId || null,
      deviceId: opts.deviceId || null,
      ruleId: opts.ruleId || null,
      groupId: opts.groupId || null,
      type: opts.type || 'SMART_RULE',
      severity: SEVERITIES.includes(opts.severity) ? opts.severity : 'medium',
      status: 'open',
      title: String(opts.title || 'Smart alert').slice(0, 160),
      message: String(opts.message || '').slice(0, 1000),
      evidence: opts.evidence || {},
      recommendedAction: String(opts.recommendedAction || '').slice(0, 400),
      intelligent: true,
      escalated: false,
      escalateAt: opts.escalateAfterMinutes
        ? new Date(Date.now() + opts.escalateAfterMinutes * 60000).toISOString()
        : null,
      escalateTo: opts.escalateTo || null,
      correlationKey: opts.correlationKey || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
    };
    db.get('trackingAlerts').unshift(alert).write();
    const all = db.get('trackingAlerts').value() || [];
    if (all.length > 5000) db.set('trackingAlerts', all.slice(0, 4000)).write();
    return alert;
  }

  /**
   * Evalúa reglas inteligentes sobre un envío.
   */
  function evaluateSmart(shipmentId) {
    ensureCols();
    const s = (db.get('shipments').value() || []).find(x => x.id === shipmentId);
    if (!s) return { alerts: [], groups: [], escalated: [] };
    const rules = getRules(s.projectId).filter(r => r.enabled);
    const tele = (db.get('telemetryReads').value() || [])
      .filter(t => t.shipmentId === shipmentId)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    const last = tele[tele.length - 1] || null;
    const silenceMinutes = last
      ? (Date.now() - new Date(last.timestamp).getTime()) / 60000
      : 9999;

    let routeDeviationKm = null;
    if (s.origin && s.destination && last && last.gps && last.gps.lat != null) {
      const dO = haversineKm(last.gps.lat, last.gps.lon, s.origin.lat, s.origin.lon);
      const dD = haversineKm(last.gps.lat, last.gps.lon, s.destination.lat, s.destination.lon);
      const direct = haversineKm(s.origin.lat, s.origin.lon, s.destination.lat, s.destination.lon);
      routeDeviationKm = Math.max(0, dO + dD - direct);
    }

    // Risk from existing evaluate if available
    let risk = { score: 0 };
    try {
      if (app.locals.trackingEvaluateShipment) {
        const r = app.locals.trackingEvaluateShipment(shipmentId);
        if (r && r.risk) risk = r.risk;
      }
    } catch (_) {}

    const ctxEval = { shipment: s, last, tele, risk, silenceMinutes, routeDeviationKm };
    const created = [];
    const firedConditions = [];

    // Single rules
    for (const rule of rules.filter(r => !r.composite)) {
      if (!conditionMet(rule, ctxEval)) continue;
      firedConditions.push(rule.condition);
      if (inCooldown(s.id, rule.id, rule.cooldownMinutes)) continue;
      const existing = findOpenAlert(s.id, rule.id);
      if (existing) continue;

      const alert = createSmartAlert({
        projectId: s.projectId,
        shipmentId: s.id,
        deviceId: last && last.deviceId,
        ruleId: rule.id,
        type: rule.condition,
        severity: rule.severity,
        title: rule.name,
        message: buildMessage(rule, ctxEval),
        evidence: {
          condition: rule.condition,
          threshold: rule.threshold,
          lastReading: last,
          riskScore: risk.score,
          silenceMinutes,
          routeDeviationKm,
        },
        recommendedAction: buildAction(rule),
        escalateAfterMinutes: rule.escalateAfterMinutes,
        escalateTo: rule.escalateTo,
        correlationKey: s.id + ':' + rule.condition,
      });
      created.push(alert);
    }

    // Composite rules
    for (const rule of rules.filter(r => r.composite && Array.isArray(r.compositeRules))) {
      const needed = rule.compositeRules;
      const allFired = needed.every(c => firedConditions.includes(c) || conditionMet({ ...rule, condition: c, threshold: rule.threshold }, ctxEval));
      // Re-check each composite condition
      const ok = needed.every(cond => {
        const mock = { condition: cond, threshold: rule.threshold || defaultThreshold(cond) };
        return conditionMet(mock, ctxEval);
      });
      if (!ok) continue;
      if (inCooldown(s.id, rule.id, rule.cooldownMinutes)) continue;
      if (findOpenAlert(s.id, rule.id)) continue;

      const alert = createSmartAlert({
        projectId: s.projectId,
        shipmentId: s.id,
        deviceId: last && last.deviceId,
        ruleId: rule.id,
        type: 'COMPOSITE',
        severity: rule.severity || 'critical',
        title: rule.name,
        message: 'Alerta compuesta: ' + needed.join(' + '),
        evidence: { compositeRules: needed, lastReading: last, riskScore: risk.score },
        recommendedAction: 'Priorizar intervención: múltiples señales simultáneas',
        correlationKey: s.id + ':COMPOSITE:' + needed.join('+'),
      });
      created.push(alert);
    }

    // Correlation: group open smart alerts for same shipment
    const groups = correlateShipment(s);

    // Escalation pass
    const escalated = runEscalations(s.projectId);

    return { alerts: created, groups, escalated, firedConditions };
  }

  function defaultThreshold(cond) {
    const map = {
      BATTERY_BELOW: 15, IMPACT_ABOVE: 2.5, HUMIDITY_ABOVE: 90, HUMIDITY_BELOW: 10,
      SPEED_ABOVE: 140, NO_TELEMETRY_MINUTES: 30, RISK_ABOVE: 60, ROUTE_DEVIATION_KM: 80,
    };
    return map[cond] != null ? map[cond] : null;
  }

  function buildMessage(rule, ctx) {
    const last = ctx.last || {};
    switch (rule.condition) {
      case 'TEMP_OUT_OF_RANGE':
        return 'Temperatura ' + last.temperature + '°C fuera de rango requerido';
      case 'BATTERY_BELOW':
        return 'Batería al ' + last.battery + '% (umbral ' + rule.threshold + '%)';
      case 'IMPACT_ABOVE':
        return 'Impacto ' + last.impactG + ' G (umbral ' + rule.threshold + ')';
      case 'NO_TELEMETRY_MINUTES':
        return 'Sin telemetría por ' + Math.round(ctx.silenceMinutes) + ' min';
      case 'RISK_ABOVE':
        return 'Risk score ' + (ctx.risk && ctx.risk.score) + ' ≥ ' + rule.threshold;
      case 'ROUTE_DEVIATION_KM':
        return 'Desviación de ruta ~' + Math.round(ctx.routeDeviationKm) + ' km';
      default:
        return 'Condición ' + rule.condition + ' activada';
    }
  }

  function buildAction(rule) {
    const map = {
      TEMP_OUT_OF_RANGE: 'Verificar cadena de frío y hub alternativo',
      BATTERY_BELOW: 'Reemplazar o recargar tracker',
      IMPACT_ABOVE: 'Inspeccionar integridad del paquete',
      NO_TELEMETRY_MINUTES: 'Comprobar conectividad del dispositivo',
      RISK_ABOVE: 'Revisar factores de riesgo en Analytics',
      ROUTE_DEVIATION_KM: 'Contactar carrier y validar ruta',
    };
    return map[rule.condition] || 'Revisar evidencia y tomar acción operativa';
  }

  function correlateShipment(shipment) {
    const open = (db.get('trackingAlerts').value() || []).filter(a =>
      a.shipmentId === shipment.id && a.status === 'open' && a.intelligent
    );
    if (open.length < 2) return [];
    ensureCols();
    // Find or create group
    let group = (db.get('trackingAlertGroups').value() || []).find(g =>
      g.shipmentId === shipment.id && g.status === 'open'
    );
    if (!group) {
      group = {
        id: uuid(),
        projectId: shipment.projectId,
        shipmentId: shipment.id,
        title: 'Correlación · ' + (shipment.trackingNumber || shipment.id.slice(0, 8)),
        alertIds: open.map(a => a.id),
        severity: open.reduce((max, a) => {
          const order = SEVERITIES.indexOf(a.severity);
          return order > SEVERITIES.indexOf(max) ? a.severity : max;
        }, 'info'),
        insight: buildCorrelationInsight(open),
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.get('trackingAlertGroups').unshift(group).write();
    } else {
      group.alertIds = [...new Set([...(group.alertIds || []), ...open.map(a => a.id)])];
      group.severity = open.reduce((max, a) => {
        const order = SEVERITIES.indexOf(a.severity);
        return order > SEVERITIES.indexOf(max) ? a.severity : max;
      }, group.severity || 'info');
      group.insight = buildCorrelationInsight(open);
      group.updatedAt = new Date().toISOString();
      db.get('trackingAlertGroups').find({ id: group.id }).assign({
        alertIds: group.alertIds,
        severity: group.severity,
        insight: group.insight,
        updatedAt: group.updatedAt,
      }).write();
    }
    // Link alerts to group
    for (const a of open) {
      if (a.groupId !== group.id) {
        db.get('trackingAlerts').find({ id: a.id }).assign({ groupId: group.id, updatedAt: new Date().toISOString() }).write();
      }
    }
    return [group];
  }

  function buildCorrelationInsight(alerts) {
    const types = [...new Set(alerts.map(a => a.type))];
    if (types.includes('TEMP_OUT_OF_RANGE') && types.includes('IMPACT_ABOVE')) {
      return 'Posible daño a empaque + falla de cadena de frío. Prioridad alta.';
    }
    if (types.includes('BATTERY_BELOW') && types.includes('NO_TELEMETRY_MINUTES')) {
      return 'Pérdida de señal probablemente por batería baja.';
    }
    if (types.includes('ROUTE_DEVIATION_KM') && types.includes('RISK_ABOVE')) {
      return 'Desvío de ruta elevando el riesgo operativo del envío.';
    }
    if (types.length >= 3) {
      return 'Múltiples señales concurrentes (' + types.length + '). Revisar como incidente único.';
    }
    return 'Alertas correlacionadas en el mismo envío: ' + types.join(', ');
  }

  function runEscalations(projectId) {
    const now = Date.now();
    const escalated = [];
    const open = (db.get('trackingAlerts').value() || []).filter(a =>
      a.projectId === projectId &&
      a.status === 'open' &&
      a.intelligent &&
      a.escalateAt &&
      !a.escalated &&
      new Date(a.escalateAt).getTime() <= now
    );
    for (const a of open) {
      const newSev = a.escalateTo || 'critical';
      db.get('trackingAlerts').find({ id: a.id }).assign({
        severity: newSev,
        escalated: true,
        updatedAt: new Date().toISOString(),
        message: (a.message || '') + ' [ESCALADO → ' + newSev + ']',
      }).write();
      db.get('trackingAlertEscalations').unshift({
        id: uuid(),
        alertId: a.id,
        projectId,
        from: a.severity,
        to: newSev,
        at: new Date().toISOString(),
      }).write();
      escalated.push({ alertId: a.id, from: a.severity, to: newSev });
    }
    return escalated;
  }

  // ---------- API: Rules ----------
  app.get('/api/tracking/projects/:id/alert-rules', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ rules: getRules(p.id), conditions: RULE_CONDITIONS, severities: SEVERITIES });
  });

  app.post('/api/tracking/projects/:id/alert-rules', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    getRules(p.id); // ensure defaults
    const b = req.body || {};
    const now = new Date().toISOString();
    const rule = {
      id: uuid(),
      projectId: p.id,
      name: String(b.name || 'Custom rule').slice(0, 80),
      enabled: b.enabled !== false,
      condition: RULE_CONDITIONS.includes(b.condition) || b.condition === 'COMPOSITE' ? b.condition : 'RISK_ABOVE',
      threshold: b.threshold != null ? Number(b.threshold) : null,
      statusValue: b.statusValue || null,
      severity: SEVERITIES.includes(b.severity) ? b.severity : 'medium',
      cooldownMinutes: Number(b.cooldownMinutes) || 15,
      escalateAfterMinutes: b.escalateAfterMinutes != null ? Number(b.escalateAfterMinutes) : null,
      escalateTo: SEVERITIES.includes(b.escalateTo) ? b.escalateTo : null,
      composite: !!b.composite,
      compositeRules: Array.isArray(b.compositeRules) ? b.compositeRules : [],
      createdAt: now,
      updatedAt: now,
    };
    db.get('trackingAlertRules').push(rule).write();
    addAudit(req.user.email, 'tracking.rule.create', rule.id + ' ' + rule.name);
    res.status(201).json(rule);
  });

  app.put('/api/tracking/alert-rules/:id', requireAuth, (req, res) => {
    const rule = (db.get('trackingAlertRules').value() || []).find(r => r.id === req.params.id);
    if (!rule) return res.status(404).json({ error: 'Regla no encontrada' });
    if (!canAccessProject(req.user.id, rule.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };
    if (b.name != null) patch.name = String(b.name).slice(0, 80);
    if (b.enabled != null) patch.enabled = !!b.enabled;
    if (RULE_CONDITIONS.includes(b.condition) || b.condition === 'COMPOSITE') patch.condition = b.condition;
    if (b.threshold != null) patch.threshold = Number(b.threshold);
    if (SEVERITIES.includes(b.severity)) patch.severity = b.severity;
    if (b.cooldownMinutes != null) patch.cooldownMinutes = Number(b.cooldownMinutes);
    if (b.escalateAfterMinutes !== undefined) patch.escalateAfterMinutes = b.escalateAfterMinutes != null ? Number(b.escalateAfterMinutes) : null;
    if (b.escalateTo !== undefined) patch.escalateTo = SEVERITIES.includes(b.escalateTo) ? b.escalateTo : null;
    if (b.composite != null) patch.composite = !!b.composite;
    if (Array.isArray(b.compositeRules)) patch.compositeRules = b.compositeRules;
    db.get('trackingAlertRules').find({ id: rule.id }).assign(patch).write();
    res.json({ ...rule, ...patch });
  });

  app.delete('/api/tracking/alert-rules/:id', requireAuth, (req, res) => {
    const rule = (db.get('trackingAlertRules').value() || []).find(r => r.id === req.params.id);
    if (!rule) return res.status(404).json({ error: 'Regla no encontrada' });
    if (!canAccessProject(req.user.id, rule.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    db.get('trackingAlertRules').remove({ id: rule.id }).write();
    addAudit(req.user.email, 'tracking.rule.delete', rule.id);
    res.json({ ok: true });
  });

  // ---------- API: Evaluate smart + groups ----------
  app.post('/api/tracking/shipments/:id/evaluate-smart', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const result = evaluateSmart(s.id);
    res.json(result);
  });

  app.post('/api/tracking/projects/:id/evaluate-smart', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === p.id);
    let totalAlerts = 0, totalEsc = 0, groups = [];
    for (const s of ships.slice(0, 200)) {
      const r = evaluateSmart(s.id);
      totalAlerts += (r.alerts || []).length;
      totalEsc += (r.escalated || []).length;
      groups = groups.concat(r.groups || []);
    }
    res.json({ shipmentsEvaluated: Math.min(ships.length, 200), newAlerts: totalAlerts, escalated: totalEsc, groups: groups.length });
  });

  app.get('/api/tracking/projects/:id/alert-groups', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const list = (db.get('trackingAlertGroups').value() || [])
      .filter(g => g.projectId === p.id)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 100);
    res.json({ groups: list });
  });

  app.get('/api/tracking/projects/:id/alerts/intelligent', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    runEscalations(p.id);
    const alerts = (db.get('trackingAlerts').value() || [])
      .filter(a => a.projectId === p.id && a.intelligent)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 300);
    const groups = (db.get('trackingAlertGroups').value() || [])
      .filter(g => g.projectId === p.id && g.status === 'open');
    const escalations = (db.get('trackingAlertEscalations').value() || [])
      .filter(e => e.projectId === p.id)
      .slice(0, 50);
    const open = alerts.filter(a => a.status === 'open');
    res.json({
      alerts,
      groups,
      escalations,
      summary: {
        open: open.length,
        escalated: open.filter(a => a.escalated).length,
        critical: open.filter(a => a.severity === 'critical').length,
        groups: groups.length,
        suppressedHint: 'Cooldown y dedup activos por regla',
      },
    });
  });

  // Hook: after basic evaluate on telemetry, also run smart rules
  app.use('/api/tracking/shipments/:id/telemetry', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const shipmentId = req.params.id;
    const origJson = res.json.bind(res);
    res.json = function (body) {
      try {
        const smart = evaluateSmart(shipmentId);
        if (body && typeof body === 'object') {
          body._smartAlerts = {
            new: (smart.alerts || []).length,
            escalated: (smart.escalated || []).length,
            groups: (smart.groups || []).length,
            fired: smart.firedConditions || [],
          };
        }
      } catch (e) {
        console.error('[smart-alerts]', e.message);
      }
      return origJson(body);
    };
    next();
  });

  app.get('/api/tracking/smart-alerts/meta', requireAuth, (req, res) => {
    res.json({
      phase: 5,
      conditions: RULE_CONDITIONS,
      severities: SEVERITIES,
      features: [
        'configurable-rules', 'cooldown', 'escalation',
        'composite-alerts', 'correlation-groups', 'intelligent-center',
      ],
    });
  });

  app.locals.trackingEvaluateSmart = evaluateSmart;
};
