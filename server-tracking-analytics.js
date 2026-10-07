/**
 * Tracking Studio — Fase 3: Analítica predictiva + motor de alertas
 * - Evaluación de reglas sobre telemetría / estado de envíos
 * - Risk score explicable
 * - Predicción ETA, tendencia de temperatura, anomalías simples
 */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit, crypto } = ctx;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID());

  function ensureCols() {
    const defaults = { trackingAlerts: [], trackingRisk: [] };
    for (const [k, v] of Object.entries(defaults)) {
      if (db.get(k).value() == null) db.set(k, v).write();
    }
  }
  ensureCols();

  const ALERT_TYPES = [
    'TEMPERATURE_EXCURSION',
    'BATTERY_CRITICAL',
    'LOST_CONNECTIVITY',
    'ROUTE_DEVIATION',
    'TELEMETRY_ANOMALY',
    'ETA_RISK',
    'SPEED_ANOMALY',
    'HUMIDITY_EXCURSION',
    'IMPACT_DETECTED',
    'DEVICE_OFFLINE',
  ];
  const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
  const ALERT_STATUS = ['open', 'acknowledged', 'resolved', 'ignored'];

  function canAccessProject(userId, projectId) {
    const p = (db.get('trackingProjects').value() || []).find(x => x.id === projectId);
    if (!p) return null;
    if (p.ownerId === userId || (p.members || []).includes(userId)) return p;
    return null;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toR = d => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ---------- Predictive helpers ----------
  function predictEta(shipment, telemetry) {
    const dest = shipment.destination;
    const loc = shipment.currentLocation || (telemetry.length ? {
      lat: telemetry[telemetry.length - 1].gps && telemetry[telemetry.length - 1].gps.lat,
      lon: telemetry[telemetry.length - 1].gps && telemetry[telemetry.length - 1].gps.lon,
    } : null);
    if (!dest || dest.lat == null || !loc || loc.lat == null) {
      return { etaMinutes: null, confidence: 0, remainingKm: null, avgSpeedKmh: null, reason: 'Sin ubicación o destino' };
    }
    const remainingKm = haversineKm(Number(loc.lat), Number(loc.lon), Number(dest.lat), Number(dest.lon));
    // velocidad media de últimas lecturas con speed
    const speeds = telemetry.slice(-30).map(t => t.gps && t.gps.speed).filter(s => s != null && s > 1);
    let avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 50;
    if (avgSpeed < 5) avgSpeed = 30;
    const etaMinutes = Math.round((remainingKm / avgSpeed) * 60);
    const confidence = Math.min(0.95, 0.35 + speeds.length * 0.02 + (shipment.actualRoute && shipment.actualRoute.length > 5 ? 0.15 : 0));
    return {
      etaMinutes,
      etaAt: new Date(Date.now() + etaMinutes * 60000).toISOString(),
      remainingKm: Math.round(remainingKm * 10) / 10,
      avgSpeedKmh: Math.round(avgSpeed * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
      reason: speeds.length ? 'Basado en velocidad reciente' : 'Velocidad estimada por defecto',
    };
  }

  function temperatureTrend(telemetry) {
    const temps = telemetry.filter(t => t.temperature != null).slice(-40);
    if (temps.length < 3) return { slope: 0, forecast: null, risk: 'unknown', samples: temps.length };
    const ys = temps.map(t => t.temperature);
    const n = ys.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += ys[i]; sumXY += i * ys[i]; sumXX += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / Math.max(1e-9, n * sumXX - sumX * sumX);
    const last = ys[n - 1];
    const forecast15 = last + slope * 15; // ~15 samples ahead
    let risk = 'stable';
    if (slope > 0.08) risk = 'rising';
    if (slope > 0.2) risk = 'rapid_rise';
    if (slope < -0.08) risk = 'falling';
    return {
      slope: Math.round(slope * 1000) / 1000,
      last,
      forecast: Math.round(forecast15 * 100) / 100,
      risk,
      samples: n,
    };
  }

  function detectAnomalies(telemetry) {
    const anomalies = [];
    if (telemetry.length < 5) return anomalies;
    const recent = telemetry.slice(-20);
    const temps = recent.map(t => t.temperature).filter(x => x != null);
    const speeds = recent.map(t => t.gps && t.gps.speed).filter(x => x != null);
    const impacts = recent.map(t => t.impactG).filter(x => x != null);

    function meanStd(arr) {
      if (!arr.length) return { mean: 0, std: 0 };
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
      return { mean, std: Math.sqrt(variance) };
    }

    const t = meanStd(temps);
    const lastT = temps[temps.length - 1];
    if (t.std > 0.01 && lastT != null && Math.abs(lastT - t.mean) > 2.5 * t.std) {
      anomalies.push({ type: 'TEMP_SPIKE', value: lastT, mean: t.mean, severity: 'medium' });
    }
    const s = meanStd(speeds);
    const lastS = speeds[speeds.length - 1];
    if (s.std > 1 && lastS != null && lastS > s.mean + 3 * s.std && lastS > 120) {
      anomalies.push({ type: 'SPEED_SPIKE', value: lastS, mean: s.mean, severity: 'low' });
    }
    const lastI = impacts[impacts.length - 1];
    if (lastI != null && lastI > 2.5) {
      anomalies.push({ type: 'HIGH_IMPACT', value: lastI, severity: 'high' });
    }
    const batteries = recent.map(t => t.battery).filter(x => x != null);
    if (batteries.length && batteries[batteries.length - 1] < 15) {
      anomalies.push({ type: 'LOW_BATTERY', value: batteries[batteries.length - 1], severity: 'high' });
    }
    return anomalies;
  }

  function riskScore(shipment, telemetry, alerts) {
    const factors = [];
    let score = 15; // base

    const openAlerts = alerts.filter(a => a.status === 'open' || a.status === 'acknowledged');
    for (const a of openAlerts) {
      const w = a.severity === 'critical' ? 25 : a.severity === 'high' ? 18 : a.severity === 'medium' ? 10 : 4;
      score += w;
      factors.push({ factor: 'alert:' + a.type, points: w, detail: a.title });
    }

    const trend = temperatureTrend(telemetry);
    if (shipment.temperatureRequired) {
      const { min, max } = shipment.temperatureRequired;
      const last = trend.last;
      if (last != null && min != null && max != null) {
        if (last < min || last > max) {
          score += 22;
          factors.push({ factor: 'temp_out_of_range', points: 22, detail: last + '°C fuera de ' + min + '–' + max });
        } else if (trend.risk === 'rapid_rise' || trend.risk === 'rising') {
          const p = trend.risk === 'rapid_rise' ? 15 : 8;
          score += p;
          factors.push({ factor: 'temp_trend', points: p, detail: trend.risk + ' slope=' + trend.slope });
        }
      }
    }

    const eta = predictEta(shipment, telemetry);
    if (eta.remainingKm != null && eta.avgSpeedKmh != null && eta.avgSpeedKmh < 15 && eta.remainingKm > 50) {
      score += 12;
      factors.push({ factor: 'slow_progress', points: 12, detail: eta.avgSpeedKmh + ' km/h, ' + eta.remainingKm + ' km restantes' });
    }

    if (shipment.status === 'EXCEPTION') {
      score += 20;
      factors.push({ factor: 'status_exception', points: 20, detail: 'Estado EXCEPTION' });
    }

    const anomalies = detectAnomalies(telemetry);
    for (const an of anomalies) {
      const p = an.severity === 'high' ? 12 : an.severity === 'medium' ? 7 : 3;
      score += p;
      factors.push({ factor: 'anomaly:' + an.type, points: p, detail: String(an.value) });
    }

    if (!telemetry.length) {
      score += 8;
      factors.push({ factor: 'no_telemetry', points: 8, detail: 'Sin lecturas recientes' });
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    let band = 'low';
    if (score >= 70) band = 'critical';
    else if (score >= 50) band = 'high';
    else if (score >= 30) band = 'medium';
    return { score, band, factors, eta, temperatureTrend: trend, anomalies };
  }

  // ---------- Alert creation with dedup ----------
  function createAlert(opts) {
    ensureCols();
    const recent = (db.get('trackingAlerts').value() || []).filter(a =>
      a.shipmentId === opts.shipmentId &&
      a.type === opts.type &&
      a.status === 'open' &&
      Date.now() - new Date(a.createdAt).getTime() < 15 * 60 * 1000
    );
    if (recent.length) return recent[0]; // dedup 15 min

    const alert = {
      id: uuid(),
      projectId: opts.projectId,
      shipmentId: opts.shipmentId || null,
      deviceId: opts.deviceId || null,
      type: opts.type,
      severity: SEVERITIES.includes(opts.severity) ? opts.severity : 'medium',
      status: 'open',
      title: String(opts.title || opts.type).slice(0, 160),
      message: String(opts.message || '').slice(0, 1000),
      evidence: opts.evidence || {},
      recommendedAction: String(opts.recommendedAction || '').slice(0, 400),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
    };
    db.get('trackingAlerts').unshift(alert).write();
    // cap alerts
    const all = db.get('trackingAlerts').value() || [];
    if (all.length > 5000) {
      db.set('trackingAlerts', all.slice(0, 4000)).write();
    }
    return alert;
  }

  /**
   * Evalúa telemetría reciente de un envío y genera alertas.
   * Llamable desde API o internamente tras ingest.
   */
  function evaluateShipment(shipmentId) {
    const s = (db.get('shipments').value() || []).find(x => x.id === shipmentId);
    if (!s) return { alerts: [], risk: null };
    const tele = (db.get('telemetryReads').value() || [])
      .filter(t => t.shipmentId === shipmentId)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    const recent = tele.slice(-50);
    const last = recent[recent.length - 1];
    const created = [];

    // Temperatura
    if (s.temperatureRequired && last && last.temperature != null) {
      const { min, max } = s.temperatureRequired;
      if ((min != null && last.temperature < min) || (max != null && last.temperature > max)) {
        created.push(createAlert({
          projectId: s.projectId,
          shipmentId: s.id,
          deviceId: last.deviceId,
          type: 'TEMPERATURE_EXCURSION',
          severity: Math.abs(last.temperature - ((min + max) / 2)) > 5 ? 'critical' : 'high',
          title: 'Excursión de temperatura',
          message: 'Temperatura ' + last.temperature + '°C fuera del rango ' + min + '–' + max + '°C',
          evidence: { temperature: last.temperature, required: s.temperatureRequired, timestamp: last.timestamp },
          recommendedAction: 'Verificar cadena de frío, hub alternativo y tiempo de exposición',
        }));
      }
    }

    // Batería
    if (last && last.battery != null && last.battery < 15) {
      created.push(createAlert({
        projectId: s.projectId,
        shipmentId: s.id,
        deviceId: last.deviceId,
        type: 'BATTERY_CRITICAL',
        severity: last.battery < 5 ? 'critical' : 'high',
        title: 'Batería crítica del tracker',
        message: 'Batería al ' + last.battery + '%',
        evidence: { battery: last.battery, timestamp: last.timestamp },
        recommendedAction: 'Reemplazar o recargar dispositivo IoT',
      }));
    }

    // Impacto
    if (last && last.impactG != null && last.impactG > 2.5) {
      created.push(createAlert({
        projectId: s.projectId,
        shipmentId: s.id,
        deviceId: last.deviceId,
        type: 'IMPACT_DETECTED',
        severity: last.impactG > 5 ? 'high' : 'medium',
        title: 'Impacto detectado',
        message: 'Aceleración ' + last.impactG + ' G',
        evidence: { impactG: last.impactG, timestamp: last.timestamp },
        recommendedAction: 'Inspeccionar integridad del paquete',
      }));
    }

    // Humedad
    if (last && last.humidity != null && (last.humidity > 90 || last.humidity < 10)) {
      created.push(createAlert({
        projectId: s.projectId,
        shipmentId: s.id,
        deviceId: last.deviceId,
        type: 'HUMIDITY_EXCURSION',
        severity: 'medium',
        title: 'Humedad fuera de rango operativo',
        message: 'Humedad ' + last.humidity + '%',
        evidence: { humidity: last.humidity, timestamp: last.timestamp },
        recommendedAction: 'Revisar sellado y condiciones del contenedor',
      }));
    }

    // Anomalías estadísticas
    const anomalies = detectAnomalies(recent);
    for (const an of anomalies) {
      if (an.type === 'TEMP_SPIKE') {
        created.push(createAlert({
          projectId: s.projectId,
          shipmentId: s.id,
          type: 'TELEMETRY_ANOMALY',
          severity: an.severity,
          title: 'Anomalía de temperatura',
          message: 'Valor ' + an.value + ' vs media ' + Math.round(an.mean * 100) / 100,
          evidence: an,
          recommendedAction: 'Revisar sensor y condiciones ambientales',
        }));
      }
      if (an.type === 'SPEED_SPIKE') {
        created.push(createAlert({
          projectId: s.projectId,
          shipmentId: s.id,
          type: 'SPEED_ANOMALY',
          severity: 'low',
          title: 'Velocidad anómala',
          message: 'Speed ' + an.value + ' km/h',
          evidence: an,
          recommendedAction: 'Validar GPS y modo de transporte',
        }));
      }
    }

    // Desviación de ruta simple: lejos del corredor origen-destino
    if (s.origin && s.destination && last && last.gps && last.gps.lat != null) {
      const dOrigin = haversineKm(last.gps.lat, last.gps.lon, s.origin.lat, s.origin.lon);
      const dDest = haversineKm(last.gps.lat, last.gps.lon, s.destination.lat, s.destination.lon);
      const direct = haversineKm(s.origin.lat, s.origin.lon, s.destination.lat, s.destination.lon);
      const corridor = direct * 0.35 + 30; // km de holgura
      if (dOrigin + dDest > direct + corridor && dDest > 20) {
        created.push(createAlert({
          projectId: s.projectId,
          shipmentId: s.id,
          type: 'ROUTE_DEVIATION',
          severity: 'medium',
          title: 'Posible desviación de ruta',
          message: 'Distancia combinada supera corredor planificado',
          evidence: { dOrigin, dDest, direct, lat: last.gps.lat, lon: last.gps.lon },
          recommendedAction: 'Comparar ruta planificada vs actual y contactar carrier',
        }));
      }
    }

    // ETA risk
    const eta = predictEta(s, recent);
    if (eta.etaMinutes != null && eta.etaMinutes > 72 * 60 && s.status === 'IN_TRANSIT') {
      created.push(createAlert({
        projectId: s.projectId,
        shipmentId: s.id,
        type: 'ETA_RISK',
        severity: 'low',
        title: 'ETA elevado',
        message: 'ETA estimado ~' + Math.round(eta.etaMinutes / 60) + ' h',
        evidence: eta,
        recommendedAction: 'Revisar progreso y posibles retrasos',
      }));
    }

    const existingAlerts = (db.get('trackingAlerts').value() || []).filter(a => a.shipmentId === shipmentId);
    const risk = riskScore(s, recent, existingAlerts);

    // Persist risk snapshot ligero
    const riskRow = {
      id: uuid(),
      shipmentId: s.id,
      projectId: s.projectId,
      score: risk.score,
      band: risk.band,
      factors: risk.factors,
      eta: risk.eta,
      at: new Date().toISOString(),
    };
    db.get('trackingRisk').unshift(riskRow).write();
    const risks = db.get('trackingRisk').value() || [];
    if (risks.length > 3000) db.set('trackingRisk', risks.slice(0, 2500)).write();

    // Auto-exception en cold chain critical
    const criticalTemp = created.find(a => a.type === 'TEMPERATURE_EXCURSION' && a.severity === 'critical');
    if (criticalTemp && s.status !== 'EXCEPTION' && s.status !== 'DELIVERED') {
      db.get('shipments').find({ id: s.id }).assign({ status: 'EXCEPTION', updatedAt: new Date().toISOString() }).write();
    }

    return { alerts: created, risk };
  }

  // ---------- API: Alerts ----------
  app.get('/api/tracking/projects/:id/alerts', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const status = req.query.status;
    let list = (db.get('trackingAlerts').value() || []).filter(a => a.projectId === p.id);
    if (status) list = list.filter(a => a.status === status);
    list = list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 500);
    res.json({ alerts: list });
  });

  app.get('/api/tracking/shipments/:id/alerts', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const list = (db.get('trackingAlerts').value() || [])
      .filter(a => a.shipmentId === s.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ alerts: list });
  });

  app.patch('/api/tracking/alerts/:id', requireAuth, (req, res) => {
    const a = (db.get('trackingAlerts').value() || []).find(x => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: 'Alerta no encontrada' });
    if (!canAccessProject(req.user.id, a.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const b = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };
    if (ALERT_STATUS.includes(b.status)) {
      patch.status = b.status;
      if (b.status === 'acknowledged') patch.acknowledgedAt = patch.updatedAt;
      if (b.status === 'resolved' || b.status === 'ignored') patch.resolvedAt = patch.updatedAt;
    }
    db.get('trackingAlerts').find({ id: a.id }).assign(patch).write();
    addAudit(req.user.email, 'tracking.alert.update', a.id + ' ' + (patch.status || ''));
    res.json({ ...a, ...patch });
  });

  app.post('/api/tracking/shipments/:id/evaluate', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const result = evaluateShipment(s.id);
    res.json(result);
  });

  // ---------- API: Analytics / predictions ----------
  app.get('/api/tracking/shipments/:id/analytics', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });
    const tele = (db.get('telemetryReads').value() || [])
      .filter(t => t.shipmentId === s.id)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    const recent = tele.slice(-100);
    const alerts = (db.get('trackingAlerts').value() || []).filter(a => a.shipmentId === s.id);
    const risk = riskScore(s, recent, alerts);
    const eta = predictEta(s, recent);
    const trend = temperatureTrend(recent);
    const anomalies = detectAnomalies(recent);
    res.json({
      shipmentId: s.id,
      trackingNumber: s.trackingNumber,
      risk,
      eta,
      temperatureTrend: trend,
      anomalies,
      telemetrySamples: recent.length,
      openAlerts: alerts.filter(a => a.status === 'open').length,
    });
  });

  app.get('/api/tracking/projects/:id/analytics/summary', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === p.id);
    const alerts = (db.get('trackingAlerts').value() || []).filter(a => a.projectId === p.id);
    const open = alerts.filter(a => a.status === 'open');
    const bySeverity = {};
    for (const sev of SEVERITIES) bySeverity[sev] = open.filter(a => a.severity === sev).length;
    const byType = {};
    for (const a of open) byType[a.type] = (byType[a.type] || 0) + 1;

    const risks = [];
    for (const s of ships.slice(0, 100)) {
      const tele = (db.get('telemetryReads').value() || []).filter(t => t.shipmentId === s.id).slice(-30);
      const shipAlerts = alerts.filter(a => a.shipmentId === s.id);
      const r = riskScore(s, tele, shipAlerts);
      risks.push({ shipmentId: s.id, trackingNumber: s.trackingNumber, score: r.score, band: r.band });
    }
    risks.sort((a, b) => b.score - a.score);

    res.json({
      shipmentCount: ships.length,
      openAlerts: open.length,
      bySeverity,
      byType,
      topRisks: risks.slice(0, 10),
      avgRisk: risks.length ? Math.round(risks.reduce((a, b) => a + b.score, 0) / risks.length) : 0,
    });
  });

  /**
   * Dashboard de analítica avanzada (Fase 4)
   * KPIs, series temporales, distribución de estados, OTIF proxy, cold chain health.
   */
  app.get('/api/tracking/projects/:id/analytics/dashboard', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === p.id);
    const alerts = (db.get('trackingAlerts').value() || []).filter(a => a.projectId === p.id);
    const teleAll = (db.get('telemetryReads').value() || []).filter(t => t.projectId === p.id);
    const events = (db.get('trackingEvents').value() || []).filter(e => e.projectId === p.id);
    const devices = (db.get('iotDevices').value() || []).filter(d => d.projectId === p.id);
    const risksHist = (db.get('trackingRisk').value() || []).filter(r => r.projectId === p.id);

    // Status distribution
    const byStatus = {};
    for (const s of ships) byStatus[s.status] = (byStatus[s.status] || 0) + 1;

    // OTIF proxy: delivered without EXCEPTION ever vs total delivered-ish
    const delivered = ships.filter(s => s.status === 'DELIVERED').length;
    const exceptions = ships.filter(s => s.status === 'EXCEPTION').length;
    const inTransit = ships.filter(s => ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_FACILITY', 'PICKED_UP'].includes(s.status)).length;
    const otifProxy = ships.length ? Math.round((delivered / ships.length) * 100) : 0;

    // Cold chain health: % of cold-chain shipments currently in range
    let coldTotal = 0, coldOk = 0, coldBreach = 0;
    const tempSeries = []; // last readings across project
    for (const s of ships) {
      if (!s.temperatureRequired) continue;
      coldTotal++;
      const tele = teleAll.filter(t => t.shipmentId === s.id && t.temperature != null).slice(-1);
      if (!tele.length) continue;
      const t = tele[0].temperature;
      const { min, max } = s.temperatureRequired;
      if ((min != null && t < min) || (max != null && t > max)) coldBreach++;
      else coldOk++;
    }
    const coldHealth = coldTotal ? Math.round((coldOk / coldTotal) * 100) : null;

    // Temperature time series (last 120 points project-wide, bucketed)
    const tempReadings = teleAll
      .filter(t => t.temperature != null)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
      .slice(-200);
    for (const t of tempReadings) {
      tempSeries.push({
        t: t.timestamp,
        v: t.temperature,
        shipmentId: t.shipmentId,
      });
    }

    // Telemetry volume over time (hourly buckets last 24h / or last 48 points)
    const volumeBuckets = {};
    for (const t of teleAll.slice(-5000)) {
      const key = (t.timestamp || '').slice(0, 13); // YYYY-MM-DDTHH
      if (!key) continue;
      volumeBuckets[key] = (volumeBuckets[key] || 0) + 1;
    }
    const volumeSeries = Object.keys(volumeBuckets).sort().slice(-48).map(k => ({ t: k, v: volumeBuckets[k] }));

    // Alert timeline (last 30 days buckets by day)
    const alertBuckets = {};
    for (const a of alerts) {
      const key = (a.createdAt || '').slice(0, 10);
      if (!key) continue;
      if (!alertBuckets[key]) alertBuckets[key] = { total: 0, critical: 0, high: 0 };
      alertBuckets[key].total++;
      if (a.severity === 'critical') alertBuckets[key].critical++;
      if (a.severity === 'high') alertBuckets[key].high++;
    }
    const alertSeries = Object.keys(alertBuckets).sort().slice(-30).map(k => ({
      t: k,
      total: alertBuckets[k].total,
      critical: alertBuckets[k].critical,
      high: alertBuckets[k].high,
    }));

    // Risk history series
    const riskSeries = risksHist
      .slice()
      .sort((a, b) => (a.at || '').localeCompare(b.at || ''))
      .slice(-100)
      .map(r => ({ t: r.at, score: r.score, band: r.band, shipmentId: r.shipmentId }));

    // Severity / type for open alerts
    const open = alerts.filter(a => a.status === 'open');
    const bySeverity = {};
    for (const sev of SEVERITIES) bySeverity[sev] = open.filter(a => a.severity === sev).length;
    const byType = {};
    for (const a of open) byType[a.type] = (byType[a.type] || 0) + 1;

    // Per-shipment risk (current)
    const risks = [];
    for (const s of ships.slice(0, 150)) {
      const tele = teleAll.filter(t => t.shipmentId === s.id).slice(-30);
      const shipAlerts = alerts.filter(a => a.shipmentId === s.id);
      const r = riskScore(s, tele, shipAlerts);
      const eta = predictEta(s, tele);
      risks.push({
        shipmentId: s.id,
        trackingNumber: s.trackingNumber,
        status: s.status,
        score: r.score,
        band: r.band,
        etaMinutes: eta.etaMinutes,
        remainingKm: eta.remainingKm,
      });
    }
    risks.sort((a, b) => b.score - a.score);

    // Carrier performance proxy
    const byCarrier = {};
    for (const s of ships) {
      const c = s.carrier || 'Unknown';
      if (!byCarrier[c]) byCarrier[c] = { total: 0, delivered: 0, exception: 0 };
      byCarrier[c].total++;
      if (s.status === 'DELIVERED') byCarrier[c].delivered++;
      if (s.status === 'EXCEPTION') byCarrier[c].exception++;
    }
    const carrierPerf = Object.keys(byCarrier).map(c => ({
      carrier: c,
      total: byCarrier[c].total,
      delivered: byCarrier[c].delivered,
      exception: byCarrier[c].exception,
      successRate: byCarrier[c].total ? Math.round((byCarrier[c].delivered / byCarrier[c].total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);

    // Device health
    const deviceOnline = devices.filter(d => d.status === 'ONLINE').length;
    const deviceLowBat = devices.filter(d => (d.battery != null && d.battery < 20)).length;

    res.json({
      projectId: p.id,
      projectName: p.name,
      mode: p.mode,
      generatedAt: new Date().toISOString(),
      kpis: {
        shipments: ships.length,
        inTransit,
        delivered,
        exceptions,
        otifProxy,
        openAlerts: open.length,
        avgRisk: risks.length ? Math.round(risks.reduce((a, b) => a + b.score, 0) / risks.length) : 0,
        coldHealth,
        coldTotal,
        coldBreach,
        telemetryCount: teleAll.length,
        eventCount: events.length,
        devices: devices.length,
        deviceOnline,
        deviceLowBat,
      },
      byStatus,
      bySeverity,
      byType,
      topRisks: risks.slice(0, 15),
      carrierPerf,
      series: {
        temperature: tempSeries,
        volume: volumeSeries,
        alerts: alertSeries,
        risk: riskSeries,
      },
    });
  });

  // Hook: evaluar tras POST telemetría (middleware que intercepta respuesta)
  app.use('/api/tracking/shipments/:id/telemetry', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const shipmentId = req.params.id;
    const origJson = res.json.bind(res);
    res.json = function (body) {
      try {
        const result = evaluateShipment(shipmentId);
        if (body && typeof body === 'object') {
          body._analytics = {
            newAlerts: (result.alerts || []).length,
            riskScore: result.risk && result.risk.score,
            riskBand: result.risk && result.risk.band,
          };
        }
      } catch (e) {
        console.error('[tracking-analytics] evaluate:', e.message);
      }
      return origJson(body);
    };
    next();
  });

  app.get('/api/tracking/analytics/meta', requireAuth, (req, res) => {
    res.json({
      phase: 4,
      alertTypes: ALERT_TYPES,
      severities: SEVERITIES,
      alertStatuses: ALERT_STATUS,
      features: [
        'alerts', 'risk-score', 'eta-prediction', 'temperature-trend',
        'anomaly-detection', 'auto-evaluate-on-telemetry',
        'advanced-dashboard', 'kpi-otif', 'cold-chain-health',
        'time-series', 'carrier-performance',
      ],
    });
  });

  app.locals.trackingEvaluateShipment = evaluateShipment;
};
