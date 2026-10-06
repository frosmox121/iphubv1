'use strict';
// IPHub Monitor — núcleo de escaneo. Sin login, sin servidor, sin dependencias.
// Velocidad: en vez de lanzar 254 "ping", se hace una ráfaga UDP (NetBIOS) que obliga al SO a resolver ARP,
// se lee la tabla ARP (encuentra hasta los equipos que bloquean ping) y se enriquece cada equipo en paralelo.
const { execFile } = require('child_process');
const os = require('os'), fs = require('fs'), path = require('path'), net = require('net'), dgram = require('dgram'), dns = require('dns'), tls = require('tls');
const { EventEmitter } = require('events');
const U = require('./dnsutil'), OUI = require('./oui');

const bus = new EventEmitter();
const DATA = path.join(os.homedir(), '.iphub-agent.json');
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, fb = null) => Promise.race([p, new Promise(r => setTimeout(() => r(fb), ms))]);
async function pool(items, limit, fn) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (_) { out[k] = null; } }
  }));
  return out;
}
function run(cmd, args, ms = 5000) {
  return new Promise(res => {
    try { execFile(cmd, args, { timeout: ms, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_e, so) => res(String(so || ''))); } catch (_) { res(''); }
  });
}
const toInt = ip => String(ip).split('.').reduce((a, b) => a * 256 + (+b), 0);
const toIp = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const normMac = m => String(m || '').toLowerCase().split(/[:-]/).map(x => x.padStart(2, '0')).join(':');

// ---------- Estado persistente ----------
function load() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (_) { /* primer uso */ }
  if (!s.devices) s = { v: 2, devices: {}, legacy: { trusted: s.trusted || {}, ignored: s.ignored || {}, notes: s.notes || {} }, settings: {}, vendors: {}, baselineAt: null, lastScan: null };
  s.settings = s.settings || {}; s.vendors = s.vendors || {}; s.legacy = s.legacy || { trusted: {}, ignored: {}, notes: {} };
  s.byNet = s.byNet || {};
  // Lo guardado pertenece a la red anterior. No se muestra hasta confirmar la red actual.
  if (Object.keys(s.devices).length) {
    const prev = (s.net && (s.net.id || [s.net.ssid || 'lan', s.net.gwMac || s.net.gw || 'nogw', s.net.cidr || ''].join('|'))) || 'legacy';
    s.byNet[prev] = s.devices;
  }
  s.devices = {};
  s.activeNet = '';
  s.net = null;
  return s;
}
const S = load();
S.traces = S.traces || [];
function pushTrace(t) { S.traces = [{ at: new Date().toISOString(), ...t }, ...S.traces].slice(0, 80); }
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(flush, 400); };
function flush() { clearTimeout(saveT); try { fs.writeFileSync(DATA, JSON.stringify(S)); } catch (_) { /* disco de solo lectura: se sigue en memoria */ } }

// ---------- Red local ----------
async function defaultRoute() {
  try {
    if (WIN) {
      const o = await run('route', ['print', '-4', '0.0.0.0']);
      const rows = [...o.matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)/gm)].map(m => ({ gw: m[1], ifIp: m[2], metric: +m[3] })).sort((a, b) => a.metric - b.metric);
      return rows[0] || {};
    }
    if (MAC) { const o = await run('route', ['-n', 'get', 'default']); return { gw: (/gateway:\s*(\S+)/.exec(o) || [])[1], ifName: (/interface:\s*(\S+)/.exec(o) || [])[1] }; }
    const o = await run('ip', ['route', 'show', 'default']); let m = /default via (\S+)(?: dev (\S+))?/.exec(o);
    if (m) return { gw: m[1], ifName: m[2] };
    const o2 = await run('route', ['-n']); m = /^0\.0\.0\.0\s+(\S+)\s+0\.0\.0\.0\s+\S+\s+\d+\s+\d+\s+\d+\s+(\S+)/m.exec(o2);
    return m ? { gw: m[1], ifName: m[2] } : {};
  } catch (_) { return {}; }
}
async function netInfo() {
  const dr = await defaultRoute(), cands = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) cands.push({ name, address: i.address, netmask: i.netmask, mac: i.mac });
  const inSub = (c, ip) => { const m = toInt(c.netmask); return ((toInt(c.address) & m) >>> 0) === ((toInt(ip) & m) >>> 0); };
  const c = cands.find(x => dr.ifIp && x.address === dr.ifIp) || cands.find(x => dr.ifName && x.name === dr.ifName) || cands.find(x => dr.gw && inSub(x, dr.gw))
    || cands.find(x => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address)) || cands[0];
  if (!c) return null;
  let prefix = 0; const mi = toInt(c.netmask); for (let b = 31; b >= 0; b--) { if ((mi >>> b) & 1) prefix++; else break; }
  const realPrefix = prefix;
  if (prefix < 22 || prefix > 30) prefix = 24; // subred escolar enorme: se barre el /24 propio y el del router
  const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const netw = (toInt(c.address) & mask) >>> 0, bc = (netw | (~mask >>> 0)) >>> 0;
  const hosts = []; for (let n = netw + 1; n < bc; n++) hosts.push(toIp(n));
  const gw = dr.gw && dr.gw !== '0.0.0.0' ? dr.gw : '';
  if (gw) {
    const gnet = (toInt(gw) & mask) >>> 0;
    if (gnet !== netw) for (let n = gnet + 1; n < gnet + 255; n++) hosts.push(toIp(n));
  }
  return { me: c.address, mac: normMac(c.mac), iface: c.name, prefix, realPrefix, mask, maskStr: toIp(mask), net: netw, bc, cidr: `${toIp(netw)}/${prefix}`, hosts, gw };
}
const isPriv = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

