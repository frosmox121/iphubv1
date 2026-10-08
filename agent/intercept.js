'use strict';
// Proxy local multiprotocolo: HTTP, HTTPS (CONNECT con SNI/TLS/ALPN), WebSocket y SOCKS5 (cualquier TCP: SSH, FTP, SMTP, IMAP, MQTT, RDP, bases de datos...).
// Los túneles cifrados no se descifran: se registra host, puerto, protocolo detectado, versión TLS, ALPN y bytes.
const http = require('http'), net = require('net');
const priv = a => /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(a || '').replace('::ffff:', '')) || /^fe80:/i.test(a || '');
let srv = null, httpSrv = null, seq = 0, buf = [], port = 8899;
const push = e => { e.id = ++seq; e.t = Date.now(); buf.push(e); if (buf.length > 800) buf.splice(0, buf.length - 800); return e; };
const mask = h => { const r = {}; for (const k of Object.keys(h || {})) r[k] = /^(authorization|cookie|proxy-authorization)$/i.test(k) ? String(h[k]).slice(0, 14) + '...(oculto)' : h[k]; return r; };
const PORTS = { 20: 'FTP-DATA', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 123: 'NTP', 143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 587: 'SMTP', 636: 'LDAPS', 853: 'DoT', 993: 'IMAPS', 995: 'POP3S', 1433: 'MSSQL', 1883: 'MQTT', 3306: 'MySQL', 3389: 'RDP', 5060: 'SIP', 5222: 'XMPP', 5432: 'PostgreSQL', 5672: 'AMQP', 5900: 'VNC', 6379: 'Redis', 8080: 'HTTP-ALT', 8443: 'HTTPS-ALT', 8883: 'MQTTS', 9092: 'Kafka', 25565: 'Minecraft', 27017: 'MongoDB' };
const TLSV = { 0x0300: 'SSL 3.0', 0x0301: 'TLS 1.0', 0x0302: 'TLS 1.1', 0x0303: 'TLS 1.2', 0x0304: 'TLS 1.3' };
// Analiza los primeros bytes del cliente: TLS ClientHello (SNI, versión, ALPN), SSH, HTTP, etc.
function sniff(b, p) {
  const out = { proto: PORTS[p] || 'TCP' };
  if (!b || !b.length) return out;
  try {
    if (b[0] === 0x16 && b[1] === 0x03 && b.length > 43) { // TLS handshake
      out.proto = p === 443 || !PORTS[p] ? 'HTTPS/TLS' : (PORTS[p] + '/TLS'); out.tls = TLSV[b.readUInt16BE(9)] || ('TLS 0x' + b.readUInt16BE(9).toString(16));
      let o = 43; o += 1 + b[o]; o += 2 + b.readUInt16BE(o); o += 1 + b[o]; // session, cipher suites, compression
      const end = Math.min(b.length, o + 2 + b.readUInt16BE(o)); o += 2; const alpn = [];
      while (o + 4 <= end) {
        const type = b.readUInt16BE(o), len = b.readUInt16BE(o + 2), d = o + 4;
        if (type === 0 && len > 5) out.sni = b.toString('utf8', d + 5, d + 2 + len);
        if (type === 16) { let q = d + 2; while (q < d + len) { const l = b[q]; alpn.push(b.toString('ascii', q + 1, q + 1 + l)); q += 1 + l; } }
        if (type === 43 && len > 3) { const vs = []; for (let q = d + 1; q + 1 < d + len; q += 2) vs.push(b.readUInt16BE(q)); if (vs.includes(0x0304)) out.tls = 'TLS 1.3'; }
        o = d + len;
      }
      if (alpn.length) { out.alpn = alpn.join(','); if (alpn.includes('h2')) out.proto = 'HTTP/2 (TLS)'; else if (alpn.includes('h3')) out.proto = 'HTTP/3'; }
    } else if (b.toString('ascii', 0, 4) === 'SSH-') { out.proto = 'SSH'; out.banner = b.toString('ascii', 0, Math.min(b.length, 60)).split('\r')[0].split('\n')[0]; }
    else if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT) /.test(b.toString('ascii', 0, 8))) { out.proto = 'HTTP'; const m = b.toString('latin1', 0, 400).match(/\r\nHost: ([^\r\n]+)/i); if (m) out.sni = m[1]; const ua = b.toString('latin1', 0, 600).match(/\r\nUser-Agent: ([^\r\n]+)/i); if (ua) out.ua = ua[1].slice(0, 80); }
    else if (/^(EHLO|HELO|MAIL FROM|220 )/i.test(b.toString('ascii', 0, 12))) out.proto = 'SMTP';
    else if (/^(USER|PASS|AUTH|CAPABILITY|a\d+ )/i.test(b.toString('ascii', 0, 12))) out.proto = PORTS[p] || 'Mail/FTP';
    else if (b.toString('ascii', 0, 4) === 'RFB ') out.proto = 'VNC';
    else if (b[0] === 0x10 && b.toString('ascii', 2, 8) === '\u0000\u0004MQTT') out.proto = 'MQTT';
    else if (b[0] === 0x03 && b[1] === 0x00) out.proto = 'RDP';
    else if (b.toString('ascii', 0, 4) === '\u00ffSMB' || b.toString('ascii', 4, 8) === '\u00ffSMB' || b.toString('ascii', 4, 8) === '\u00feSMB') out.proto = 'SMB';
  } catch (_) {}
  return out;
}
// Túnel TCP con medición de bytes y análisis del primer paquete
function tunnel(cs, us, e, p, head) {
  let up = 0, down = 0, first = true; const t0 = Date.now();
  const sync = () => { e.up = up; e.down = down; e.ms = Date.now() - t0; };
  const analyze = c => { if (!first) return; first = false; Object.assign(e, sniff(c, p)); if (e.sni && !/^\d+\.\d+\.\d+\.\d+$/.test(e.host)) e.url = /:\d+$/.test(e.sni) ? e.sni : e.sni + ':' + p; };
  const onUp = c => { up += c.length; analyze(c); sync(); };
  cs.on('data', onUp); us.on('data', c => { down += c.length; sync(); });
  if (head && head.length) { onUp(head); us.write(head); }
  cs.pipe(us); us.pipe(cs);
  const end = () => { sync(); try { cs.destroy(); } catch (_) {} try { us.destroy(); } catch (_) {} };
  cs.on('close', end); us.on('close', end);
}
function socks5(cs) {
  const src = String(cs.remoteAddress || '').replace('::ffff:', '');
  if (!priv(src)) return cs.destroy();
  cs.once('data', () => { // negociación: sin autenticación
    cs.write(Buffer.from([5, 0]));
    cs.once('data', r => {
      try {
        if (r[1] !== 1) { cs.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0])); push({ src, proto: 'SOCKS5', method: 'SOCKS', host: '-', url: 'comando ' + r[1] + ' no soportado (solo CONNECT)', status: 0 }); return; }
        let host, o;
        if (r[3] === 1) { host = [...r.slice(4, 8)].join('.'); o = 8; }
        else if (r[3] === 3) { host = r.toString('utf8', 5, 5 + r[4]); o = 5 + r[4]; }
        else { host = Array.from({ length: 8 }, (_, i) => r.readUInt16BE(4 + i * 2).toString(16)).join(':'); o = 20; }
        const p = r.readUInt16BE(o);
        const e = push({ src, proto: PORTS[p] || 'TCP', via: 'SOCKS5', method: 'SOCKS5', host: host + ':' + p, url: host + ':' + p, port: p, https: p === 443, status: 0, up: 0, down: 0 });
        const us = net.connect(p, host, () => { e.status = 200; e.dstIp = us.remoteAddress; cs.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); tunnel(cs, us, e, p); });
        us.on('error', err => { e.status = 502; e.error = err.message; try { cs.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); } catch (_) {} });
        cs.on('error', () => us.destroy());
      } catch (_) { cs.destroy(); }
    });
  });
}
function start(p) {
  if (srv) return status();
  port = +p || 8899;
  httpSrv = http.createServer((req, res) => {
    const src = String(req.socket.remoteAddress || '').replace('::ffff:', '');
    if (!priv(src)) { res.writeHead(403); return res.end('Solo red local'); }
    let u; try { u = new URL(req.url); } catch (_) { res.writeHead(400); return res.end('Usá IPHub como proxy HTTP'); }
    const chunks = []; req.on('data', c => { if (chunks.reduce((a, b) => a + b.length, 0) < 4096) chunks.push(c); });
    const H = req.headers;
    const e = { src, proto: 'HTTP', method: req.method, host: u.host, url: u.href.slice(0, 500), port: +u.port || 80, reqHeaders: mask(H), https: false, ua: String(H['user-agent'] || '').slice(0, 80), referer: H.referer || '', up: +H['content-length'] || 0 };
    const t0 = Date.now();
    const up = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers: H, timeout: 20000 }, r => {
      e.status = r.statusCode; e.resHeaders = mask(r.headers); e.ms = Date.now() - t0; e.resBytes = +r.headers['content-length'] || 0; e.down = e.resBytes; e.ct = String(r.headers['content-type'] || '').split(';')[0]; e.dstIp = up.socket && up.socket.remoteAddress;
      if (/event-stream/.test(e.ct)) e.proto = 'SSE';
      e.reqBody = Buffer.concat(chunks).toString('utf8').slice(0, 4096) || null; push(e);
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    up.on('error', err => { e.status = 502; e.error = err.message; push(e); try { res.writeHead(502); res.end('Error de proxy'); } catch (_) {} });
    req.pipe(up);
  });
  // WebSocket (y cualquier Upgrade) a través del proxy
  httpSrv.on('upgrade', (req, cs, head) => {
    const src = String(cs.remoteAddress || '').replace('::ffff:', ''); if (!priv(src)) return cs.destroy();
    let u; try { u = new URL(/^https?:|^wss?:/i.test(req.url) ? req.url.replace(/^ws/i, 'http') : 'http://' + req.headers.host + req.url); } catch (_) { return cs.destroy(); }
    const p = +u.port || 80, e = push({ src, proto: 'WebSocket', method: 'UPGRADE', host: u.host, url: u.href.slice(0, 500), port: p, reqHeaders: mask(req.headers), ua: String(req.headers['user-agent'] || '').slice(0, 80), status: 101, up: 0, down: 0 });
    const us = net.connect(p, u.hostname, () => { us.write(req.method + ' ' + u.pathname + u.search + ' HTTP/1.1\r\n' + Object.entries(req.headers).map(([k, v]) => k + ': ' + v).join('\r\n') + '\r\n\r\n'); e.dstIp = us.remoteAddress; tunnel(cs, us, e, p, head); });
    us.on('error', err => { e.status = 502; e.error = err.message; cs.destroy(); }); cs.on('error', () => us.destroy());
  });
  // HTTPS y cualquier protocolo por CONNECT
  httpSrv.on('connect', (req, cs, head) => {
    const src = String(cs.remoteAddress || '').replace('::ffff:', '');
    if (!priv(src)) return cs.destroy();
    const i = req.url.lastIndexOf(':'), h = i > 0 ? req.url.slice(0, i) : req.url, pt = +(i > 0 ? req.url.slice(i + 1) : 443) || 443;
    const e = push({ src, proto: PORTS[pt] || 'TCP', via: 'CONNECT', method: 'CONNECT', host: req.url, url: req.url, port: pt, https: pt === 443, status: 0, up: 0, down: 0, ua: String(req.headers['user-agent'] || '').slice(0, 80) });
    const us = net.connect(pt, h, () => { e.status = 200; e.dstIp = us.remoteAddress; cs.write('HTTP/1.1 200 Connection Established\r\n\r\n'); tunnel(cs, us, e, pt, head); });
    us.on('error', err => { e.status = 502; e.error = err.message; cs.destroy(); }); cs.on('error', () => us.destroy());
  });
  httpSrv.on('clientError', (_e, s) => { try { s.destroy(); } catch (_) {} });
  // Un solo puerto para HTTP/HTTPS-proxy y SOCKS5: se decide por el primer byte
  srv = net.createServer(sock => {
    sock.once('data', chunk => { sock.pause(); sock.unshift(chunk); if (chunk[0] === 5) { socks5(sock); sock.resume(); } else { httpSrv.emit('connection', sock); sock.resume(); } });
    sock.on('error', () => {});
  });
  srv.on('error', e => { push({ src: '-', proto: 'ERROR', method: 'ERROR', host: '-', url: e.message, status: 0 }); srv = null; });
  srv.listen(port, '0.0.0.0');
  return status();
}
function stop() { if (srv) { try { srv.close(); } catch (_) {} srv = null; } if (httpSrv) { try { httpSrv.close(); } catch (_) {} httpSrv = null; } return status(); }
function status() { return { running: !!srv, port, last: seq }; }
function list(since) { return { ...status(), items: buf.filter(e => e.id > (+since || 0)).slice(-300) }; }
function clear() { buf = []; return status(); }
module.exports = { start, stop, status, list, clear };
