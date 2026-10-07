// Base JSON compatible con las llamadas db.get().find().assign().write() sin lodash.
const fs = require('fs');
function match(obj, q) {
  if (!q) return true;
  return Object.keys(q).every(k => obj && obj[k] === q[k]);
}
// Cadena mínima compatible con lodash: filter/take/map/reverse/sortBy/size/value
function chain(arr) {
  return {
    value: () => arr,
    filter: q => chain(arr.filter(typeof q === 'function' ? q : x => match(x, q))),
    take: n => chain(arr.slice(0, n)),
    map: f => chain(arr.map(f)),
    reverse: () => chain([...arr].reverse()),
    sortBy: k => chain([...arr].sort((a, b) => { const x = typeof k === 'function' ? k(a) : a[k], y = typeof k === 'function' ? k(b) : b[k]; return x < y ? -1 : x > y ? 1 : 0; })),
    size: () => ({ value: () => arr.length }),
    find: q => ({ value: () => arr.find(typeof q === 'function' ? q : x => match(x, q)) }),
  };
}
function Mini(state, persist) {
  const save = () => { try { persist(state); } catch (_) {} };
  function wrap(list, key) {
    return {
      value() { return state[key]; },
      find(q) {
        const i = (state[key] || []).findIndex(x => match(x, q));
        return {
          value: () => (i >= 0 ? state[key][i] : undefined),
          assign(patch) { if (i >= 0) Object.assign(state[key][i], patch); return this; },
          write() { save(); return state[key]; },
        };
      },
      filter(q) { return chain((state[key] || []).filter(typeof q === 'function' ? q : x => match(x, q))); },
      take(n) { return chain((state[key] || []).slice(0, n)); },
      map(f) { return chain((state[key] || []).map(f)); },
      size() { return { value: () => (state[key] || []).length }; },
      push(row) { (state[key] = state[key] || []).push(row); return { write: () => save() }; },
      unshift(row) { (state[key] = state[key] || []).unshift(row); return { write: () => save() }; },
      remove(q) { state[key] = (state[key] || []).filter(x => !match(x, q)); return { write: () => save() }; },
      write() { save(); return state[key]; },
    };
  }
  return {
    get: key => wrap(state[key], key),
    set(key, val) {
      if (Array.isArray(key)) { let o = state; for (let i = 0; i < key.length - 1; i++) o = (o[key[i]] = o[key[i]] || {}); o[key[key.length - 1]] = val; } else state[key] = val;
      return { write: save };
    },
    defaults(obj) { for (const k of Object.keys(obj)) if (state[k] == null) state[k] = obj[k]; return { write: save }; },
  };
}
module.exports = function miniDb(initial, persist) { return Mini(initial, persist); };
