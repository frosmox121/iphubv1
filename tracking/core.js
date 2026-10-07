/* Tracking Studio — núcleo: Event Bus interno + hash chain (integridad append-only).
 * Reutilizado por todos los servicios de dominio (shipments, telemetry, geofences, etc.). */
'use strict';
const crypto = require('crypto');

const sha16 = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

// Event bus especificado en el prompt maestro (#75)
const EVENTS = [
  'shipment.created', 'shipment.updated', 'shipment.location_changed',
  'telemetry.received', 'telemetry.anomaly',
  'device.connected', 'device.disconnected',
  'geofence.enter', 'geofence.exit',
  'alert.created', 'incident.created',
  'simulation.started', 'simulation.completed',
  'snapshot.created',
  'virtuallab.connected', 'virtuallab.disconnected',
];

function makeBus() {
  const listeners = new Map(); // event -> Set(fn)
  return {
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => this.off(ev, fn); },
    off(ev, fn) { listeners.get(ev)?.delete(fn); },
    emit(ev, payload) {
      try { listeners.get(ev)?.forEach(fn => { try { fn(payload); } catch (_) {} }); } catch (_) {}
      try { listeners.get('*')?.forEach(fn => { try { fn({ ev, payload }); } catch (_) {} }); } catch (_) {}
    },
    list: () => [...EVENTS],
  };
}

// Motor append-only con firma encadenada (cada evento referencia el hash del anterior)
function appendEvent(store, projectId, kind, data) {
  const prev = store.length ? store[store.length - 1] : null;
  const ev = {
    id: crypto.randomUUID(),
    seq: (prev ? prev.seq : 0) + 1,
    ts: new Date().toISOString(),
    kind, // shipment | telemetry | geofence | alert | incident | simulation | snapshot | system
    ...data,
    previousEventHash: prev ? prev.hash : null,
  };
  ev.hash = sha16(ev);
  store.push(ev);
  return ev;
}

function verifyChain(store) {
  let prevHash = null;
  for (const e of store) {
    const { hash, ...rest } = e;
    if (e.previousEventHash !== prevHash || sha16(rest) !== hash) return { ok: false, at: e.seq };
    prevHash = hash;
  }
  return { ok: true, count: store.length };
}

module.exports = { makeBus, appendEvent, verifyChain, sha16, EVENTS };