const inNet = (info, ip) => { const n = toInt(ip); return n > info.net && n < info.bc && ((n & info.mask) >>> 0) === info.net; };
async function arpTable(info) {
  const o = await run('arp', ['-a'], 6000), map = new Map();
  for (const line of o.split(/\r?\n/)) {
    const ipm = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/.exec(line); if (!ipm) continue;
    const macm = /\b([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\b/i.exec(line.slice(ipm.index + ipm[0].length)); if (!macm) continue;
    const mac = normMac(macm[1]); if (mac === 'ff:ff:ff:ff:ff:ff' || mac === '00:00:00:00:00:00' || mac.startsWith('01:00:5e')) continue;
    if (inNet(info, ipm[1]) || isPriv(ipm[1]) || ipm[1] === info.gw) map.set(ipm[1], mac);
  }
  return map;
}

// ---------- Descubrimiento en paralelo: NetBIOS + mDNS + SSDP (≈1.6 s en total) ----------
const MDNS_SVCS = ['_services._dns-sd._udp', '_airplay._tcp', '_raop._tcp', '_googlecast._tcp', '_ipp._tcp', '_printer._tcp', '_http._tcp', '_smb._tcp', '_hap._tcp', '_spotify-connect._tcp', '_companion-link._tcp', '_workstation._tcp', '_device-info._tcp', '_ssh._tcp', '_afpovertcp._tcp'];
const SSDP = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n');
const mkSock = (info, onmsg) => withTimeout(new Promise(res => {
  const s = dgram.createSocket('udp4'); s.on('error', () => res(null)); s.on('message', onmsg);
  try { s.bind(0, info.me, () => res(s)); } catch (_) { res(null); }
}), 1000);
const closeSock = s => { try { if (s) s.close(); } catch (_) { /* ya cerrado */ } };
function mdnsAdd(map, ip, recs) {
  const e = map.get(ip) || { names: new Set(), services: new Set(), instances: new Set(), txt: {} };
  const clean = x => String(x).replace(/\.local\.?$/i, '');
  for (const r of recs) {
    if (r.type === 12) {
      if (/^_services\._dns-sd\._udp/i.test(r.name)) e.services.add(clean(r.data).replace(/\._(tcp|udp)$/, ''));
      else { e.services.add(clean(r.name).replace(/\._(tcp|udp)$/, '')); const inst = String(r.data).split('._')[0]; if (inst) e.instances.add(inst); }
    } else if (r.type === 33 && r.data) e.names.add(clean(r.data.target));
    else if (r.type === 1 && /\.local$/i.test(r.name)) e.names.add(clean(r.name));
    else if (r.type === 16 && r.data) Object.assign(e.txt, r.data);
  }
  map.set(ip, e);
}
async function discover(info) {
  const nb = new Map(), md = new Map(), ss = new Map();
  const [sNb, sMd, sSs] = await Promise.all([
    mkSock(info, (msg, ri) => { if (ri.port === 137) { const r = U.nbstatParse(msg); if (r) nb.set(ri.address, r); } }),
    mkSock(info, (msg, ri) => mdnsAdd(md, ri.address, U.parse(msg))),
    mkSock(info, (msg, ri) => {
      const t = msg.toString('utf8'), h = n => { const m = new RegExp('^' + n + ':\\s*(.+)$', 'im').exec(t); return m ? m[1].trim() : ''; };
      const e = ss.get(ri.address) || { server: '', locations: new Set(), st: new Set() };
      e.server = e.server || h('SERVER'); if (h('LOCATION')) e.locations.add(h('LOCATION')); if (h('ST')) e.st.add(h('ST')); ss.set(ri.address, e);
    }),
  ]);
  if (sNb) {
    const q = U.nbstatQuery();
    for (const ip of info.hosts) sNb.send(q, 137, ip, () => {});
    sNb.send(q, 137, '255.255.255.255', () => {});
    if (info.gw) sNb.send(q, 137, info.gw, () => {});
    try { sNb.setBroadcast(true); sNb.send(q, 137, toIp(info.bc), () => {}); } catch (_) {}
  }
  if (info.gw) { try { execFile('ping', WIN ? ['-n', '2', '-w', '400', info.gw] : ['-c', '2', '-W', '1', info.gw], { timeout: 2500, windowsHide: true }, () => {}); } catch (_) {} }
  const sendMd = () => { if (!sMd) return; try { sMd.setMulticastInterface(info.me); } catch (_) { /* sin multicast */ } sMd.send(U.buildQuery(MDNS_SVCS.map(n => ({ name: n + '.local', type: 12 })), false), 5353, '224.0.0.251', () => {}); };
  const sendSs = () => { if (!sSs) return; try { sSs.setMulticastInterface(info.me); } catch (_) { /* sin multicast */ } sSs.send(SSDP, 1900, '239.255.255.250', () => {}); };
  sendMd(); sendSs(); await sleep(650); sendMd(); sendSs(); await sleep(950);
  [sNb, sMd, sSs].forEach(closeSock);
  return { nb, md, ss };
}
async function mdnsReverse(info, ips) { // pregunta unicast "¿cómo te llamás?" a cada equipo (Apple, Linux/Avahi, impresoras...)
  const out = new Map(); if (!ips.length) return out;
  const s = await mkSock(info, (msg, ri) => { for (const r of U.parse(msg)) if (r.type === 12 && /in-addr\.arpa$/i.test(r.name)) out.set(ri.address, String(r.data).replace(/\.local\.?$/i, '')); });
  if (!s) return out;
  for (const ip of ips) s.send(U.buildQuery([{ name: ip.split('.').reverse().join('.') + '.in-addr.arpa', type: 12 }], true), 5353, ip, () => {});
  await sleep(800); closeSock(s); return out;
}

// ---------- Sondas por equipo ----------
function ping(ip) {
  return new Promise(res => {
    const args = WIN ? ['-n', '1', '-w', '900', ip] : MAC ? ['-c', '1', '-W', '900', ip] : ['-c', '1', '-W', '1', ip], t0 = Date.now();
    execFile('ping', args, { timeout: 3500, windowsHide: true }, (_e, so) => {
      so = String(so || ''); const ttl = /ttl[=:]\s*(\d+)/i.exec(so); if (!ttl) return res({ online: false });
      const m = /(?:time|tiempo|zeit|temps)\s*([=<])\s*([\d.,]+)/i.exec(so);
      let rtt = m ? parseFloat(m[2].replace(',', '.')) : Date.now() - t0; if (m && m[1] === '<') rtt = 0.5;
      const row = { online: true, rtt: Math.round(rtt * 10) / 10, ttl: +ttl[1] }; pushTrace({ proto: "ICMP", ip, info: "echo reply", ttl: row.ttl, oui: "" }); res(row);
    });
  });
}
function probe(ip, port, ms = 400) {
  return new Promise(res => {
    const t0 = Date.now(), s = new net.Socket(); let done = false;
    const fin = ok => { if (done) return; done = true; try { s.destroy(); } catch (_) { /* ok */ } res(ok ? Date.now() - t0 : -1); };
    s.setTimeout(ms); s.once('connect', () => fin(true)); s.once('timeout', () => fin(false)); s.once('error', () => fin(false));
    try { s.connect(port, ip); } catch (_) { fin(false); }
  });
}
const PORTS = { 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 81: 'HTTP-alt', 110: 'POP3', 111: 'RPC', 135: 'MS-RPC', 139: 'NetBIOS', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB', 515: 'LPD', 548: 'AFP', 554: 'RTSP', 631: 'IPP', 1433: 'MSSQL', 1723: 'PPTP', 1883: 'MQTT', 2049: 'NFS', 3306: 'MySQL', 3389: 'RDP', 3689: 'iTunes/DAAP', 5000: 'UPnP/Synology', 5001: 'Synology HTTPS', 5357: 'WSD', 5432: 'PostgreSQL', 5555: 'ADB', 5900: 'VNC', 6379: 'Redis', 7000: 'AirPlay', 8000: 'HTTP-alt', 8008: 'Chromecast', 8009: 'Cast', 8060: 'Roku', 8080: 'HTTP-proxy', 8081: 'HTTP-alt', 8443: 'HTTPS-alt', 8888: 'HTTP-alt', 9000: 'HTTP-alt', 9100: 'JetDirect', 27017: 'MongoDB', 32400: 'Plex', 49152: 'UPnP', 62078: 'iOS (lockdown)' };
const RISK_HI = new Set([21, 23, 3389, 5555, 5900, 6379, 27017]), RISK_MID = new Set([111, 135, 139, 445, 1433, 1723, 2049, 3306, 5432]);
const PORT_LIST = Object.keys(PORTS).map(Number);
async function scanPorts(ip) {
  const r = await Promise.all(PORT_LIST.map(async p => ({ p, ms: await probe(ip, p, 400) })));
  return r.filter(x => x.ms >= 0).map(x => ({ port: x.p, service: PORTS[x.p], risk: RISK_HI.has(x.p) ? 2 : RISK_MID.has(x.p) ? 1 : 0, ms: x.ms }));
}
function grab(ip, port, { tlsOn = false, send = null, ms = 1200 } = {}) {
  return new Promise(res => {
    let buf = Buffer.alloc(0), cert = null, done = false, s;
    const fin = () => { if (done) return; done = true; try { if (s) s.destroy(); } catch (_) { /* ok */ } res({ data: buf.toString('utf8'), cert }); };
    const onConn = () => {
      if (tlsOn) { try { const c = s.getPeerCertificate(); if (c && c.subject) cert = { cn: c.subject.CN || '', org: c.subject.O || '', issuer: (c.issuer && (c.issuer.O || c.issuer.CN)) || '', expires: c.valid_to || '' }; } catch (_) { /* sin cert */ } }
      if (send) s.write(send);
    };
    try { s = tlsOn ? tls.connect({ host: ip, port, rejectUnauthorized: false, timeout: ms }, onConn) : net.connect({ host: ip, port, timeout: ms }, onConn); } catch (_) { return fin(); }
    s.on('data', d => { buf = Buffer.concat([buf, d]); if (buf.length > 8000) fin(); });
    s.on('timeout', fin); s.on('error', fin); s.on('close', fin); setTimeout(fin, ms + 400);
  });
}
const httpReq = (ip, p = '/') => `GET ${p} HTTP/1.0\r\nHost: ${ip}\r\nUser-Agent: IPHub-Monitor\r\nConnection: close\r\n\r\n`;
function parseHttp(raw) {
  const i = raw.search(/\r?\n\r?\n/), head = i < 0 ? raw : raw.slice(0, i), body = i < 0 ? '' : raw.slice(i);
  const hdr = n => { const m = new RegExp('^' + n + ':\\s*(.+)$', 'im').exec(head); return m ? m[1].trim() : ''; };
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body), rl = /realm="?([^"\r\n]+)"?/i.exec(hdr('WWW-Authenticate'));
  return { status: (/^HTTP\/[\d.]+\s+(\d{3})/.exec(head) || [])[1] || '', server: hdr('Server'), title: t ? t[1].replace(/\s+/g, ' ').trim().slice(0, 120) : '', realm: rl ? rl[1].trim() : '', body };
}
const HTTP_PORTS = [80, 81, 631, 5000, 8000, 8008, 8060, 8080, 8081, 8888, 9000], TLS_PORTS = [443, 5001, 8443];
async function banners(rec) {
  const jobs = rec.ports.map(p => async () => {
    try {
      if (p.port === 22 || p.port === 21) { const r = await grab(rec.ip, p.port); p.info = r.data.split(/\r?\n/)[0].slice(0, 120); return; }
      if (HTTP_PORTS.includes(p.port) || TLS_PORTS.includes(p.port)) {
        const pth = p.port === 8008 ? '/setup/eureka_info?params=name,build_info' : p.port === 8060 ? '/query/device-info' : '/';
        const r = await grab(rec.ip, p.port, { tlsOn: TLS_PORTS.includes(p.port), send: httpReq(rec.ip, pth) });
        const h = parseHttp(r.data); p.info = [h.server, h.title, h.realm && ('realm: ' + h.realm)].filter(Boolean).join(' · '); if (r.cert) p.cert = r.cert;
        if (p.port === 8008) { try { const j = JSON.parse(h.body.trim()); if (j.name) rec.names.cast = j.name; } catch (_) { /* no JSON */ } }
        if (p.port === 8060) { const f = /<(?:user-device-name|friendly-device-name)>([^<]+)</.exec(h.body), m = /<model-name>([^<]+)</.exec(h.body); if (f) rec.names.cast = f[1]; if (m) rec.model = m[1]; }
      }
    } catch (_) { /* un banner que falla no frena el resto */ }
  });
  await pool(jobs, 4, j => j());
}
async function upnpInfo(rec, ss) {
  const loc = [...ss.locations].find(l => { try { return new URL(l).hostname === rec.ip; } catch (_) { return false; } }); if (!loc) return;
  try {
    const u = new URL(loc), r = await grab(rec.ip, +u.port || 80, { send: httpReq(rec.ip, u.pathname + u.search), ms: 1500 });
    const g = t => { const m = new RegExp('<' + t + '>([^<]*)</' + t + '>', 'i').exec(r.data); return m ? m[1].trim() : ''; };
    const x = { friendlyName: g('friendlyName'), manufacturer: g('manufacturer'), modelName: g('modelName'), modelNumber: g('modelNumber'), deviceType: g('deviceType'), server: ss.server };
    if (x.friendlyName || x.manufacturer || x.modelName) { rec.upnp = x; if (x.friendlyName) rec.names.upnp = x.friendlyName; if (x.modelName) rec.model = rec.model || (x.modelName + (x.modelNumber ? ' ' + x.modelNumber : '')); }
  } catch (_) { /* sin descripción UPnP */ }
}
async function reverseName(ip, gw) {
  const tryR = async srv => { const r = new dns.promises.Resolver({ timeout: 1200, tries: 1 }); if (srv) r.setServers([srv]); const a = await r.reverse(ip); return (a && a[0]) || ''; };
  let n = ''; if (gw) n = await withTimeout(tryR(gw).catch(() => ''), 1500, '');
  if (!n) n = await withTimeout(tryR(null).catch(() => ''), 1500, '');
  return n && !/^\d+[.-]\d+/.test(n) ? n.replace(/\.(lan|home|local|localdomain|fritz\.box)\.?$/i, '') : '';
}

