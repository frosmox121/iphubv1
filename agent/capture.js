'use strict';
// Analizador de protocolos (estilo Wireshark): captura paquetes reales de la placa de red de ESTA computadora.
// Usa tshark/dumpcap (Wireshark + Npcap en Windows) o tcpdump (Linux/macOS). Sin dependencias nativas.
const { spawn, execFile } = require('child_process'), fs = require('fs'), path = require('path'), readline = require('readline');
let proc = null, seq = 0, buf = [], tool = null, err = '', stats = { bytes: 0, proto: {} }, t0 = 0;
const MAX = 6000;
function findTool() {
  const win = process.platform === 'win32', c = [];
  if (win) { for (const b of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) if (b) c.push({ n: 'tshark', p: path.join(b, 'Wireshark', 'tshark.exe') }); c.push({ n: 'tshark', p: 'tshark.exe' }); }
  else { c.push({ n: 'tshark', p: 'tshark' }); c.push({ n: 'tcpdump', p: '/usr/sbin/tcpdump' }); c.push({ n: 'tcpdump', p: 'tcpdump' }); }
  for (const x of c) { if (path.isAbsolute(x.p) && !fs.existsSync(x.p)) continue; return x; }
  return null;
}
function ifaces() {
  return new Promise(res => {
    const t = findTool(); if (!t) return res({ error: 'No se encontró tshark ni tcpdump. En Windows instalá Wireshark (incluye Npcap) y ejecutá IPHub como administrador. En Linux/macOS instalá tcpdump o wireshark-cli.', list: [] });
    execFile(t.p, ['-D'], { timeout: 8000 }, (e, out) => {
      if (e && !out) return res({ error: 'No se pudo listar interfaces: ' + e.message, list: [] });
      const list = String(out).split(/\r?\n/).map(l => l.match(/^(\d+)\.\s*(\S+)\s*(?:\((.*?)\))?/)).filter(Boolean).map(m => ({ id: m[1], dev: m[2], name: m[3] || m[2] }));
      res({ tool: t.n, list });
    });
  });
}
const hexOf = h => Buffer.from(String(h || '').replace(/[^0-9a-f]/gi, ''), 'hex');
const mac = b => [...b].map(x => x.toString(16).padStart(2, '0')).join(':');
const ip4 = (b, o) => b[o] + '.' + b[o + 1] + '.' + b[o + 2] + '.' + b[o + 3];
const ip6 = (b, o) => { const a = []; for (let i = 0; i < 8; i++) a.push(b.readUInt16BE(o + i * 2).toString(16)); return a.join(':').replace(/(^|:)0(:0)+(:|$)/, '::'); };
const FL = [['FIN', 1], ['SYN', 2], ['RST', 4], ['PSH', 8], ['ACK', 16], ['URG', 32]];
const flagStr = f => FL.filter(x => f & x[1]).map(x => x[0]).join(', ') || 'ninguno';
const SERV = { 53: 'DNS', 80: 'HTTP', 443: 'TLS', 22: 'SSH', 67: 'DHCP', 68: 'DHCP', 123: 'NTP', 5353: 'mDNS', 1900: 'SSDP', 443.1: 'QUIC' };
// Decodificador propio (Ethernet / IPv4 / IPv6 / ARP / TCP / UDP / ICMP) para el caso tcpdump y para el hexdump
function decode(b) {
  const L = {}; let proto = 'Ethernet', src = '', dst = '', info = '', off = 14;
  if (b.length < 14) return { layers: L, proto, src, dst, info };
  L['Ethernet II'] = { 'Destino': mac(b.slice(0, 6)), 'Origen': mac(b.slice(6, 12)), 'Tipo': '0x' + b.readUInt16BE(12).toString(16).padStart(4, '0') };
  src = mac(b.slice(6, 12)); dst = mac(b.slice(0, 6));
  const et = b.readUInt16BE(12); let ipp = 0, ipEnd = b.length;
  if (et === 0x0806 && b.length >= 42) { proto = 'ARP'; const op = b.readUInt16BE(20); src = ip4(b, 28); dst = ip4(b, 38); L['ARP'] = { 'Operación': op === 1 ? 'solicitud' : 'respuesta', 'MAC emisor': mac(b.slice(22, 28)), 'IP emisor': src, 'MAC destino': mac(b.slice(32, 38)), 'IP destino': dst }; info = op === 1 ? 'Quién tiene ' + dst + '? Decile a ' + src : src + ' está en ' + mac(b.slice(22, 28)); return { layers: L, proto, src, dst, info }; }
  if (et === 0x0800 && b.length >= 34) { const ihl = (b[14] & 15) * 4; ipp = b[23]; src = ip4(b, 26); dst = ip4(b, 30); off = 14 + ihl; proto = 'IPv4'; L['IPv4'] = { 'Versión': 4, 'Largo cabecera': ihl, 'Largo total': b.readUInt16BE(16), 'TTL': b[22], 'Protocolo': ipp, 'Origen': src, 'Destino': dst }; }
  else if (et === 0x86dd && b.length >= 54) { ipp = b[20]; src = ip6(b, 22); dst = ip6(b, 38); off = 54; proto = 'IPv6'; L['IPv6'] = { 'Siguiente cabecera': ipp, 'Límite de saltos': b[21], 'Origen': src, 'Destino': dst }; }
  else return { layers: L, proto: 'Ethernet 0x' + et.toString(16), src, dst, info: 'Tipo ' + et.toString(16) };
  let sp = 0, dp = 0, pl = Buffer.alloc(0);
  if (ipp === 6 && b.length >= off + 20) { sp = b.readUInt16BE(off); dp = b.readUInt16BE(off + 2); const fl = b[off + 13], hl = (b[off + 12] >> 4) * 4; pl = b.slice(off + hl); proto = 'TCP'; L['TCP'] = { 'Puerto origen': sp, 'Puerto destino': dp, 'Secuencia': b.readUInt32BE(off + 4), 'Confirmación': b.readUInt32BE(off + 8), 'Banderas': flagStr(fl), 'Ventana': b.readUInt16BE(off + 14), 'Datos': pl.length }; info = sp + ' → ' + dp + ' [' + flagStr(fl) + '] Seq=' + b.readUInt32BE(off + 4) + ' Len=' + pl.length; }
  else if (ipp === 17 && b.length >= off + 8) { sp = b.readUInt16BE(off); dp = b.readUInt16BE(off + 2); pl = b.slice(off + 8); proto = 'UDP'; L['UDP'] = { 'Puerto origen': sp, 'Puerto destino': dp, 'Largo': b.readUInt16BE(off + 4) }; info = sp + ' → ' + dp + ' Len=' + pl.length; }
  else if (ipp === 1 || ipp === 58) { proto = ipp === 1 ? 'ICMP' : 'ICMPv6'; const ty = b[off]; L[proto] = { 'Tipo': ty, 'Código': b[off + 1] }; info = ipp === 1 ? (ty === 8 ? 'Echo (ping) solicitud' : ty === 0 ? 'Echo (ping) respuesta' : 'Tipo ' + ty) : 'Tipo ' + ty; }
  const sv = SERV[dp] || SERV[sp];
  if (sv && (proto === 'TCP' || proto === 'UDP')) {
    if (sv === 'HTTP' && pl.length) { const s = pl.toString('latin1', 0, 400); const m = s.match(/^([A-Z]{3,7} \S+ HTTP\/[\d.]+|HTTP\/[\d.]+ \d+[^\r\n]*)/); if (m) { proto = 'HTTP'; info = m[1]; L['HTTP'] = { 'Mensaje': s.split('\r\n\r\n')[0].slice(0, 600) }; } }
    else if (sv === 'DNS' && proto === 'UDP' && pl.length > 12) { proto = 'DNS'; let i = 12, n = []; while (i < pl.length && pl[i] && pl[i] < 64 && n.length < 10) { n.push(pl.toString('latin1', i + 1, i + 1 + pl[i])); i += pl[i] + 1; } const resp = pl[2] & 0x80; info = (resp ? 'Respuesta' : 'Consulta') + ' ' + n.join('.'); L['DNS'] = { 'Tipo': resp ? 'respuesta' : 'consulta', 'Nombre': n.join('.') }; }
    else if (sv === 'TLS' && pl.length > 5 && pl[0] >= 20 && pl[0] <= 23 && pl[1] === 3) { proto = 'TLS'; info = pl[0] === 22 ? 'Handshake' : pl[0] === 23 ? 'Datos de aplicación (cifrado)' : 'Registro TLS'; L['TLS'] = { 'Tipo de registro': pl[0], 'Versión': pl[1] + '.' + pl[2] }; }
    else if (sv !== 'HTTP' && sv !== 'DNS' && sv !== 'TLS') proto = sv;
  }
  if (pl.length) L['Datos'] = { 'Bytes': pl.length };
  return { layers: L, proto, src, dst, info };
}
const first = v => Array.isArray(v) ? v[0] : v;
function fromEK(o) {
  const ly = o.layers || {}; if (!ly.frame) return null; const g = k => first(ly[k]);
  const raw = first(ly.frame_raw) || '', b = hexOf(raw), d = decode(b);
  const prots = String(g('frame_frame_protocols') || '').split(':'); const ign = new Set(['eth', 'ethertype', 'ip', 'ipv6', 'data', 'frame', 'sll', 'null', 'loop', 'raw']);
  const top = prots.filter(p => !ign.has(p)).pop();
  const tree = {}; for (const k of Object.keys(ly)) { if (/_raw$/.test(k) || typeof ly[k] !== 'object' || Array.isArray(ly[k])) continue; const o2 = {}; let n = 0; for (const f of Object.keys(ly[k])) { if (n++ > 70) break; const v = first(ly[k][f]); if (typeof v === 'object') continue; o2[f.replace(new RegExp('^' + k + '_'), '').replace(/_/g, ' ')] = v; } tree[k.toUpperCase()] = o2; }
  let proto = top ? top.toUpperCase() : d.proto, info = d.info;
  const rl = g('http_http_request_line') || g('http_http_response_line'); if (rl) info = String(rl).trim(); else if (g('dns_dns_qry_name')) info = (g('dns_dns_flags_response') === '1' ? 'Respuesta ' : 'Consulta ') + g('dns_dns_qry_name'); else if (g('tls_tls_handshake_extensions_server_name')) info = 'Client Hello SNI=' + g('tls_tls_handshake_extensions_server_name');
  return { src: g('ip_ip_src') || g('ipv6_ipv6_src') || d.src, dst: g('ip_ip_dst') || g('ipv6_ipv6_dst') || d.dst, proto: proto === 'IP' ? d.proto : proto, info: info || d.info, layers: Object.assign({ Trama: { 'Largo': +g('frame_frame_len') || b.length, 'Protocolos': prots.join(' > ') } }, Object.keys(tree).length ? tree : d.layers), bytes: b, len: +g('frame_frame_len') || b.length };
}
function push(p) { p.id = ++seq; buf.push(p); stats.bytes += p.len || 0; stats.proto[p.proto] = (stats.proto[p.proto] || 0) + 1; if (buf.length > MAX) buf.splice(0, buf.length - MAX); }
function start({ iface, filter } = {}) {
  if (proc) return status(); err = '';
  const t = findTool(); if (!t) { err = 'No se encontró tshark ni tcpdump. Instalá Wireshark (con Npcap) o tcpdump.'; return status(); }
  tool = t.n; t0 = Date.now(); const f = String(filter || '').slice(0, 200);
  const args = t.n === 'tshark' ? ['-l', '-n', '-i', String(iface || '1'), '-T', 'ek', '-x'].concat(f ? ['-f', f] : []) : ['-l', '-n', '-tt', '-xx', '-s', '262144', '-i', String(iface || 'any')].concat(f ? f.split(/\s+/) : []);
  try { proc = spawn(t.p, args, { windowsHide: true }); } catch (e) { err = e.message; proc = null; return status(); }
  const rl = readline.createInterface({ input: proc.stdout });
  if (t.n === 'tshark') rl.on('line', l => { if (l[0] !== '{' || l.startsWith('{"index"')) return; try { const p = fromEK(JSON.parse(l)); if (p) { p.t = Date.now(); push(p); } } catch (_) {} });
  else { let cur = null; const fin = () => { if (!cur) return; const b = Buffer.from(cur.hex.join(''), 'hex'), d = decode(b); push({ t: cur.ts, src: d.src, dst: d.dst, proto: d.proto, info: d.info || cur.txt.slice(0, 120), layers: d.layers, bytes: b, len: b.length }); cur = null; };
    rl.on('line', l => { const h = l.match(/^(\d+\.\d+)\s+(.*)$/); if (h) { fin(); cur = { ts: Math.round(+h[1] * 1000), txt: h[2], hex: [] }; return; } const x = l.match(/^\s+0x[0-9a-f]+:\s+((?:[0-9a-f]{2,4}\s?)+)/i); if (x && cur) cur.hex.push(x[1].replace(/\s/g, '')); }); rl.on('close', fin); }
  let se = ''; proc.stderr.on('data', d => { se += d; if (se.length > 600) se = se.slice(-600); if (/permission|denied|privilegios|root|administrator|Access is denied|not permitted/i.test(se)) err = 'Sin permisos de captura. Ejecutá IPHub como administrador (Windows) o con sudo/permisos de red (Linux/macOS).'; else if (/no such device|doesn.t exist|not found/i.test(se)) err = 'Interfaz no encontrada.'; });
  proc.on('error', e => { err = e.message; proc = null; }); proc.on('close', () => { if (!err && se && !buf.length) err = se.trim().split('\n').pop(); proc = null; });
  return status();
}
function stop() { if (proc) { try { proc.kill(); } catch (_) {} proc = null; } return status(); }
function status() { return { running: !!proc, tool, last: seq, error: err, total: buf.length, bytes: stats.bytes, proto: stats.proto, since: t0 }; }
function list(since) { const s = +since || 0; return Object.assign(status(), { items: buf.filter(p => p.id > s).slice(0, 500).map(p => ({ id: p.id, t: p.t, src: p.src, dst: p.dst, proto: p.proto, len: p.len, info: p.info })) }); }
function packet(id) { const p = buf.find(x => x.id === +id); return p ? { id: p.id, t: p.t, len: p.len, proto: p.proto, layers: p.layers, hex: p.bytes.toString('hex') } : { error: 'Paquete no disponible' }; }
function clear() { buf = []; stats = { bytes: 0, proto: {} }; return status(); }
module.exports = { ifaces, start, stop, list, packet, clear, status, decode };
