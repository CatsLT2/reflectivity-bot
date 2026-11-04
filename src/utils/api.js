/**
 * Roblox endpoint, protected by an API key.
 *   GET  /api/roblox?user=<roblox username or numeric ID>[&page=2]
 *   POST /api/roblox   {"user": "<username or ID>", "page": 1}
 * Send the key in a header:  X-API-Key: rbx_...   (or  Authorization: Bearer rbx_...). Never in the URL.
 * Keys are created with /apikey create and can be revoked instantly with /apikey revoke.
 */
const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const lookup = require('./robloxLookup');

const KEY_LIMIT = { max: 120, windowMs: 60000 }; // requests per key per minute
const FAIL_LIMIT = { max: 10, windowMs: 60000 }; // bad keys per IP per minute

const buckets = new Map(); // "key:<id>" | "fail:<ip>" -> number[] of timestamps
function hit(bucket, { max, windowMs }, { count = true } = {}) {
  const now = Date.now();
  const list = (buckets.get(bucket) ?? []).filter((t) => now - t < windowMs);
  const limited = list.length >= max;
  if (count && !limited) list.push(now);
  buckets.set(bucket, list);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.length || now - v.at(-1) > 120000) buckets.delete(k);
  return limited;
}

const json = (status, data, headers = {}) => ({
  status, type: 'application/json; charset=utf-8', body: JSON.stringify(status < 400 ? { ok: true, ...data } : { ok: false, ...data }), headers,
});

function extractKey(headers) {
  const direct = headers['x-api-key'];
  if (typeof direct === 'string' && direct) return direct.trim();
  const auth = headers.authorization;
  const m = typeof auth === 'string' && auth.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

async function verifyKey(key) {
  if (key.length < 20 || key.length > 200) return null;
  const rec = await ApiKey.findOne({ hash: crypto.createHash('sha256').update(key).digest('hex'), revoked: { $ne: true } }).lean();
  if (rec) ApiKey.updateOne({ _id: rec._id }, { $set: { lastUsedAt: new Date() }, $inc: { uses: 1 } }).catch(() => {});
  return rec;
}

async function handle({ method, url, headers, ip, body }) {
  if (url.pathname.replace(/\/+$/, '') !== '/api/roblox') return json(404, { error: 'not_found' });
  if (method !== 'GET' && method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' });

  if (hit(`fail:${ip}`, FAIL_LIMIT, { count: false })) return json(429, { error: 'too_many_failed_attempts' }, { 'Retry-After': '60' });
  const key = extractKey(headers);
  const rec = key ? await verifyKey(key) : null;
  if (!rec) {
    hit(`fail:${ip}`, FAIL_LIMIT);
    return json(401, { error: key ? 'invalid_api_key' : 'missing_api_key' }, { 'WWW-Authenticate': 'ApiKey realm="roblox"' });
  }
  if (hit(`key:${rec._id}`, KEY_LIMIT)) return json(429, { error: 'rate_limited' }, { 'Retry-After': '60' });

  let input = url.searchParams.get('user') ?? url.searchParams.get('username') ?? url.searchParams.get('id');
  let page = url.searchParams.get('page');
  if (method === 'POST') {
    try {
      const j = body ? JSON.parse(body) : {};
      input = j.user ?? j.username ?? j.id ?? input;
      page = j.page ?? page;
    } catch { return json(400, { error: 'invalid_json' }); }
  }
  input = typeof input === 'number' ? String(input) : input;
  if (!lookup.isValidInput(input)) return json(400, { error: 'invalid_input', message: 'Send "user": a Roblox username (letters, digits, _) or numeric user ID.' });
  const pageNum = Math.min(Math.max(parseInt(page, 10) || 1, 1), 100000);

  return json(200, await lookup.lookup(rec.guildId, input.trim(), pageNum));
}

module.exports = { handle };