// ---------- Clasificación ----------
function classify(r) {
  const ports = (r.ports || []).map(p => p.port), has = (...a) => a.some(p => ports.includes(p));
  const txt = [r.vendor, r.name, r.model, ...(r.services || []), r.upnp && r.upnp.deviceType, r.upnp && r.upnp.manufacturer, ...(r.ports || []).map(p => p.info)].filter(Boolean).join(' ').toLowerCase();
  if (r.isGateway || /internetgatewaydevice|wanconnectiondevice|router/.test(txt)) return 'router';
  if (/switch|cisco|aruba|ubiquiti|unifi|procurve|jetstream|tl-sg|gs108|managed switch|catalyst/.test(txt) || (has(22, 23, 161) && /cisco|hp|hpe|netgear|tplink|tp-link|zyxel|d-link/.test(txt))) return 'switch';
  if (r.me) return 'pc';
  if (has(62078) || /iphone|ipad/.test(txt)) return 'phone_ios';
  if (has(9100, 515) || /printer|laserjet|officejet|deskjet|_ipp|epson|canon|brother/.test(txt) || (has(631) && !has(3389, 445))) return 'printer';
  if (has(554) || /camera|hikvision|dahua|reolink|axis comm/.test(txt)) return 'camera';
  if ((has(8008, 8009, 8060, 7000) && !has(445, 3389)) || /chromecast|googlecast|roku|bravia|webos|tizen|smart ?tv|mediarenderer/.test(txt)) return 'tv';
  if (/playstation|nintendo|xbox/.test(txt)) return 'console';
  if (has(5000, 5001, 548, 2049) || /synology|qnap/.test(txt)) return 'nas';
  if (/sonos|alexa|homepod|speaker|spotify/.test(txt)) return 'speaker';
  if (/vmware|virtualbox|hyper-v|qemu/.test(txt)) return 'vm';
  if (has(3389, 135, 445) || /windows|desktop-|laptop-/.test(txt)) return 'pc';
  if (/macbook|imac|mac-?mini|macos/.test(txt) || (/apple/.test(txt) && has(22, 548, 5900, 7000))) return 'pc';
  if (/apple/.test(txt)) return 'phone_ios';
  if (has(1883) || /espressif|hue|signify|tuya|shelly|sonoff|nest/.test(txt)) return 'iot';
  if (has(22, 80, 443, 3306, 5432, 25, 53) || /raspberry/.test(txt)) return 'server';
  if (r.macPrivate && !(r.ports || []).length) return 'phone';
  return 'unknown';
}
function guessOs(r) {
  const ports = (r.ports || []).map(p => p.port), ssh = ((r.ports || []).find(p => p.port === 22) || {}).info || '', v = (r.vendor || '').toLowerCase();
  const d = /Ubuntu|Debian|Raspbian|FreeBSD|OpenWrt|dropbear/i.exec(ssh); if (d) return /dropbear/i.test(d[0]) ? 'Linux (embedded)' : d[0];
  if (ports.includes(62078)) return 'iOS / iPadOS';
  if (/apple/.test(v)) return 'Apple (iOS / macOS)';
  if ([135, 445, 3389].some(p => ports.includes(p)) && (!r.ttl || (r.ttl > 64 && r.ttl <= 128))) return 'Windows';
  if (!r.ttl) return '';
  return r.ttl <= 64 ? 'Linux / Android / iOS / macOS' : r.ttl <= 128 ? 'Windows' : '@net';
}
function finalize(r, ctx) {
  const n = r.names = r.names || {};
  r.me = r.ip === ctx.me; r.isGateway = r.ip === ctx.gw;
  if (r.me) { n.nb = n.nb || os.hostname(); r.ttl = r.ttl || (WIN ? 128 : 64); }
  r.name = n.nb || n.cast || n.upnp || n.mdns || n.dns || '';
  r.macPrivate = OUI.isPrivate(r.mac);
  r.vendor = r.macPrivate ? '' : (S.vendors[String(r.mac || '').slice(0, 8)] || OUI.lookup(r.mac) || (r.upnp && r.upnp.manufacturer) || '');
  r.type = classify(r); r.os = guessOs(r);
  let risk = 0; for (const p of r.ports || []) risk += p.risk === 2 ? 25 : p.risk === 1 ? 10 : 0;
  if (!r.trusted && !r.me && !r.isGateway) risk += 15;
  r.risk = Math.min(100, risk);
}

