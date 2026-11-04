/**
 * "Login with Discord" for the admin site. Sessions are signed cookies (HMAC with SESSION_SECRET) so they work on
 * every node of your failover pair. Admin = Administrator or Manage Server in your server, or listed in
 * ADMIN_USER_IDS / holding a role in ADMIN_ROLE_IDS. Re-checked every few minutes so removing someone's role locks them out.
 */
const crypto = require('crypto');
const { PermissionFlagsBits: P } = require('discord.js');
const config = require('../config');
const client = require('../core/client');

const SESSION_COOKIE = 'rx_admin';
const STATE_COOKIE = 'rx_state';
const SESSION_MS = 8 * 3600 * 1000;
const RECHECK_MS = 5 * 60 * 1000;
const API = 'https://discord.com/api/v10';

const mac = (data) => crypto.createHmac('sha256', config.admin.sessionSecret).update(data).digest('base64url');

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(body)}`;
}

function verify(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = mac(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const setCookie = (name, value, maxAgeSec) => `${name}=${value}; Path=/admin; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`;
const clearCookie = (name) => setCookie(name, '', 0);

const adminCache = new Map(); // userId -> { ok, at }
async function isAdmin(userId) {
  const hit = adminCache.get(userId);
  if (hit && Date.now() - hit.at < RECHECK_MS) return hit.ok;
  let ok = config.admin.userIds.includes(userId);
  if (!ok) {
    const guild = client.guilds.cache.get(config.guildId);
    const member = await guild?.members.fetch(userId).catch(() => null);
    if (member) {
      ok = member.permissions.has(P.Administrator) || member.permissions.has(P.ManageGuild)
        || config.admin.roleIds.some((r) => member.roles.cache.has(r));
    }
  }
  adminCache.set(userId, { ok, at: Date.now() });
  return ok;
}

/** The logged-in admin for this request, or null. */
async function getSession(headers) {
  const s = verify(parseCookies(headers.cookie)[SESSION_COOKIE]);
  return s && (await isAdmin(s.uid)) ? s : null;
}

const redirectUri = () => `${config.web.publicUrl}/admin/callback`;

function authorizeUrl(state) {
  const u = new URL('https://discord.com/oauth2/authorize');
  u.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: 'identify', state, prompt: 'none',
  }).toString();
  return u.toString();
}

/** code -> Discord user ({ id, username, avatar }) or throws. The OAuth token is revoked right away. */
async function exchange(code) {
  const form = { client_id: config.clientId, client_secret: config.admin.clientSecret };
  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, grant_type: 'authorization_code', code, redirect_uri: redirectUri() }), signal: AbortSignal.timeout(10000),
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed (HTTP ${tokenRes.status})`);
  const tokens = await tokenRes.json();
  const meRes = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10000) });
  if (!meRes.ok) throw new Error(`could not read your Discord profile (HTTP ${meRes.status})`);
  const me = await meRes.json();
  fetch(`${API}/oauth2/token/revoke`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, token: tokens.access_token }), signal: AbortSignal.timeout(5000),
  }).catch(() => {});
  return me;
}

const newSession = (me) => sign({
  uid: me.id, name: me.global_name || me.username,
  avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null,
  exp: Date.now() + SESSION_MS,
});

module.exports = {
  SESSION_COOKIE, STATE_COOKIE, SESSION_MS, sign, verify, parseCookies, setCookie, clearCookie,
  isAdmin, getSession, authorizeUrl, exchange, newSession,
};
