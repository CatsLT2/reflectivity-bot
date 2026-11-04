/**
 * Tiny HTTP server: ticket transcripts (/t/<token>), Roblox OAuth callback, admin site (/admin) and the API (/api). It is stateless (everything lives in the shared
 * database), so it can run on EVERY node - whichever node your public URL reaches will work.
 * Business logic is loaded lazily so edits to utils/roblox.js hot-reload.
 */
const http = require('http');
const config = require('../config');
const log = require('../utils/logger')('web');

let server = null;

const TOO_LARGE = Symbol('too large');
const readBody = (req, max = 4096) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
    if (data.length > max) { req.pause(); reject(TOO_LARGE); } // stop reading; the 413 reply below closes the connection
  });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', // the callback URL contains a one-time code
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow', // transcripts are private
    'Content-Security-Policy': "default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
  res.end(body);
}

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer', // URLs can contain one-time codes / secret tokens
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

/** Sends { status, body, type?, headers?, cookies?, location? } returned by the admin / API modules. */
function respond(res, out) {
  const headers = { ...SECURITY_HEADERS, 'Content-Type': out.type ?? 'text/html; charset=utf-8', ...out.headers };
  if (out.cookies?.length) headers['Set-Cookie'] = out.cookies;
  if (out.location) headers.Location = out.location;
  res.writeHead(out.status, headers);
  res.end(out.body ?? '');
}

/** The real client IP. X-Forwarded-For is only trusted when the request comes from our own reverse proxy / tunnel on this machine. */
function clientIp(req) {
  const remote = req.socket.remoteAddress ?? '';
  if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (fwd && fwd.length <= 45) return fwd;
  }
  return remote;
}

function start() {
  if (server) return;
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const roblox = () => require('../utils/roblox');

      if (url.pathname === '/health') return send(res, 200, 'ok', 'text/plain');

      // ---- admin website + API (logic lives in utils/, so it hot-reloads) ----
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        const body = req.method === 'POST' ? await readBody(req) : '';
        return respond(res, await require('../utils/admin').handle({ method: req.method, url, headers: req.headers, ip: clientIp(req), body }));
      }
      if (url.pathname.startsWith('/api/')) {
        const body = req.method === 'POST' ? await readBody(req, 2048) : '';
        return respond(res, await require('../utils/api').handle({ method: req.method, url, headers: req.headers, ip: clientIp(req), body }));
      }

      // ---- ticket transcripts ----
      const tr = url.pathname.match(/^\/t\/([\w-]+)(?:\/a\/(\d+)-(\d+))?$/);
      if (tr && req.method === 'GET') {
        const transcript = require('../utils/transcript');
        if (tr[2] === undefined) {
          const out = await transcript.page(tr[1]);
          return send(res, out.status, out.html);
        }
        const out = await transcript.attachment(tr[1], Number(tr[2]), Number(tr[3]));
        if (out.status === 302) {
          res.writeHead(302, { Location: out.location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
          return res.end();
        }
        return send(res, 404, 'Not found', 'text/plain');
      }

      // ---- Roblox account linking ----
      if (url.pathname.startsWith('/roblox/') && !config.roblox.enabled) return send(res, 404, 'Not found', 'text/plain');

      if (req.method === 'GET' && url.pathname === '/roblox/callback') {
        const out = await roblox().handleCallback(Object.fromEntries(url.searchParams));
        return send(res, out.status, out.html);
      }
      if (req.method === 'POST' && url.pathname === '/roblox/confirm') {
        const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
        const out = await roblox().handleConfirm(form);
        return send(res, out.status, out.html);
      }
      return send(res, 404, 'Not found', 'text/plain');
    } catch (err) {
      if (err === TOO_LARGE) { res.setHeader('Connection', 'close'); return send(res, 413, 'Request too large', 'text/plain'); }
      log.error('request failed:', err);
      return send(res, 500, 'Something went wrong. Please try again.', 'text/plain');
    }
  });

  server.on('error', (err) => log.error(`web server error: ${err.message}`));
  server.listen(config.web.port, config.web.host, () => {
    log.info(`callback server listening on ${config.web.host}:${config.web.port} (public: ${config.web.publicUrl})`);
  });
}

function stop() {
  server?.close();
  server = null;
}

module.exports = { start, stop };