// ---------- Fabricante online (se cachea para siempre) ----------
const vq = []; let vrun = false, vfail = 0;
function queueVendor(mac) {
  const pre = String(mac || '').slice(0, 8);
  if (!pre || OUI.isPrivate(mac) || S.vendors[pre] != null || OUI.lookup(mac) || vq.some(x => x.pre === pre)) return;
  vq.push({ pre, mac }); if (!vrun) vendorLoop();
}
async function vendorLoop() {
  vrun = true;
  while (vq.length && vfail < 3) {
    const { pre, mac } = vq.shift();
    try {
      const r = await fetch('https://api.macvendors.com/' + encodeURIComponent(mac), { signal: AbortSignal.timeout(4000) });
      if (r.status === 200) { S.vendors[pre] = (await r.text()).trim().slice(0, 60); vfail = 0; }
      else if (r.status === 404) S.vendors[pre] = '';
      else if (r.status === 429) { vq.push({ pre, mac }); await sleep(6000); }
      else vfail++;
      if (S.vendors[pre]) for (const d of Object.values(S.devices)) if (String(d.mac || '').slice(0, 8) === pre) d.vendor = S.vendors[pre];
      save(); emit();
    } catch (_) { vfail++; }
    await sleep(1200);
  }
  vrun = false;
}

