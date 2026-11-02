/**
 * Tiny HTTP server: Roblox OAuth callback + web ticket transcripts (/t/<token>). It is stateless (everything lives in the shared
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
    if (data.length > max) { reject(TOO_LARGE); req.destroy(); }
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

function start() {
  if (server) return;
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const roblox = () => require('../utils/roblox');

      if (url.pathname === '/health') return send(res, 200, 'ok', 'text/plain');

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
      if (err === TOO_LARGE) return send(res, 413, 'Request too large', 'text/plain');
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
