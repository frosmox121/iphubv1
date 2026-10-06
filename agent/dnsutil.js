'use strict';
// Paquetes DNS / mDNS / NetBIOS mínimos (sin dependencias)
function encName(name) {
  const parts = String(name).replace(/\.$/, '').split('.');
  return Buffer.concat([...parts.map(p => { const b = Buffer.from(p, 'utf8'); return Buffer.concat([Buffer.from([b.length]), b]); }), Buffer.from([0])]);
}
function buildQuery(questions, unicast) {
  const h = Buffer.alloc(12); h.writeUInt16BE(questions.length, 4);
  return Buffer.concat([h, ...questions.map(q => { const t = Buffer.alloc(4); t.writeUInt16BE(q.type, 0); t.writeUInt16BE(unicast ? 0x8001 : 1, 2); return Buffer.concat([encName(q.name), t]); })]);
}
function readName(buf, off) {
  const labels = []; let next = -1, guard = 0;
  while (guard++ < 64) {
    const len = buf[off]; if (len === undefined) throw new Error('eof');
    if (len === 0) { off++; break; }
    if ((len & 0xC0) === 0xC0) { if (next < 0) next = off + 2; off = ((len & 0x3F) << 8) | buf[off + 1]; continue; }
    off++; labels.push(buf.toString('utf8', off, off + len)); off += len;
  }
  return { name: labels.join('.'), next: next < 0 ? off : next };
}
function parse(buf) {
  const recs = [];
  try {
    const qd = buf.readUInt16BE(4), total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    let off = 12;
    for (let i = 0; i < qd; i++) off = readName(buf, off).next + 4;
    for (let i = 0; i < total && off < buf.length; i++) {
      const n = readName(buf, off); off = n.next;
      const type = buf.readUInt16BE(off), len = buf.readUInt16BE(off + 8), rd = off + 10; off = rd + len;
      let data = null;
      if (type === 1) data = [...buf.slice(rd, rd + 4)].join('.');
      else if (type === 12) data = readName(buf, rd).name;
      else if (type === 33) data = { port: buf.readUInt16BE(rd + 4), target: readName(buf, rd + 6).name };
      else if (type === 16) {
        data = {}; let p = rd;
        while (p < rd + len) { const l = buf[p++]; const s = buf.toString('utf8', p, p + l); p += l; const i = s.indexOf('='); if (i > 0) data[s.slice(0, i).toLowerCase()] = s.slice(i + 1); }
      }
      recs.push({ name: n.name, type, data });
    }
  } catch (_) { /* paquete corrupto: se devuelve lo que se alcanzó a leer */ }
  return recs;
}
function nbstatQuery() {
  const h = Buffer.alloc(12); h.writeUInt16BE(0x4950, 0); h.writeUInt16BE(1, 4);
  const name = Buffer.concat([Buffer.from([0x20]), Buffer.from('CK' + 'A'.repeat(30), 'ascii'), Buffer.from([0])]);
  const t = Buffer.alloc(4); t.writeUInt16BE(0x21, 0); t.writeUInt16BE(1, 2);
  return Buffer.concat([h, name, t]);
}
function nbstatParse(buf) {
  try {
    if (buf.length < 57 || buf.readUInt16BE(0) !== 0x4950) return null;
    let off = 12;
    for (let i = 0, qd = buf.readUInt16BE(4); i < qd; i++) off = readName(buf, off).next + 4;
    off = readName(buf, off).next;
    if (buf.readUInt16BE(off) !== 0x21) return null;
    off += 10;
    const n = buf[off++]; let name = '', group = '';
    for (let i = 0; i < n; i++) {
      const nm = buf.toString('latin1', off, off + 15).trim(), suf = buf[off + 15], fl = buf.readUInt16BE(off + 16); off += 18;
      if (suf === 0) { if (fl & 0x8000) { if (!group) group = nm; } else if (!name) name = nm; }
    }
    const mac = [...buf.slice(off, off + 6)].map(x => x.toString(16).padStart(2, '0')).join(':');
    return { name, group, mac: mac === '00:00:00:00:00:00' ? '' : mac };
  } catch (_) { return null; }
}
module.exports = { buildQuery, parse, nbstatQuery, nbstatParse };