// ---------- Datos de la red (SSID, DNS, IP pública) ----------
let extras = { at: 0 };
async function netExtras(info) {
  if (Date.now() - extras.at < 5 * 60e3) return;
  extras.at = Date.now();
  const [wifi, dnsList, pub] = await Promise.all([
    (async () => {
      if (WIN) { const o = await run('netsh', ['wlan', 'show', 'interfaces']), g = re => (re.exec(o) || [])[1]; const ssid = g(/^\s*SSID\s*:\s*(.+)$/m); return ssid ? { ssid: ssid.trim(), signal: g(/(?:Signal|Se.al)\s*:\s*(\d+)\s*%/i), channel: g(/(?:Channel|Canal)\s*:\s*(\d+)/i), radio: (g(/(?:Radio type|Tipo de radio)\s*:\s*(.+)/i) || '').trim() } : null; }
      if (!MAC) { const o = await run('nmcli', ['-t', '-f', 'ACTIVE,SSID,SIGNAL,CHAN', 'dev', 'wifi']), l = o.split('\n').find(x => x.startsWith('yes:')); if (l) { const p = l.split(':'); return { ssid: p[1], signal: p[2], channel: p[3] }; } }
      return null;
    })(),
    (async () => {
      if (WIN) {
        const o = await run('ipconfig', ['/all'], 8000), blk = o.split(/\r?\n(?=\S)/).find(b => b.includes(info.me)) || '', out = []; let on = false;
        for (const l of blk.split(/\r?\n/)) { if (/DNS/i.test(l) && /:/.test(l)) { on = true; const m = /(\d+\.\d+\.\d+\.\d+)/.exec(l); if (m) out.push(m[1]); } else if (on && /^\s+(\d+\.\d+\.\d+\.\d+)\s*$/.test(l)) out.push(l.trim()); else on = false; }
        return out;
      }
      try { return [...fs.readFileSync('/etc/resolv.conf', 'utf8').matchAll(/^nameserver\s+(\S+)/gm)].map(m => m[1]); } catch (_) { return []; }
    })(),
    withTimeout((async () => { try { const r = await fetch('http://ip-api.com/json/?fields=status,country,regionName,city,isp,query', { signal: AbortSignal.timeout(4000) }); const j = await r.json(); return j.status === 'success' ? { ip: j.query, isp: j.isp, city: j.city, region: j.regionName, country: j.country } : null; } catch (_) { return null; } })(), 4500, null),
  ]);
  extras = { at: extras.at, wifi, dns: dnsList || [], pub }; emit();
}

