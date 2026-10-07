/**
 * Tracking Studio — Motor de telemetría en proceso principal Electron
 * Pool de worker_threads, límites de recursos, backpressure, push al servidor.
 */
'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

class TelemetryEngine extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = Object.assign({
      maxWorkers: Math.min(4, Math.max(1, os.cpus().length - 1)),
      maxEventsPerSec: 50000,
      maxQueue: 20000,
      pushUrl: null, // base API e.g. http://127.0.0.1:PORT
      token: null,
    }, opts || {});
    this.workers = new Map(); // id -> { worker, stats, config }
    this.queue = [];
    this.running = false;
    this.totals = { generated: 0, pushed: 0, dropped: 0, errors: 0, batches: 0 };
    this._pushTimer = null;
    this._rateWindow = [];
  }

  resources() {
    const mem = process.memoryUsage();
    return {
      cpuCount: os.cpus().length,
      freemem: os.freemem(),
      totalmem: os.totalmem(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      workers: this.workers.size,
      maxWorkers: this.opts.maxWorkers,
      queueDepth: this.queue.length,
      maxQueue: this.opts.maxQueue,
      eventsPerSec: this._eps(),
      totals: { ...this.totals },
    };
  }

  _eps() {
    const now = Date.now();
    this._rateWindow = this._rateWindow.filter(t => now - t < 1000);
    return this._rateWindow.length;
  }

  startWorker(id, config) {
    if (this.workers.size >= this.opts.maxWorkers) {
      throw new Error('Límite de workers alcanzado (' + this.opts.maxWorkers + ')');
    }
    if (this.workers.has(id)) this.stopWorker(id);
    const workerPath = path.join(__dirname, 'telemetry-worker.js');
    const worker = new Worker(workerPath, { workerData: config || {} });
    const entry = { worker, stats: {}, config: config || {}, startedAt: Date.now() };
    worker.on('message', (msg) => this._onWorkerMsg(id, msg));
    worker.on('error', (err) => {
      this.totals.errors++;
      this.emit('error', { workerId: id, error: String(err.message || err) });
    });
    worker.on('exit', (code) => {
      this.workers.delete(id);
      this.emit('workerExit', { workerId: id, code });
    });
    this.workers.set(id, entry);
    worker.postMessage({ type: 'start', config: config || {} });
    this.running = true;
    this._ensurePushLoop();
    return { id, ok: true };
  }

  stopWorker(id) {
    const e = this.workers.get(id);
    if (!e) return { ok: false };
    try { e.worker.postMessage({ type: 'stop' }); } catch (_) {}
    setTimeout(() => {
      try { e.worker.terminate(); } catch (_) {}
    }, 500);
    this.workers.delete(id);
    if (!this.workers.size) this.running = false;
    return { ok: true };
  }

  stopAll() {
    for (const id of [...this.workers.keys()]) this.stopWorker(id);
    if (this._pushTimer) { clearInterval(this._pushTimer); this._pushTimer = null; }
    this.queue = [];
    return { ok: true };
  }

  configure(id, config) {
    const e = this.workers.get(id);
    if (!e) return { ok: false };
    e.config = Object.assign({}, e.config, config || {});
    e.worker.postMessage({ type: 'config', config: e.config });
    return { ok: true };
  }

  list() {
    return [...this.workers.entries()].map(([id, e]) => ({
      id,
      config: e.config,
      stats: e.stats,
      startedAt: e.startedAt,
    }));
  }

  _onWorkerMsg(id, msg) {
    const e = this.workers.get(id);
    if (!e) return;
    if (msg.type === 'batch' && Array.isArray(msg.readings)) {
      e.stats = msg.stats || e.stats;
      this.totals.generated += msg.readings.length;
      this.totals.batches++;
      for (let i = 0; i < msg.readings.length; i++) this._rateWindow.push(Date.now());
      // Backpressure
      if (this.queue.length + msg.readings.length > this.opts.maxQueue) {
        const drop = this.queue.length + msg.readings.length - this.opts.maxQueue;
        this.queue.splice(0, drop);
        this.totals.dropped += drop;
      }
      this.queue.push(...msg.readings);
      this.emit('batch', { workerId: id, count: msg.readings.length, stats: msg.stats });
    } else if (msg.type === 'stopped' || msg.type === 'started' || msg.type === 'pong') {
      e.stats = msg.stats || e.stats;
      this.emit(msg.type, { workerId: id, ...msg });
    } else if (msg.type === 'error') {
      this.totals.errors++;
      this.emit('error', { workerId: id, error: msg.error });
    }
  }

  _ensurePushLoop() {
    if (this._pushTimer) return;
    this._pushTimer = setInterval(() => this._flushQueue(), 400);
  }

  setCloud(base, token) {
    this.opts.pushUrl = base ? String(base).replace(/\/$/, '') : null;
    this.opts.token = token || null;
  }

  async _flushQueue() {
    if (!this.queue.length || !this.opts.pushUrl || !this.opts.token) return;
    // Agrupar por shipmentId
    const byShip = new Map();
    const take = this.queue.splice(0, 2000);
    for (const r of take) {
      const sid = r.shipmentId;
      if (!sid) { this.totals.dropped++; continue; }
      if (!byShip.has(sid)) byShip.set(sid, []);
      byShip.get(sid).push(r);
    }
    for (const [sid, readings] of byShip) {
      try {
        await this._post('/api/tracking/shipments/' + sid + '/telemetry', { readings });
        this.totals.pushed += readings.length;
      } catch (err) {
        this.totals.errors++;
        // reencolar parcialmente si falla
        if (this.queue.length < this.opts.maxQueue) {
          this.queue.unshift(...readings.slice(0, 500));
        } else {
          this.totals.dropped += readings.length;
        }
        this.emit('pushError', { shipmentId: sid, error: String(err.message || err) });
      }
    }
  }

  _post(urlPath, body) {
    return new Promise((resolve, reject) => {
      let u;
      try { u = new URL(urlPath, this.opts.pushUrl); } catch (e) { return reject(e); }
      const lib = u.protocol === 'https:' ? https : http;
      const data = Buffer.from(JSON.stringify(body));
      const req = lib.request({
        method: 'POST',
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Authorization: 'Bearer ' + this.opts.token,
          'x-iphub-agent': '1',
        },
        timeout: 15000,
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            let j = {};
            try { j = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (_) {}
            reject(new Error(j.error || ('HTTP ' + res.statusCode)));
          } else resolve(true);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(data);
      req.end();
    });
  }
}

let singleton = null;
function getEngine(opts) {
  if (!singleton) singleton = new TelemetryEngine(opts);
  else if (opts) Object.assign(singleton.opts, opts);
  return singleton;
}

module.exports = { TelemetryEngine, getEngine };
