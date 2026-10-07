/**
 * Tracking Studio — Fase 6: Dashboard predictivo
 * Proyecciones de ETA, temperatura, risk trajectory, volumen de telemetría,
 * probabilidad de excepción y escenarios what-if simples.
 */
module.exports = function register(app, ctx) {
  const { db, requireAuth, addAudit, crypto } = ctx;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID());

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

  function linearRegression(ys) {
    const n = ys.length;
    if (n < 2) return { slope: 0, intercept: ys[0] || 0, r2: 0 };
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += ys[i]; sumXY += i * ys[i]; sumXX += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / Math.max(1e-9, n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    // R²
    const mean = sumY / n;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
      const pred = intercept + slope * i;
      ssTot += (ys[i] - mean) ** 2;
      ssRes += (ys[i] - pred) ** 2;
    }
    const r2 = ssTot < 1e-12 ? 1 : Math.max(0, 1 - ssRes / ssTot);
    return { slope, intercept, r2 };
  }

  function predictSeries(values, steps) {
    const reg = linearRegression(values);
    const out = [];
    const n = values.length;
    for (let s = 1; s <= steps; s++) {
      const v = reg.intercept + reg.slope * (n - 1 + s);
      out.push({ step: s, v: Math.round(v * 100) / 100, confidence: Math.max(0.2, Math.min(0.95, reg.r2 * (1 - s * 0.04))) });
    }
    return { history: values, forecast: out, slope: reg.slope, r2: Math.round(reg.r2 * 1000) / 1000 };
  }

  function shipmentEtaForecast(shipment, tele) {
    const dest = shipment.destination;
    const loc = shipment.currentLocation || (tele.length && tele[tele.length - 1].gps ? {
      lat: tele[tele.length - 1].gps.lat,
      lon: tele[tele.length - 1].gps.lon,
    } : null);
    if (!dest || dest.lat == null || !loc || loc.lat == null) {
      return { remainingKm: null, etaMinutes: null, etaOptimistic: null, etaPessimistic: null, confidence: 0 };
    }
    const remainingKm = haversineKm(Number(loc.lat), Number(loc.lon), Number(dest.lat), Number(dest.lon));
    const speeds = tele.slice(-40).map(t => t.gps && t.gps.speed).filter(s => s != null && s > 2);
    const avg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 45;
    const sorted = speeds.slice().sort((a, b) => a - b);
    const p25 = sorted.length ? sorted[Math.floor(sorted.length * 0.25)] : avg * 0.7;
    const p75 = sorted.length ? sorted[Math.floor(sorted.length * 0.75)] : avg * 1.3;
    const base = Math.max(8, avg);
    const etaMinutes = Math.round((remainingKm / base) * 60);
    const etaOptimistic = Math.round((remainingKm / Math.max(10, p75)) * 60);
    const etaPessimistic = Math.round((remainingKm / Math.max(5, p25)) * 60);
    const confidence = Math.min(0.92, 0.3 + speeds.length * 0.015 + (shipment.actualRoute && shipment.actualRoute.length > 5 ? 0.1 : 0));
    return {
      remainingKm: Math.round(remainingKm * 10) / 10,
      avgSpeedKmh: Math.round(base * 10) / 10,
      etaMinutes,
      etaOptimistic,
      etaPessimistic,
      etaAt: new Date(Date.now() + etaMinutes * 60000).toISOString(),
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  function exceptionProbability(shipment, tele, alerts, riskScore) {
    let p = 0.05;
    if (shipment.status === 'EXCEPTION') return { probability: 0.95, band: 'certain', factors: ['already_exception'] };
    if (shipment.status === 'DELIVERED') return { probability: 0.02, band: 'low', factors: ['delivered'] };
    const factors = [];
    if (riskScore >= 70) { p += 0.35; factors.push('high_risk'); }
    else if (riskScore >= 50) { p += 0.2; factors.push('elevated_risk'); }
    else if (riskScore >= 30) { p += 0.1; factors.push('moderate_risk'); }

    const openCritical = alerts.filter(a => a.status === 'open' && (a.severity === 'critical' || a.severity === 'high')).length;
    if (openCritical) { p += Math.min(0.3, openCritical * 0.12); factors.push('open_critical_alerts'); }

    if (shipment.temperatureRequired && tele.length) {
      const last = tele[tele.length - 1];
      if (last.temperature != null) {
        const { min, max } = shipment.temperatureRequired;
        if ((min != null && last.temperature < min) || (max != null && last.temperature > max)) {
          p += 0.25; factors.push('temp_excursion');
        } else {
          // trend toward breach
          const temps = tele.filter(t => t.temperature != null).slice(-15).map(t => t.temperature);
          if (temps.length >= 5) {
            const reg = linearRegression(temps);
            const forecast = temps[temps.length - 1] + reg.slope * 10;
            if ((max != null && forecast > max) || (min != null && forecast < min)) {
              p += 0.15; factors.push('temp_trend_toward_breach');
            }
          }
        }
      }
    }

    const last = tele[tele.length - 1];
    if (last && last.battery != null && last.battery < 20) { p += 0.08; factors.push('low_battery'); }
    if (!tele.length) { p += 0.1; factors.push('no_telemetry'); }

    p = Math.max(0.01, Math.min(0.95, p));
    let band = 'low';
    if (p >= 0.6) band = 'high';
    else if (p >= 0.35) band = 'medium';
    return { probability: Math.round(p * 100) / 100, band, factors };
  }

  function riskTrajectory(shipment, tele, currentScore) {
    // Project risk 6 steps ahead based on temp trend, battery drain, silence
    const points = [{ step: 0, score: currentScore }];
    let score = currentScore;
    const temps = tele.filter(t => t.temperature != null).slice(-20).map(t => t.temperature);
    const reg = temps.length >= 3 ? linearRegression(temps) : { slope: 0 };
    const lastBat = tele.length && tele[tele.length - 1].battery != null ? tele[tele.length - 1].battery : 80;

    for (let s = 1; s <= 6; s++) {
      let delta = 0;
      if (shipment.temperatureRequired && temps.length) {
        const fut = temps[temps.length - 1] + reg.slope * s * 3;
        const { min, max } = shipment.temperatureRequired;
        if ((min != null && fut < min) || (max != null && fut > max)) delta += 8;
        else if (reg.slope > 0.1) delta += 3;
      }
      const bat = lastBat - s * 2;
      if (bat < 15) delta += 5;
      if (bat < 5) delta += 8;
      if (shipment.status === 'IN_TRANSIT' && s > 3) delta += 2;
      score = Math.max(0, Math.min(100, score + delta));
      points.push({ step: s, score: Math.round(score), horizon: s + 'h (approx)' });
    }
    return points;
  }

  // ---------- Predictive dashboard endpoint ----------
  app.get('/api/tracking/projects/:id/analytics/predictive', requireAuth, (req, res) => {
    const p = canAccessProject(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const ships = (db.get('shipments').value() || []).filter(s => s.projectId === p.id);
    const teleAll = (db.get('telemetryReads').value() || []).filter(t => t.projectId === p.id);
    const alerts = (db.get('trackingAlerts').value() || []).filter(a => a.projectId === p.id);
    const risksHist = (db.get('trackingRisk').value() || []).filter(r => r.projectId === p.id);

    // Aggregate temperature series
    const tempReadings = teleAll
      .filter(t => t.temperature != null)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
      .slice(-80)
      .map(t => t.temperature);
    const tempForecast = predictSeries(tempReadings.length ? tempReadings : [5], 12);

    // Volume forecast
    const volumeBuckets = {};
    for (const t of teleAll.slice(-8000)) {
      const key = (t.timestamp || '').slice(0, 13);
      if (key) volumeBuckets[key] = (volumeBuckets[key] || 0) + 1;
    }
    const volHistory = Object.keys(volumeBuckets).sort().slice(-36).map(k => volumeBuckets[k]);
    const volForecast = predictSeries(volHistory.length ? volHistory : [0], 12);

    // Risk history average forecast
    const riskByTime = risksHist
      .slice()
      .sort((a, b) => (a.at || '').localeCompare(b.at || ''))
      .slice(-60)
      .map(r => r.score);
    const riskForecast = predictSeries(riskByTime.length ? riskByTime : [20], 8);

    // Per-shipment predictions
    const predictions = [];
    for (const s of ships.slice(0, 80)) {
      const tele = teleAll.filter(t => t.shipmentId === s.id)
        .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
      const shipAlerts = alerts.filter(a => a.shipmentId === s.id);
      // lightweight risk approx
      let score = 15;
      if (s.status === 'EXCEPTION') score += 40;
      const openA = shipAlerts.filter(a => a.status === 'open');
      score += Math.min(40, openA.length * 8);
      if (s.temperatureRequired && tele.length) {
        const last = tele[tele.length - 1];
        if (last.temperature != null) {
          const { min, max } = s.temperatureRequired;
          if ((min != null && last.temperature < min) || (max != null && last.temperature > max)) score += 25;
        }
      }
      score = Math.min(100, score);
      const eta = shipmentEtaForecast(s, tele);
      const exc = exceptionProbability(s, tele, shipAlerts, score);
      const trajectory = riskTrajectory(s, tele, score);
      const temps = tele.filter(t => t.temperature != null).slice(-20).map(t => t.temperature);
      const tPred = temps.length >= 3 ? predictSeries(temps, 6) : null;

      predictions.push({
        shipmentId: s.id,
        trackingNumber: s.trackingNumber,
        status: s.status,
        riskScore: score,
        eta,
        exceptionProbability: exc,
        riskTrajectory: trajectory,
        tempForecast: tPred ? tPred.forecast : [],
        tempSlope: tPred ? tPred.slope : 0,
      });
    }

    // Sort by exception probability / risk
    predictions.sort((a, b) => (b.exceptionProbability.probability - a.exceptionProbability.probability) || (b.riskScore - a.riskScore));

    // Project-level KPIs predictive
    const avgExcProb = predictions.length
      ? predictions.reduce((a, b) => a + b.exceptionProbability.probability, 0) / predictions.length
      : 0;
    const highRiskCount = predictions.filter(x => x.riskScore >= 50).length;
    const likelyExceptions = predictions.filter(x => x.exceptionProbability.probability >= 0.35).length;
    const avgEta = (() => {
      const etas = predictions.map(x => x.eta.etaMinutes).filter(x => x != null);
      return etas.length ? Math.round(etas.reduce((a, b) => a + b, 0) / etas.length) : null;
    })();

    // What-if scenarios
    const scenarios = [
      {
        id: 'baseline',
        name: 'Baseline',
        description: 'Condiciones actuales sin cambio',
        expectedExceptions: likelyExceptions,
        avgRisk: predictions.length ? Math.round(predictions.reduce((a, b) => a + b.riskScore, 0) / predictions.length) : 0,
        impact: 0,
      },
      {
        id: 'cold_failure',
        name: 'Falla cadena de frío',
        description: 'Temperatura media +4°C en todos los cold-chain',
        expectedExceptions: Math.min(ships.length, likelyExceptions + Math.ceil(ships.filter(s => s.temperatureRequired).length * 0.4)),
        avgRisk: Math.min(100, (predictions.length ? Math.round(predictions.reduce((a, b) => a + b.riskScore, 0) / predictions.length) : 0) + 18),
        impact: 18,
      },
      {
        id: 'network_outage',
        name: 'Outage de conectividad 2h',
        description: 'Silencio de telemetría generalizado',
        expectedExceptions: Math.min(ships.length, likelyExceptions + Math.ceil(ships.length * 0.15)),
        avgRisk: Math.min(100, (predictions.length ? Math.round(predictions.reduce((a, b) => a + b.riskScore, 0) / predictions.length) : 0) + 12),
        impact: 12,
      },
      {
        id: 'carrier_delay',
        name: 'Retraso carrier +50% ETA',
        description: 'Velocidad efectiva reducida a la mitad',
        expectedExceptions: Math.min(ships.length, likelyExceptions + Math.ceil(ships.filter(s => s.status === 'IN_TRANSIT').length * 0.2)),
        avgRisk: Math.min(100, (predictions.length ? Math.round(predictions.reduce((a, b) => a + b.riskScore, 0) / predictions.length) : 0) + 10),
        impact: 10,
      },
    ];

    // Delivery forecast funnel (next hours)
    const inTransit = ships.filter(s => ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'PICKED_UP', 'ARRIVED_AT_FACILITY'].includes(s.status));
    const deliveryFunnel = [1, 3, 6, 12, 24].map(h => {
      const expected = predictions.filter(pr =>
        pr.eta.etaMinutes != null && pr.eta.etaMinutes <= h * 60 && pr.status !== 'DELIVERED' && pr.status !== 'EXCEPTION'
      ).length;
      return { horizonHours: h, expectedDeliveries: expected };
    });

    res.json({
      projectId: p.id,
      projectName: p.name,
      mode: p.mode,
      generatedAt: new Date().toISOString(),
      phase: 6,
      kpis: {
        shipments: ships.length,
        inTransit: inTransit.length,
        avgExceptionProbability: Math.round(avgExcProb * 100),
        likelyExceptions,
        highRiskCount,
        avgEtaMinutes: avgEta,
        tempTrendSlope: tempForecast.slope,
        tempR2: tempForecast.r2,
        volumeTrendSlope: volForecast.slope,
      },
      forecasts: {
        temperature: {
          history: tempReadings.slice(-40).map((v, i) => ({ i, v })),
          forecast: tempForecast.forecast,
          slope: tempForecast.slope,
          r2: tempForecast.r2,
        },
        volume: {
          history: volHistory.slice(-24).map((v, i) => ({ i, v })),
          forecast: volForecast.forecast,
          slope: volForecast.slope,
          r2: volForecast.r2,
        },
        risk: {
          history: riskByTime.slice(-30).map((v, i) => ({ i, v })),
          forecast: riskForecast.forecast,
          slope: riskForecast.slope,
          r2: riskForecast.r2,
        },
      },
      deliveryFunnel,
      scenarios,
      topPredictions: predictions.slice(0, 15),
    });
  });

  // Single shipment predictive detail
  app.get('/api/tracking/shipments/:id/predictive', requireAuth, (req, res) => {
    const s = (db.get('shipments').value() || []).find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });
    if (!canAccessProject(req.user.id, s.projectId)) return res.status(403).json({ error: 'Sin acceso' });

    const tele = (db.get('telemetryReads').value() || [])
      .filter(t => t.shipmentId === s.id)
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    const alerts = (db.get('trackingAlerts').value() || []).filter(a => a.shipmentId === s.id);

    let score = 15;
    if (s.status === 'EXCEPTION') score += 40;
    score += Math.min(40, alerts.filter(a => a.status === 'open').length * 8);
    score = Math.min(100, score);

    const eta = shipmentEtaForecast(s, tele);
    const exc = exceptionProbability(s, tele, alerts, score);
    const trajectory = riskTrajectory(s, tele, score);
    const temps = tele.filter(t => t.temperature != null).slice(-30).map(t => t.temperature);
    const tPred = predictSeries(temps.length ? temps : [5], 10);
    const speeds = tele.slice(-30).map(t => (t.gps && t.gps.speed) || 0);
    const sPred = predictSeries(speeds.length ? speeds : [40], 8);

    res.json({
      shipmentId: s.id,
      trackingNumber: s.trackingNumber,
      status: s.status,
      riskScore: score,
      eta,
      exceptionProbability: exc,
      riskTrajectory: trajectory,
      temperature: tPred,
      speed: sPred,
      samples: tele.length,
    });
  });

  app.get('/api/tracking/predictive/meta', requireAuth, (req, res) => {
    res.json({
      phase: 6,
      features: [
        'eta-band-forecast', 'temperature-forecast', 'volume-forecast',
        'risk-trajectory', 'exception-probability', 'what-if-scenarios',
        'delivery-funnel', 'predictive-dashboard',
      ],
    });
  });
};
