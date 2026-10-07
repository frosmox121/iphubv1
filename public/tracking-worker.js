/**
 * Tracking Studio — Web Worker de telemetría (Fase 2)
 * Genera lecturas GPS/temp/humedad/batería en background sin bloquear el UI.
 * Mensajes: { type: 'start'|'stop'|'config'|'ping', ... }
 * Respuestas: { type: 'batch'|'stats'|'error'|'ready', ... }
 */
'use strict';

let running = false;
let timer = null;
let cfg = {
  deviceId: 'tracker-worker',
  shipmentId: null,
  intervalMs: 1000,
  batchSize: 20,
  noise: 0.03,
  batteryDrainPerHour: 0.2,
  pattern: 'route', // constant | random | gaussian | sinusoidal | route | failure
  route: [], // [{lat,lon}, ...]
  startLat: -34.6037,
  startLon: -58.3816,
  endLat: -33.4489,
  endLon: -70.6693,
  baseTemp: 5,
  baseHumidity: 60,
  battery: 100,
  signal: -70,
  failureRate: 0,
  seed: 1,
};

let stats = { generated: 0, batches: 0, dropped: 0, startedAt: null, lastBatchAt: null };
let routeIdx = 0;
let tick = 0;
let rngState = 1;

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(cfg.seed);

function gauss() {
  const u = 1 - rand(), v = 1 - rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function position() {
  const n = cfg.noise || 0;
  if (cfg.pattern === 'constant') {
    return { lat: cfg.startLat + gauss() * n * 0.001, lon: cfg.startLon + gauss() * n * 0.001, speed: 0 };
  }
  if (cfg.pattern === 'random') {
    return {
      lat: cfg.startLat + (rand() - 0.5) * 0.5,
      lon: cfg.startLon + (rand() - 0.5) * 0.5,
      speed: 20 + rand() * 80,
    };
  }
  // route-based (default) — interpola origen→destino o waypoints
  const pts = (cfg.route && cfg.route.length >= 2)
    ? cfg.route
    : [{ lat: cfg.startLat, lon: cfg.startLon }, { lat: cfg.endLat, lon: cfg.endLon }];
  const segs = pts.length - 1;
  const progress = Math.min(0.999, (tick * (cfg.intervalMs / 1000) * 0.002) % 1); // ~0.2% por segundo
  const f = progress * segs;
  const i = Math.min(segs - 1, Math.floor(f));
  const t = f - i;
  const a = pts[i], b = pts[i + 1];
  const lat = lerp(a.lat, b.lat, t) + gauss() * n * 0.002;
  const lon = lerp(a.lon, b.lon, t) + gauss() * n * 0.002;
  const dist = Math.sqrt(Math.pow((b.lat - a.lat) * 111, 2) + Math.pow((b.lon - a.lon) * 85, 2));
  const speed = Math.max(10, dist / Math.max(0.01, (cfg.intervalMs / 1000) * segs) * 3.6);
  return { lat, lon, speed };
}

function sample() {
  tick++;
  if (cfg.failureRate > 0 && rand() < cfg.failureRate) {
    stats.dropped++;
    return null;
  }
  const pos = position();
  const hours = (cfg.intervalMs / 1000) / 3600;
  cfg.battery = Math.max(0, cfg.battery - cfg.batteryDrainPerHour * hours);
  let temp = cfg.baseTemp;
  if (cfg.pattern === 'sinusoidal') temp += Math.sin(tick / 30) * 2;
  else if (cfg.pattern === 'gaussian') temp += gauss() * 0.5;
  else if (cfg.pattern === 'failure') temp += tick > 50 ? 8 + rand() * 5 : gauss() * 0.3;
  else temp += gauss() * (cfg.noise * 2);

  const reading = {
    deviceId: cfg.deviceId,
    shipmentId: cfg.shipmentId,
    timestamp: new Date().toISOString(),
    gps: {
      lat: pos.lat,
      lon: pos.lon,
      altitude: 40 + gauss() * 10,
      speed: pos.speed + gauss() * 2,
    },
    temperature: Math.round(temp * 100) / 100,
    humidity: Math.round((cfg.baseHumidity + gauss() * 3) * 10) / 10,
    light: 0,
    impactG: Math.max(0, 0.1 + Math.abs(gauss()) * 0.15),
    battery: Math.round(cfg.battery * 10) / 10,
    signal: Math.round(cfg.signal + gauss() * 5),
    source: 'SIMULATED',
  };
  stats.generated++;
  return reading;
}

function emitBatch() {
  if (!running) return;
  const batch = [];
  for (let i = 0; i < cfg.batchSize; i++) {
    const r = sample();
    if (r) batch.push(r);
  }
  if (batch.length) {
    stats.batches++;
    stats.lastBatchAt = Date.now();
    self.postMessage({ type: 'batch', readings: batch, stats: { ...stats } });
  }
}

function start() {
  if (running) return;
  running = true;
  stats.startedAt = Date.now();
  stats.generated = 0;
  stats.batches = 0;
  stats.dropped = 0;
  tick = 0;
  rand = mulberry32(cfg.seed | 0);
  const period = Math.max(50, cfg.intervalMs);
  timer = setInterval(emitBatch, period);
  self.postMessage({ type: 'started', cfg: { intervalMs: cfg.intervalMs, batchSize: cfg.batchSize, pattern: cfg.pattern } });
}

function stop() {
  running = false;
  if (timer) { clearInterval(timer); timer = null; }
  self.postMessage({ type: 'stopped', stats: { ...stats } });
}

self.onmessage = function (e) {
  const msg = e.data || {};
  switch (msg.type) {
    case 'config':
      Object.assign(cfg, msg.config || {});
      if (msg.config && msg.config.seed != null) rand = mulberry32(cfg.seed | 0);
      self.postMessage({ type: 'configured', cfg });
      break;
    case 'start':
      if (msg.config) Object.assign(cfg, msg.config);
      start();
      break;
    case 'stop':
      stop();
      break;
    case 'ping':
      self.postMessage({ type: 'pong', running, stats: { ...stats }, cfg });
      break;
    default:
      self.postMessage({ type: 'error', error: 'unknown message: ' + msg.type });
  }
};

self.postMessage({ type: 'ready' });
