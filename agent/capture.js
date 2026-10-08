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
function findDumpcap(t) { // dumpcap viene con Wireshark: escribe pcap por stdout en vivo (más estable que parsear la salida de tshark)
  if (!t || t.n !== 'tshark') return null;
  const cand = path.isAbsolute(t.p) ? path.join(path.dirname(t.p), process.platform === 'win32' ? 'dumpcap.exe' : 'dumpcap') : (process.platform === 'win32' ? 'dumpcap.exe' : 'dumpcap');
  if (path.isAbsolute(cand) && !fs.existsSync(cand)) return null;
  return cand;
}
// Mensajes informativos de tshark/dumpcap que NO son errores (p. ej. "Capturing on…", "[Main MESSAGE] -- File: …")
const INFO_RE = /^\s*$|Capturing on|\[Main MESSAGE\]|-- File:|packets? (captured|dropped|received)|^\s*\d+\s*$|Running as user|Running as/i;
function realErr(se) { const l = String(se).split(/\r?\n/).map(x => x.trim()).filter(x => x && !INFO_RE.test(x)); return l.length ? l.slice(-2).join(' · ') : ''; }
// Parser de pcap en streaming (libpcap clásico) + adaptación de enlaces no-Ethernet a Ethernet para reutilizar decode()
function toEth(lt, b) {
  const fake = et => { const h = Buffer.alloc(14); h.writeUInt16BE(et, 12); return h; };
  if (lt === 1) return b;
  if (lt === 0 && b.length > 4) return Buffer.concat([fake((b[4] >> 4) === 6 ? 0x86dd : 0x0800), b.slice(4)]); // loopback de Npcap / BSD
  if ((lt === 101 || lt === 228 || lt === 229) && b.length > 0) return Buffer.concat([fake((b[0] >> 4) === 6 ? 0x86dd : 0x0800), b]);
  if (lt === 113 && b.length > 16) return Buffer.concat([fake(b.readUInt16BE(14)), b.slice(16)]); // Linux cooked
  return b;
}
function pcapStream(onPkt, onFail) {
  let acc = Buffer.alloc(0), le = true, ns = false, lt = 1, hdr = false;
  return chunk => {
    acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
    if (!hdr) {
      if (acc.length < 24) return;
      const m = acc.readUInt32LE(0);
      if (m === 0xa1b2c3d4) { le = true; ns = false; } else if (m === 0xd4c3b2a1) { le = false; ns = false; } else if (m === 0xa1b23c4d) { le = true; ns = true; } else if (m === 0x4d3cb2a1) { le = false; ns = true; }
      else { acc = Buffer.alloc(0); return onFail('La herramienta de captura devolvió un formato inesperado.'); }
      lt = (le ? acc.readUInt32LE(20) : acc.readUInt32BE(20)) & 0x0fffffff; acc = acc.slice(24); hdr = true;
    }
    while (acc.length >= 16) {
      const rd = o => le ? acc.readUInt32LE(o) : acc.readUInt32BE(o), incl = rd(8);
      if (incl > 1 << 24) { acc = Buffer.alloc(0); return onFail('Captura corrupta.'); }
      if (acc.length < 16 + incl) break;
      onPkt(toEth(lt, Buffer.from(acc.slice(16, 16 + incl))), rd(0) * 1000 + Math.floor(rd(4) / (ns ? 1e6 : 1e3)), rd(12));
      acc = acc.slice(16 + incl);
    }
  };
}
function ifaces() {
  return new Promise(res => {
    const t = findTool(); if (!t) return res({ error: 'No se encontró tshark ni tcpdump. En Windows instalá Wireshark (incluye Npcap) y ejecutá IPHub como administrador. En Linux/macOS instalá tcpdump o wireshark-cli.', list: [] });
    execFile(t.p, ['-D'], { timeout: 15000, windowsHide: true }, (e, out) => {
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
const SERV = { 20: 'FTP-DATA', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 69: 'TFTP', 80: 'HTTP', 88: 'Kerberos', 110: 'POP3', 111: 'RPC', 119: 'NNTP', 123: 'NTP', 135: 'MS-RPC', 137: 'NBNS', 138: 'NBDS', 139: 'NetBIOS', 143: 'IMAP', 161: 'SNMP', 162: 'SNMP-Trap', 179: 'BGP', 389: 'LDAP', 427: 'SLP', 443: 'TLS', 445: 'SMB', 465: 'SMTPS', 500: 'IKE', 514: 'Syslog', 515: 'LPD', 520: 'RIP', 546: 'DHCPv6', 547: 'DHCPv6', 554: 'RTSP', 587: 'SMTP', 631: 'IPP', 636: 'LDAPS', 853: 'DoT', 873: 'rsync', 993: 'IMAPS', 995: 'POP3S', 1080: 'SOCKS', 1194: 'OpenVPN', 1433: 'MSSQL', 1701: 'L2TP', 1723: 'PPTP', 1812: 'RADIUS', 1813: 'RADIUS', 1883: 'MQTT', 1900: 'SSDP', 2049: 'NFS', 3306: 'MySQL', 3389: 'RDP', 3478: 'STUN', 4500: 'IPsec-NAT', 5060: 'SIP', 5061: 'SIPS', 5222: 'XMPP', 5353: 'mDNS', 5355: 'LLMNR', 5432: 'PostgreSQL', 5683: 'CoAP', 5900: 'VNC', 6379: 'Redis', 6881: 'BitTorrent', 8080: 'HTTP', 8443: 'TLS', 8883: 'MQTT-TLS', 9100: 'JetDirect', 27017: 'MongoDB', 51820: 'WireGuard' };
const IPP = { 2: 'IGMP', 4: 'IP-in-IP', 41: 'IPv6-in-IP', 47: 'GRE', 50: 'ESP', 51: 'AH', 88: 'EIGRP', 89: 'OSPF', 103: 'PIM', 112: 'VRRP', 115: 'L2TP', 132: 'SCTP', 136: 'UDPLite' };
const ETYPE = { 0x88cc: 'LLDP', 0x888e: 'EAPOL', 0x88f7: 'PTP', 0x8847: 'MPLS', 0x8848: 'MPLS', 0x8863: 'PPPoE', 0x8864: 'PPPoE', 0x88a8: 'QinQ', 0x8906: 'FCoE', 0x0842: 'WoL', 0x8100: 'VLAN' };
const ICMP6 = { 128: 'Echo solicitud', 129: 'Echo respuesta', 133: 'Router Solicitation', 134: 'Router Advertisement', 135: 'Neighbor Solicitation', 136: 'Neighbor Advertisement', 143: 'MLDv2 Report' };
const DHCPT = { 1: 'Discover', 2: 'Offer', 3: 'Request', 4: 'Decline', 5: 'ACK', 6: 'NAK', 7: 'Release', 8: 'Inform' };
function sniOf(p) { try { if (p[5] !== 1) return ''; let i = 43; i += 1 + p[i]; i += 2 + p.readUInt16BE(i); i += 1 + p[i]; const end = i + 2 + p.readUInt16BE(i); i += 2; while (i + 4 <= end && i + 4 <= p.length) { const ty = p.readUInt16BE(i), ln = p.readUInt16BE(i + 2); if (ty === 0) return ' · Client Hello SNI=' + p.toString('latin1', i + 9, i + 4 + ln); i += 4 + ln; } } catch (_) {} return ''; }
// Decodificador propio (Ethernet / IPv4 / IPv6 / ARP / TCP / UDP / ICMP) para el caso tcpdump y para el hexdump
function decode(b) {
  const L = {}; let proto = 'Ethernet', src = '', dst = '', info = '', off = 14;
  if (b.length < 14) return { layers: L, proto, src, dst, info };
  L['Ethernet II'] = { 'Destino': mac(b.slice(0, 6)), 'Origen': mac(b.slice(6, 12)), 'Tipo': '0x' + b.readUInt16BE(12).toString(16).padStart(4, '0') };
  src = mac(b.slice(6, 12)); dst = mac(b.slice(0, 6));
  let et = b.readUInt16BE(12); let ipp = 0, ipEnd = b.length;
  if (et === 0x8100 && b.length >= 18) { L['VLAN 802.1Q'] = { 'ID': b.readUInt16BE(14) & 0xfff, 'Prioridad': b[14] >> 5 }; b = Buffer.concat([b.slice(0, 12), b.slice(16)]); et = b.readUInt16BE(12); }
  if (et < 0x600 && b.length > 17 && b[14] === 0x42 && b[15] === 0x42) return { layers: L, proto: 'STP', src, dst, info: 'Spanning Tree (BPDU)' };
  if (ETYPE[et] && et !== 0x8100) { L[ETYPE[et]] = { 'Tipo': '0x' + et.toString(16) }; return { layers: L, proto: ETYPE[et], src, dst, info: ETYPE[et] + ' · ' + (b.length - 14) + ' bytes' }; }
  if (et === 0x0806 && b.length >= 42) { proto = 'ARP'; const op = b.readUInt16BE(20); src = ip4(b, 28); dst = ip4(b, 38); L['ARP'] = { 'Operación': op === 1 ? 'solicitud' : 'respuesta', 'MAC emisor': mac(b.slice(22, 28)), 'IP emisor': src, 'MAC destino': mac(b.slice(32, 38)), 'IP destino': dst }; info = op === 1 ? 'Quién tiene ' + dst + '? Decile a ' + src : src + ' está en ' + mac(b.slice(22, 28)); return { layers: L, proto, src, dst, info }; }
  if (et === 0x0800 && b.length >= 34) { const ihl = (b[14] & 15) * 4; ipp = b[23]; src = ip4(b, 26); dst = ip4(b, 30); off = 14 + ihl; proto = 'IPv4'; L['IPv4'] = { 'Versión': 4, 'Largo cabecera': ihl, 'Largo total': b.readUInt16BE(16), 'TTL': b[22], 'Protocolo': ipp, 'Origen': src, 'Destino': dst }; }
  else if (et === 0x86dd && b.length >= 54) { ipp = b[20]; src = ip6(b, 22); dst = ip6(b, 38); off = 54; proto = 'IPv6'; L['IPv6'] = { 'Siguiente cabecera': ipp, 'Límite de saltos': b[21], 'Origen': src, 'Destino': dst }; }
  else return { layers: L, proto: 'Ethernet 0x' + et.toString(16), src, dst, info: 'Tipo ' + et.toString(16) };
  let sp = 0, dp = 0, pl = Buffer.alloc(0);
  if (ipp === 6 && b.length >= off + 20) { sp = b.readUInt16BE(off); dp = b.readUInt16BE(off + 2); const fl = b[off + 13], hl = (b[off + 12] >> 4) * 4; pl = b.slice(off + hl); proto = 'TCP'; L['TCP'] = { 'Puerto origen': sp, 'Puerto destino': dp, 'Secuencia': b.readUInt32BE(off + 4), 'Confirmación': b.readUInt32BE(off + 8), 'Banderas': flagStr(fl), 'Ventana': b.readUInt16BE(off + 14), 'Datos': pl.length }; info = sp + ' → ' + dp + ' [' + flagStr(fl) + '] Seq=' + b.readUInt32BE(off + 4) + ' Len=' + pl.length; }
  else if (ipp === 17 && b.length >= off + 8) { sp = b.readUInt16BE(off); dp = b.readUInt16BE(off + 2); pl = b.slice(off + 8); proto = 'UDP'; L['UDP'] = { 'Puerto origen': sp, 'Puerto destino': dp, 'Largo': b.readUInt16BE(off + 4) }; info = sp + ' → ' + dp + ' Len=' + pl.length; }
  else if (ipp === 1 || ipp === 58) { proto = ipp === 1 ? 'ICMP' : 'ICMPv6'; const ty = b[off]; L[proto] = { 'Tipo': ty, 'Código': b[off + 1] }; info = ipp === 1 ? (ty === 8 ? 'Echo (ping) solicitud' : ty === 0 ? 'Echo (ping) respuesta' : ty === 3 ? 'Destino inalcanzable' : ty === 11 ? 'TTL excedido' : 'Tipo ' + ty) : (ICMP6[ty] || 'Tipo ' + ty); }
  else if (IPP[ipp]) { proto = IPP[ipp]; L[proto] = { 'Protocolo IP': ipp }; info = proto + ' · ' + (b.length - off) + ' bytes'; }
  else if (ipp) { proto = 'IP/' + ipp; info = 'Protocolo IP ' + ipp; }
  const sv = SERV[dp] || SERV[sp];
  if (sv && (proto === 'TCP' || proto === 'UDP')) {
    if (sv === 'HTTP' && pl.length) { const s = pl.toString('latin1', 0, 400); const m = s.match(/^([A-Z]{3,7} \S+ HTTP\/[\d.]+|HTTP\/[\d.]+ \d+[^\r\n]*)/); if (m) { proto = 'HTTP'; info = m[1]; L['HTTP'] = { 'Mensaje': s.split('\r\n\r\n')[0].slice(0, 600) }; } }
    else if ((sv === 'DNS' || sv === 'mDNS' || sv === 'LLMNR') && proto === 'UDP' && pl.length > 12) { proto = sv; let i = 12, n = []; while (i < pl.length && pl[i] && pl[i] < 64 && n.length < 10) { n.push(pl.toString('latin1', i + 1, i + 1 + pl[i])); i += pl[i] + 1; } const resp = pl[2] & 0x80; info = (resp ? 'Respuesta' : 'Consulta') + ' ' + n.join('.'); L['DNS'] = { 'Tipo': resp ? 'respuesta' : 'consulta', 'Nombre': n.join('.') }; }
    else if (sv === 'TLS' && pl.length > 5 && pl[0] >= 20 && pl[0] <= 23 && pl[1] === 3) { proto = 'TLS'; info = pl[0] === 22 ? ('Handshake' + sniOf(pl)) : pl[0] === 23 ? 'Datos de aplicación (cifrado)' : 'Registro TLS'; L['TLS'] = { 'Tipo de registro': pl[0], 'Versión': pl[1] + '.' + pl[2] }; }
    else if (sv === 'DHCP' && pl.length > 240) { proto = 'DHCP'; let t = 0; for (let i = 240; i < pl.length - 2;) { const o = pl[i]; if (o === 255) break; if (o === 0) { i++; continue; } if (o === 53) t = pl[i + 2]; i += 2 + pl[i + 1]; } info = 'DHCP ' + (DHCPT[t] || 'mensaje') + ' · cliente ' + mac(pl.slice(28, 34)); L['DHCP'] = { 'Operación': pl[0] === 1 ? 'solicitud' : 'respuesta', 'IP ofrecida': ip4(pl, 16), 'MAC cliente': mac(pl.slice(28, 34)), 'Tipo': DHCPT[t] || t }; }
    else if (sv === 'TLS' && proto === 'UDP') { proto = 'QUIC'; info = sp + ' → ' + dp + ' Len=' + pl.length; L['QUIC'] = { 'Bytes': pl.length }; }
    else if (sv !== 'HTTP' && sv !== 'DNS' && sv !== 'TLS') { proto = sv; if (pl.length && !info.includes('Len=')) info += ' · ' + pl.length + ' bytes'; }
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
let stopping = false, startedAt = 0;
function start({ iface, filter } = {}) {
  if (proc) return status(); err = '';
  const t = findTool(); if (!t) { err = 'No se encontró tshark ni tcpdump. Instalá Wireshark (con Npcap) o tcpdump.'; return status(); }
  const dc = findDumpcap(t), f = String(filter || '').trim().slice(0, 200), ifc = String(iface || '').trim() || (t.n === 'tcpdump' ? 'any' : '1');
  if (!/^[\w.:\\{}\-\\/ ]+$/.test(ifc) && ifc) { err = 'Interfaz inválida.'; return status(); }
  if (f && !/^[\w\s.:()!&|<>=\-\/\[\]]+$/.test(f)) { err = 'Filtro de captura inválido (usá sintaxis BPF, por ejemplo: tcp port 80).'; return status(); }
  tool = dc ? 'dumpcap' : t.n; t0 = Date.now(); startedAt = t0; stopping = false;
  let cmd, args, mode;
  if (dc) { cmd = dc; mode = 'pcap'; args = ['-q', '-P', '-i', ifc, '-w', '-'].concat(f ? ['-f', f] : []); }
  else if (t.n === 'tshark') { cmd = t.p; mode = 'ek'; args = ['-l', '-n', '-i', ifc, '-T', 'ek', '-x'].concat(f ? ['-f', f] : []); }
  else { cmd = t.p; mode = 'tcpdump'; args = ['-l', '-n', '-tt', '-xx', '-s', '262144', '-i', ifc].concat(f ? f.split(/\s+/) : []); }
  try { proc = spawn(cmd, args, { windowsHide: true }); } catch (e) { err = 'No se pudo ejecutar ' + path.basename(cmd) + ': ' + e.message; proc = null; return status(); }
  const me = proc; let se = '', npk = 0;
  const addPkt = (b, ts, orig) => { const d = decode(b); npk++; push({ t: ts || Date.now(), src: d.src, dst: d.dst, proto: d.proto, info: d.info, layers: d.layers, bytes: b, len: orig || b.length }); };
  if (mode === 'pcap') me.stdout.on('data', pcapStream(addPkt, m => { err = m; }));
  else {
    const rl = readline.createInterface({ input: me.stdout });
    if (mode === 'ek') rl.on('line', l => { l = l.trim(); if (l[0] !== '{' || l.startsWith('{"index"')) return; try { const p = fromEK(JSON.parse(l)); if (p) { p.t = Date.now(); npk++; push(p); } } catch (_) {} });
    else { let cur = null; const fin = () => { if (!cur) return; const b = Buffer.from(cur.hex.join(''), 'hex'); cur.ts && addPkt(b, cur.ts); cur = null; };
      rl.on('line', l => { const h = l.match(/^(\d+\.\d+)\s+(.*)$/); if (h) { fin(); cur = { ts: Math.round(+h[1] * 1000), hex: [] }; return; } const x = l.match(/^\s+0x[0-9a-f]+:\s+((?:[0-9a-f]{2,4}\s?)+)/i); if (x && cur) cur.hex.push(x[1].replace(/\s/g, '')); }); rl.on('close', fin); }
  }
  me.stderr.on('data', d => {
    se += d.toString('utf8'); if (se.length > 2000) se = se.slice(-2000);
    const e = realErr(se);
    if (/permission|denied|privilegios|administrator|Access is denied|not permitted|failed to open|No tiene permiso/i.test(e)) err = 'Sin permisos de captura. Ejecutá IPHub como administrador (clic derecho > Ejecutar como administrador) o reinstalá Npcap permitiendo capturar a todos los usuarios.';
    else if (/no such device|doesn.t exist|no existe|There is no interface|not found|No interface/i.test(e)) err = 'Interfaz no encontrada. Elegí otra de la lista.';
    else if (/filter|syntax error/i.test(e)) err = 'Filtro de captura inválido: ' + e;
  });
  me.on('error', e => { err = 'No se pudo ejecutar ' + path.basename(cmd) + ': ' + e.message; if (proc === me) proc = null; });
  me.on('close', code => {
    if (proc === me) proc = null;
    if (!stopping && !err) { const e = realErr(se); if (code && code !== 0) err = e ? 'La captura se detuvo: ' + e : 'La captura se detuvo (código ' + code + '). Probá ejecutar IPHub como administrador y verificá que Npcap esté instalado.'; else if (!npk && Date.now() - startedAt < 4000) err = e || 'La captura terminó sin capturar paquetes. Probá otra interfaz o ejecutá IPHub como administrador.'; }
  });
  return status();
}
function stop() { stopping = true; if (proc) { try { proc.kill(); } catch (_) {} proc = null; } return status(); }
function status() { return { running: !!proc, tool, last: seq, error: err, total: buf.length, bytes: stats.bytes, proto: stats.proto, since: t0 }; }
function list(since) { const s = +since || 0; return Object.assign(status(), { items: buf.filter(p => p.id > s).slice(0, 500).map(p => ({ id: p.id, t: p.t, src: p.src, dst: p.dst, proto: p.proto, len: p.len, info: p.info })) }); }
function packet(id) { const p = buf.find(x => x.id === +id); return p ? { id: p.id, t: p.t, len: p.len, proto: p.proto, layers: p.layers, hex: p.bytes.toString('hex') } : { error: 'Paquete no disponible' }; }
function clear() { buf = []; stats = { bytes: 0, proto: {} }; return status(); }
module.exports = { ifaces, start, stop, list, packet, clear, status, decode };
