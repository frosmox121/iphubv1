'use strict';
// Proxy HTTP local para inspeccionar peticiones de equipos de la misma red (HTTPS: solo host:puerto, va cifrado).
const http = require('http'), net = require('net');
const priv = a => /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(a || '').replace('::ffff:', '')) || /^fe80:/i.test(a || '');
let srv = null, seq = 0, buf = [], port = 8899;
const push = e => { e.id = ++seq; e.t = Date.now(); buf.push(e); if (buf.length > 800) buf.splice(0, buf.length - 800); };
const mask = h => { const r = {}; for (const k of Object.keys(h || {})) r[k] = /^(authorization|cookie|proxy-authorization)$/i.test(k) ? String(h[k]).slice(0, 14) + '…(oculto)' : h[k]; return r; };
function start(p) {
  if (srv) return status();
  port = +p || 8899;
  srv = http.createServer((req, res) => {
    const src = String(req.socket.remoteAddress || '').replace('::ffff:', '');
    if (!priv(src)) { res.writeHead(403); return res.end('Solo red local'); }
    let u; try { u = new URL(req.url); } catch (_) { res.writeHead(400); return res.end('Usá IPHub como proxy HTTP'); }
    const chunks = []; req.on('data', c => { if (chunks.reduce((a, b) => a + b.length, 0) < 2048) chunks.push(c); });
    const e = { src, method: req.method, host: u.host, url: u.href.slice(0, 500), reqHeaders: mask(req.headers), https: false };
    const t0 = Date.now();
    const up = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers: req.headers, timeout: 20000 }, r => {
      e.status = r.statusCode; e.resHeaders = mask(r.headers); e.ms = Date.now() - t0; e.resBytes = +r.headers['content-length'] || 0; e.ct = String(r.headers['content-type'] || '').split(';')[0];
      e.reqBody = Buffer.concat(chunks).toString('utf8').slice(0, 2048) || null; push(e);
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    up.on('error', err => { e.status = 502; e.error = err.message; push(e); try { res.writeHead(502); res.end('Error de proxy'); } catch (_) {} });
    req.pipe(up);
  });
  srv.on('connect', (req, cs, head) => {
    const src = String(cs.remoteAddress || '').replace('::ffff:', '');
    if (!priv(src)) return cs.destroy();
    const [h, pt] = req.url.split(':'); const t0 = Date.now();
    const us = net.connect(+pt || 443, h, () => { cs.write('HTTP/1.1 200 Connection Established\r\n\r\n'); us.write(head); us.pipe(cs); cs.pipe(us); push({ src, method: 'CONNECT', host: req.url, url: req.url, https: true, status: 200, ms: Date.now() - t0, reqHeaders: mask(req.headers), note: 'Túnel HTTPS cifrado: solo se ve el destino' }); });
    us.on('error', () => cs.destroy()); cs.on('error', () => us.destroy());
  });
  srv.on('error', e => { push({ src: '-', method: 'ERROR', host: '-', url: e.message, status: 0 }); srv = null; });
  srv.listen(port, '0.0.0.0');
  return status();
}
function stop() { if (srv) { try { srv.close(); } catch (_) {} srv = null; } return status(); }
function status() { return { running: !!srv, port, last: seq }; }
function list(since) { return { ...status(), items: buf.filter(e => e.id > (+since || 0)).slice(-300) }; }
function clear() { buf = []; return status(); }
module.exports = { start, stop, status, list, clear };
