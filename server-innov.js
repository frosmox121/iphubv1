/* Herramientas INNOVADORAS (backend): multiping TCP con jitter/pérdida y chequeo HTTP con tiempos y cabeceras de seguridad. */
const net = require('net'), https = require('https'), http = require('http'), dns = require('dns').promises;
module.exports = function (app, ctx) {
  const { requireAuth, addAudit, isValidTarget } = ctx;
  const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;
  const blocked = h => /^(localhost|metadata\.google\.internal)$/i.test(h) || /^(127\.|0\.|169\.254\.)/.test(h);
  const okHost = h => typeof h === 'string' && !blocked(h) && (HOST_RE.test(h) || /^[0-9a-f:]+$/i.test(h)) && (!isValidTarget || isValidTarget(h));
  const tcp = (host, port, ms = 2500) => new Promise(res => {
    const t0 = process.hrtime.bigint(); const s = net.connect({ host, port });
    const done = v => { s.destroy(); res(v); };
    s.setTimeout(ms, () => done(null)); s.on('error', () => done(null));
    s.on('connect', () => done(Number(process.hrtime.bigint() - t0) / 1e6));
  });
  app.post('/api/tools/innov/multiping', requireAuth, async (req, res) => {
    const b = req.body || {}; const count = Math.min(10, Math.max(3, +b.count || 5)); const port = Math.min(65535, Math.max(1, +b.port || 443));
    const targets = [...new Set((Array.isArray(b.targets) ? b.targets : []).map(x => String(x).trim()).filter(Boolean))].slice(0, 6);
    if (!targets.length || !targets.every(okHost)) return res.status(400).json({ error: 'Destinos inválidos (máx. 6, solo hosts o IPs públicas)' });
    const out = await Promise.all(targets.map(async host => {
      const r = []; for (let i = 0; i < count; i++) { r.push(await tcp(host, port)); await new Promise(x => setTimeout(x, 80)); }
      const ok = r.filter(x => x != null), avg = ok.length ? ok.reduce((a, c) => a + c, 0) / ok.length : null;
      const jitter = ok.length > 1 ? ok.slice(1).reduce((a, c, i) => a + Math.abs(c - ok[i]), 0) / (ok.length - 1) : null;
      const f = v => v == null ? null : Math.round(v * 10) / 10;
      return { host, port, sent: count, received: ok.length, loss: Math.round(100 * (count - ok.length) / count), min: f(ok.length ? Math.min(...ok) : null), avg: f(avg), max: f(ok.length ? Math.max(...ok) : null), jitter: f(jitter), samples: r.map(f) };
    }));
    addAudit(req.user.email, 'Multiping ejecutado', targets.join(', '));
    res.json({ results: out });
  });
  app.post('/api/tools/innov/httpcheck', requireAuth, async (req, res) => {
    let u; try { u = new URL(/^https?:\/\//i.test(req.body.url) ? req.body.url : 'https://' + req.body.url); } catch (_) { return res.status(400).json({ error: 'URL inválida' }); }
    if (!okHost(u.hostname)) return res.status(400).json({ error: 'Destino inválido' });
    const t = { start: Date.now() }; let ip = null;
    try { const a = await dns.lookup(u.hostname); ip = a.address; t.dns = Date.now() - t.start; if (blocked(ip) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return res.status(400).json({ error: 'Solo se permiten destinos públicos' }); }
    catch (e) { return res.status(502).json({ error: 'No se pudo resolver el dominio' }); }
    const lib = u.protocol === 'https:' ? https : http;
    const rq = lib.request({ host: ip, servername: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers: { Host: u.hostname, 'User-Agent': 'IPHub-HTTPCheck/1', Accept: '*/*' }, timeout: 10000, rejectUnauthorized: false }, r => {
      t.ttfb = Date.now() - t.start; let size = 0; r.on('data', c => { size += c.length; if (size > 2e6) r.destroy(); });
      const fin = () => {
        const h = r.headers, sec = [['strict-transport-security', 'HSTS'], ['content-security-policy', 'CSP'], ['x-content-type-options', 'X-Content-Type-Options'], ['x-frame-options', 'X-Frame-Options'], ['referrer-policy', 'Referrer-Policy'], ['permissions-policy', 'Permissions-Policy']].map(([k, n]) => ({ name: n, present: !!h[k] }));
        const cert = r.socket && r.socket.getPeerCertificate ? r.socket.getPeerCertificate() : null;
        addAudit(req.user.email, 'HTTP check ejecutado', u.hostname);
        res.json({ url: u.href, ip, status: r.statusCode, httpVersion: r.httpVersion, server: h.server || null, contentType: h['content-type'] || null, location: h.location || null, bytes: size, dnsMs: t.dns, ttfbMs: t.ttfb, totalMs: Date.now() - t.start, security: sec, score: Math.round(100 * sec.filter(x => x.present).length / sec.length), tls: cert && cert.valid_to ? { issuer: cert.issuer && (cert.issuer.O || cert.issuer.CN), validTo: cert.valid_to, protocol: r.socket.getProtocol && r.socket.getProtocol() } : null });
      };
      r.on('end', fin); r.on('close', () => { if (!res.headersSent) fin(); });
    });
    rq.on('timeout', () => rq.destroy(new Error('timeout'))); rq.on('error', e => { if (!res.headersSent) res.status(502).json({ error: 'No se pudo conectar: ' + e.message }); }); rq.end();
  });
};