// ---------- Escaneo ----------
let scanning = false, progress = { phase: '', pct: 0 }, curNet = null, emitT = null;
function emit() { if (emitT) return; emitT = setTimeout(() => { emitT = null; bus.emit('state', summary()); }, 120); }
const setProgress = (phase, pct) => { progress = { phase, pct }; emit(); };

function netKey(info, gwMac, ssid) {
  return [ssid || 'lan', gwMac || info.gw || 'nogw', info.cidr || info.me || ''].join('|');
}
async function currentNet() {
  const info = await netInfo();
  if (!info) return null;
  let gwMac = '';
  if (info.gw) { const arp = await arpTable(info); gwMac = arp.get(info.gw) || ''; }
  let ssid = '';
  if (WIN) { const o = await run('netsh', ['wlan', 'show', 'interfaces']); ssid = ((/^\s*SSID\s*:\s*(.+)$/m.exec(o) || [])[1] || '').trim(); }
  info.gwMac = gwMac; info.ssid = ssid; info.id = netKey(info, gwMac, ssid);
  return info;
}
function useNet(info) {
  if (!info) { S.neterr = true; S.activeNet = ''; S.devices = {}; S.net = null; return false; }
  if (S.activeNet && S.activeNet !== info.id) S.byNet[S.activeNet] = S.devices;
  if (S.activeNet !== info.id) {
    S.devices = S.byNet[info.id] || {};
    for (const d of Object.values(S.devices)) { d.online = false; d.rtt = null; }
    S.baselineAt = (S.baselines && S.baselines[info.id]) || null;
  }
  S.activeNet = info.id;
  S.byNet[info.id] = S.devices;
  S.neterr = false;
  S.net = { id: info.id, me: info.me, mac: info.mac, iface: info.iface, cidr: info.cidr, mask: info.maskStr, gw: info.gw, gwMac: info.gwMac || '', ssid: info.ssid || '' };
  return true;
}
function upsert(f, now) {
  const key = f.mac || ('ip:' + f.ip); let rec = S.devices[key], isNew = false;
  if (!rec && f.mac && S.devices['ip:' + f.ip]) { rec = S.devices['ip:' + f.ip]; delete S.devices['ip:' + f.ip]; }
  if (!rec) { isNew = true; rec = { names: {}, ports: [], firstSeen: now, trusted: !!S.legacy.trusted[f.ip], ignored: !!S.legacy.ignored[f.ip], note: S.legacy.notes[f.ip] || '' }; }
  S.devices[key] = rec; rec.key = key; rec.ip = f.ip; rec.mac = f.mac || rec.mac || ''; rec.lastSeen = now; rec.online = true; rec.names = rec.names || {}; rec.netId = S.activeNet;
  return { rec, isNew };
}

async function scan(opts = {}) {
  if (scanning) return summary();
  scanning = true; S.error = ''; setProgress('discover', 4);
  const t0 = Date.now();
  try {
    const info = await currentNet();
    if (!info) { curNet = null; S.neterr = true; S.activeNet = ''; S.devices = {}; S.net = null; return summary(); }
    useNet(info); curNet = info; netExtras(info);
    const { nb, md, ss } = await discover(info); setProgress('arp', 30);
    const arp = await arpTable(info), now = new Date().toISOString();
    const ips = new Set([...arp.keys(), info.me]);
    for (const m of [nb, ss, md]) for (const ip of m.keys()) if (inNet(info, ip) || isPriv(ip)) ips.add(ip);
    if (info.gw) ips.add(info.gw);
    for (const [ip] of arp) if (isPriv(ip) || ip === info.gw) ips.add(ip);
    const ctx = { me: info.me, gw: info.gw }, seen = new Set(), list = [];
    for (const ip of ips) {
      const mac = arp.get(ip) || (ip === info.me ? info.mac : '') || (nb.get(ip) || {}).mac || '';
      const { rec, isNew } = upsert({ ip, mac }, now); seen.add(rec.key);
      const n = nb.get(ip), m = md.get(ip);
      if (n && n.name) rec.names.nb = n.name;
      if (n && n.group) rec.workgroup = n.group;
      if (m) {
        const inst = [...m.instances][0], host = [...m.names].find(x => !/^[0-9a-f-]{20,}$/i.test(x)) || '';
        rec.names.mdns = host || rec.names.mdns || '';
        if (inst && !rec.names.cast && /googlecast|airplay|raop/.test([...m.services].join(' '))) rec.names.cast = m.txt.fn || inst;
        rec.services = [...m.services].slice(0, 20);
        if (m.txt.md || m.txt.model || m.txt.am) rec.model = m.txt.md || m.txt.model || m.txt.am;
      }
      finalize(rec, ctx); queueVendor(rec.mac); list.push({ rec, isNew });
    }
    for (const d of Object.values(S.devices)) if (!seen.has(d.key)) { d.online = false; d.rtt = null; }
    emit(); setProgress('ports', 40);
    const rev = await mdnsReverse(info, list.filter(x => !x.rec.names.mdns && !x.rec.me).map(x => x.rec.ip));
    for (const x of list) { const v = rev.get(x.rec.ip); if (v) x.rec.names.mdns = v; finalize(x.rec, ctx); }
    emit(); setProgress('ports', 50);
    let done = 0;
    await pool(list, 24, async ({ rec }) => {
      const full = opts.full || !rec.enrichedAt || Date.now() - rec.enrichedAt > 10 * 60e3 || rec.ipAtEnrich !== rec.ip;
      const pg = await ping(rec.ip); rec.ttl = pg.ttl || rec.ttl; rec.rtt = pg.online ? pg.rtt : null;
      if (full) {
        const [ports, rd] = await Promise.all([scanPorts(rec.ip), reverseName(rec.ip, info.gw)]);
        rec.ports = ports; if (rd) rec.names.dns = rd;
        if (!pg.online && ports.length) rec.rtt = Math.min(...ports.map(p => p.ms));
        await Promise.all([banners(rec), ss.get(rec.ip) ? upnpInfo(rec, ss.get(rec.ip)) : null]);
        rec.enrichedAt = Date.now(); rec.ipAtEnrich = rec.ip;
      }
      finalize(rec, ctx); done++; setProgress('details', 50 + Math.round(45 * done / list.length));
    });
    S.lastScan = new Date().toISOString(); S.scanMs = Date.now() - t0;
    S.net = { id: info.id, me: info.me, mac: info.mac, iface: info.iface, cidr: info.cidr, mask: info.maskStr, gw: info.gw, gwMac: info.gwMac || '', ssid: info.ssid || '' };
    S.baselines = S.baselines || {};
    const first = !S.baselines[info.id]; if (first) S.baselines[info.id] = S.lastScan;
    S.baselineAt = S.baselines[info.id];
    if (!first) for (const { rec, isNew } of list) if (isNew && !rec.trusted) bus.emit('newdevice', rec);
    save();
  } catch (e) { S.error = e.message; } finally { scanning = false; progress = { phase: 'done', pct: 100 }; emit(); }
  return summary();
}

// ---------- Resumen para la interfaz ----------
const ipKey = ip => toInt(ip || '0.0.0.0');
function summary() {
  const all = S.activeNet ? Object.values(S.devices).filter(d => d.netId === S.activeNet) : [];
  const onl = all.filter(d => d.online && !d.ignored && !d.deleted);
  const unknown = onl.filter(d => !d.trusted && !d.me && !d.isGateway).length;
  const risky = onl.filter(d => (d.risk || 0) >= 60).length, riskPorts = onl.reduce((n, d) => n + (d.ports || []).filter(p => p.risk).length, 0);
  const rs = onl.map(d => d.rtt).filter(x => x != null), avg = rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length * 10) / 10 : null;
  const score = Math.max(1, Math.min(100, 100 - Math.min(40, unknown * 8) - Math.min(40, riskPorts * 6)));
  const baseline = S.baselineAt ? Date.parse(S.baselineAt) : 0, nowT = Date.now();
  const devices = all.map(d => ({ ...d, isNew: !!baseline && !d.trusted && Date.parse(d.firstSeen) > baseline + 1000 && nowT - Date.parse(d.firstSeen) < 864e5 }))
    .sort((a, b) => ((b.online ? 1 : 0) - (a.online ? 1 : 0)) || (ipKey(a.ip) - ipKey(b.ip)));
  return { scanning, progress, neterr: !!S.neterr, error: S.error || '', net: { ...(S.net || {}), extras: extras.at ? { wifi: extras.wifi, dns: extras.dns, pub: extras.pub } : null }, scannedAt: S.lastScan, scanMs: S.scanMs || 0,
    online: onl.length, offline: all.filter(d => !d.online && !d.ignored && !d.deleted).length, unknown, risky, riskPorts, avg, score, level: score >= 80 ? 'good' : score >= 50 ? 'mid' : 'bad', settings: S.settings, devices, traces: (S.traces || []).slice(0, 40) };
}

// ---------- Acciones ----------
const act = fn => key => { const d = S.devices[key]; if (d) fn(d); save(); emit(); return summary(); };
const trust = act(d => { d.trusted = true; d.ignored = false; d.deleted = false; });
const untrust = act(d => { d.trusted = false; });
const ignore = act(d => { d.ignored = true; });
const unignore = act(d => { d.ignored = false; });
// Eliminar = mover a "Eliminados" (se conserva el registro: no vuelve a aparecer como dispositivo nuevo y se puede restaurar)
const remove = act(d => { d.deleted = true; d.ignored = false; d.trusted = false; });
const restore = act(d => { d.deleted = false; });
function note(key, text) { const d = S.devices[key]; if (d) d.note = String(text || '').slice(0, 300); save(); emit(); return summary(); }
function trustAll() { for (const d of Object.values(S.devices)) if (d.online) d.trusted = true; save(); emit(); return summary(); }
function setSetting(k, v) { S.settings[k] = v; save(); return summary(); }
function wake(key) {
  const d = S.devices[key]; if (!d || !d.mac) return { error: 'nomac' };
  const mac = Buffer.from(d.mac.replace(/:/g, ''), 'hex'), pkt = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(mac)]);
  const bc = curNet ? toIp(curNet.bc) : '255.255.255.255', s = dgram.createSocket('udp4');
  s.on('error', () => {}); s.bind(0, () => { try { s.setBroadcast(true); s.send(pkt, 9, bc, () => closeSock(s)); } catch (_) { closeSock(s); } });
  return { ok: true };
}

async function watchNet() {
  try {
    const info = await currentNet();
    if (!info) { if (S.activeNet) { S.activeNet = ''; S.devices = {}; S.net = null; S.neterr = true; emit(); } return false; }
    if (info.id !== S.activeNet) { useNet(info); emit(); return true; }
  } catch (_) {}
  return false;
}
currentNet().then(info => { if (info) useNet(info); emit(); }).catch(() => {});
module.exports = { bus, scan, summary, watchNet, trust, untrust, ignore, unignore, remove, restore, note, trustAll, setSetting, wake, flush, _t: { classify, guessOs, parseHttp, arpTable, netInfo } };

