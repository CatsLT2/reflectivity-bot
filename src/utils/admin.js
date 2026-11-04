/**
 * Admin website (/admin). Read-only: browse people with warns / kicks / bans, search them, open a profile.
 * Always 10 per page (the page size is fixed server-side) and only the 10 rows on screen are ever looked up.
 */
const crypto = require('crypto');
const config = require('../config');
const client = require('../core/client');
const Thread = require('../models/Thread');
const RobloxLink = require('../models/RobloxLink');
const auth = require('./adminAuth');
const mod = require('./moderation');
const robloxInfo = require('./robloxInfo');
const { formatDuration } = require('./duration');
const log = require('./logger')('admin');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (d) => (d ? `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '-');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
const safeUrl = (u) => (/^https:\/\//i.test(u ?? '') ? u : null);
const num = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '-');

/* ------------------------------ rate limiting ------------------------------ */
const hits = new Map();
function limited(key, max = 120, windowMs = 60000) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 2000) for (const [k, v] of hits) if (now - v.at(-1) > windowMs) hits.delete(k);
  return list.length > max;
}

/* --------------------------------- layout ---------------------------------- */

const CSS = `
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;background:#12141a;color:#e6e8ee;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
a{color:#8ea2ff;text-decoration:none}a:hover{text-decoration:underline}
.top{display:flex;align-items:center;gap:12px;padding:12px 20px;background:#181b23;border-bottom:1px solid #272b37;position:sticky;top:0}
.brand{font-weight:700;color:#fff;font-size:16px}.grow{flex:1}.who{color:#aab;font-size:13px;display:flex;align-items:center;gap:8px}
.who img{width:24px;height:24px;border-radius:50%}
main{max-width:980px;margin:0 auto;padding:22px 16px 60px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8b90a0;margin:26px 0 10px}
.muted{color:#8b90a0}.sub{color:#8b90a0;font-size:13px}.mono{font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
.card{background:#1b1e27;border:1px solid #272b37;border-radius:14px;padding:16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
.stat b{display:block;font-size:26px}.stat span{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8b90a0}
form.search{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 14px}
input,select,button{font:inherit;color:#e6e8ee;background:#151821;border:1px solid #30354a;border-radius:8px;padding:9px 12px}
input[type=text]{flex:1;min-width:200px}button{cursor:pointer;background:#5865f2;border-color:#5865f2;color:#fff}button:hover{background:#4752c4}
button.ghost{background:transparent;border-color:#30354a;color:#c9ccd6;padding:5px 10px;font-size:13px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#8b90a0;padding:8px 10px}
td{padding:11px 10px;border-top:1px solid #272b37;vertical-align:top}tr:hover td{background:#1f2330}
.b{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12px;margin-right:4px;white-space:nowrap}
.b.warn{background:#4a3f12;color:#f4d35e}.b.kick{background:#4d3114;color:#f0a35a}.b.ban{background:#4d1a1a;color:#ff8f8f}.b.unban{background:#14402a;color:#6fe0a3}
.b.dim{background:#232736;color:#8b90a0}.b.src{background:#2a2f3c;color:#aab;font-size:11px}.b.red{background:#4d1a1a;color:#ff8f8f}
.pager{display:flex;justify-content:center;align-items:center;gap:18px;margin:18px 0;color:#8b90a0}
.pg{padding:6px 14px;border:1px solid #30354a;border-radius:8px}.pg.off{opacity:.35}
.head{display:flex;gap:14px;align-items:center}.head img{width:64px;height:64px;border-radius:50%;background:#272b37}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px}
.pre{white-space:pre-wrap;word-break:break-word}.empty{text-align:center;padding:36px;color:#8b90a0}
.login{max-width:380px;margin:12vh auto;text-align:center}.login a.btn{display:inline-block;margin-top:18px;padding:12px 22px;background:#5865f2;color:#fff;border-radius:10px;font-weight:600}
.err{background:#3a1717;border:1px solid #5a2323;color:#ffb4b4;padding:10px 14px;border-radius:10px;margin:14px 0}
@media(max-width:640px){th.h{display:none}td{padding:9px 6px}}
`;

function layout(title, body, session) {
  const who = session
    ? `<span class="who">${session.avatar && safeUrl(session.avatar) ? `<img src="${esc(session.avatar)}" alt="">` : ''}${esc(session.name)}</span>
       <form method="POST" action="/admin/logout" style="margin:0"><button class="ghost" type="submit">Log out</button></form>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="top"><a class="brand" href="/admin">🛡️ Admin</a><span class="grow"></span>${who}</div><main>${body}</main></body></html>`;
}

const page = (title, body, session, status = 200) => ({ status, body: layout(title, body, session) });
const redirect = (location, cookies) => ({ status: 302, location, cookies, body: '' });
const plain = (status, text) => ({ status, type: 'text/plain; charset=utf-8', body: text });

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && !(k === 'page' && Number(v) === 1)) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

function pager(base, params, current, pages) {
  const link = (p, label, off) => (off ? `<span class="pg off">${label}</span>` : `<a class="pg" href="${base}${qs({ ...params, page: p })}">${label}</a>`);
  return `<div class="pager">${link(current - 1, '← Prev', current <= 1)}<span>Page ${current} of ${pages}</span>${link(current + 1, 'Next →', current >= pages)}</div>`;
}

const typeBadge = (t) => `<span class="b ${t}">${esc(mod.LABEL[t])}</span>`;
const count = (n, cls, label) => (n ? `<span class="b ${cls}">${n} ${label}${n === 1 ? '' : 's'}</span>` : '');

/* ---------------------------------- login ---------------------------------- */

function loginPage(error) {
  return page('Admin login', `<div class="login card"><h1>Admin panel</h1><p class="sub">Sign in with the Discord account that manages this server.</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}<a class="btn" href="/admin/auth">Login with Discord</a></div>`, null);
}

async function startAuth() {
  const state = crypto.randomBytes(18).toString('base64url');
  const token = auth.sign({ s: state, exp: Date.now() + 10 * 60 * 1000 });
  return redirect(auth.authorizeUrl(state), [auth.setCookie(auth.STATE_COOKIE, token, 600)]);
}

async function callback({ url, headers }) {
  const fail = (msg, status = 400) => ({ ...loginPage(msg), status, cookies: [auth.clearCookie(auth.STATE_COOKIE)] });
  if (url.searchParams.get('error')) return fail('Discord login was cancelled.');
  const saved = auth.verify(auth.parseCookies(headers.cookie)[auth.STATE_COOKIE]);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!saved || !state || saved.s !== state || !code) return fail('That login link expired. Please try again.');
  try {
    const me = await auth.exchange(code);
    if (!(await auth.isAdmin(me.id))) {
      log.info(`denied admin login for ${me.username} (${me.id})`);
      return fail('Your Discord account is not an admin of this server.', 403);
    }
    log.info(`admin login: ${me.username} (${me.id})`);
    return redirect('/admin', [auth.setCookie(auth.SESSION_COOKIE, auth.newSession(me), auth.SESSION_MS / 1000), auth.clearCookie(auth.STATE_COOKIE)]);
  } catch (err) {
    log.warn(`login failed: ${err.message}`);
    return fail('Login failed. Please try again.', 502);
  }
}

/* ------------------------------- people list -------------------------------- */

async function peoplePage({ url }, session) {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 40);
  const type = mod.TYPES.includes(url.searchParams.get('type')) ? url.searchParams.get('type') : '';
  const pageNo = Math.min(Math.max(parseInt(url.searchParams.get('page'), 10) || 1, 1), 100000);

  const [list, t] = await Promise.all([mod.listPeople(config.guildId, { q, type, page: pageNo }), mod.totals(config.guildId)]);
  const params = { q, type };

  const rows = list.people.map((p) => `<tr>
    <td><a href="/admin/user/${esc(p.userId)}"><b>${esc(p.name ?? 'unknown')}</b></a><div class="mono muted">${esc(p.userId)}</div></td>
    <td>${p.roblox ? `<a href="https://www.roblox.com/users/${esc(p.roblox.robloxId)}/profile" target="_blank" rel="noreferrer">${esc(p.roblox.robloxName)}</a>` : '<span class="muted">not linked</span>'}</td>
    <td>${count(p.warns, 'warn', 'warn')}${count(p.kicks, 'kick', 'kick')}${count(p.bans, 'ban', 'ban')}${!p.warns && !p.kicks && !p.bans ? '<span class="b dim">none active</span>' : ''}</td>
    <td class="sub">${typeBadge(p.lastType)}<div>${esc(when(p.last))}</div></td></tr>`).join('');

  const idHint = list.search?.kind === 'discord-id' && !list.total
    ? `<div class="card" style="margin-top:12px">No moderation records for that user. <a href="/admin/user/${esc(list.search.ids[0])}">Open their profile</a> anyway.</div>` : '';

  const body = `<h1>Moderation</h1><div class="sub">Warns, kicks and bans recorded by the bot</div>
    <div class="cards"><div class="card stat"><b>${num(t.warns)}</b><span>Active warns</span></div><div class="card stat"><b>${num(t.kicks)}</b><span>Kicks</span></div><div class="card stat"><b>${num(t.bans)}</b><span>Bans</span></div></div>
    <form class="search" method="GET" action="/admin">
      <input type="text" name="q" value="${esc(q)}" placeholder="Search Discord ID, @mention, Discord username, or linked Roblox username / ID" maxlength="40" autocomplete="off">
      <select name="type"><option value="">All actions</option>${mod.TYPES.map((x) => `<option value="${x}"${x === type ? ' selected' : ''}>${esc(mod.LABEL[x])}s</option>`).join('')}</select>
      <button type="submit">Search</button></form>
    <div class="sub">${num(list.total)} ${list.total === 1 ? 'person' : 'people'}${q ? ` matching "${esc(q)}"` : ''} · 10 per page</div>
    <div class="card" style="padding:4px 8px;margin-top:10px"><table><thead><tr><th class="h">Person</th><th class="h">Roblox</th><th class="h">Record</th><th class="h">Latest</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="empty">Nothing here.</td></tr>'}</tbody></table></div>
    ${idHint}${list.pages > 1 ? pager('/admin', params, list.page, list.pages) : ''}`;
  return page('Moderation', body, session);
}

/* -------------------------------- user profile -------------------------------- */

async function userPage({ url }, session, userId) {
  const type = mod.TYPES.includes(url.searchParams.get('type')) ? url.searchParams.get('type') : '';
  const pageNo = Math.min(Math.max(parseInt(url.searchParams.get('page'), 10) || 1, 1), 100000);
  const guildId = config.guildId;

  const [sum, list, user, link, tickets] = await Promise.all([
    mod.userSummary(guildId, userId),
    mod.listCases(guildId, userId, { type, page: pageNo }),
    client.users.fetch(userId).catch(() => null),
    RobloxLink.findOne({ discordId: userId }).lean(),
    Thread.find({ guildId, userId, status: 'closed' }).sort({ closedAt: -1 }).limit(5).select('closedAt closeReason transcriptToken stats').lean(),
  ]);
  const info = link ? await robloxInfo.fetchInfo(link.robloxId).catch(() => null) : null;
  const name = user?.username ?? list.cases[0]?.userTag ?? 'Unknown user';
  const avatar = user?.displayAvatarURL({ size: 128 });

  const cases = list.cases.map((c) => `<tr>
    <td class="mono">#${c.caseNumber}</td><td>${typeBadge(c.type)}${c.pardoned ? '<span class="b dim">pardoned</span>' : ''}</td>
    <td class="pre">${esc(c.reason)}${c.pardoned && c.pardonReason ? `<div class="sub">Pardon: ${esc(c.pardonReason)}</div>` : ''}</td>
    <td>${esc(c.moderatorName ?? 'Unknown')}${c.source !== 'bot' ? `<div><span class="b src">${c.source === 'discord' ? 'done in Discord' : 'imported'}</span></div>` : ''}</td>
    <td class="sub">${esc(when(c.createdAt))}</td></tr>`).join('');

  const robloxCard = link ? `<h2>Roblox</h2><div class="card"><div class="head">
      ${info?.avatar && safeUrl(info.avatar) ? `<img src="${esc(info.avatar)}" alt="">` : ''}
      <div><b><a href="https://www.roblox.com/users/${esc(link.robloxId)}/profile" target="_blank" rel="noreferrer">${esc(info?.displayName || link.displayName || link.robloxName)}</a>${info?.verified ? ' ✔️' : ''}</b>
      <div class="sub">@${esc(info?.name ?? link.robloxName)} · ID <span class="mono">${esc(link.robloxId)}</span>${info?.banned ? ' · <span class="b red">banned on Roblox</span>' : ''}</div></div></div>
      ${info ? `<div class="grid"><div class="sub">Created<br><b>${esc(day(info.created))}</b></div><div class="sub">Friends<br><b>${num(info.friends)}</b></div><div class="sub">Followers<br><b>${num(info.followers)}</b></div><div class="sub">Groups<br><b>${num(info.groupCount)}</b></div></div>` : ''}
      <div class="sub" style="margin-top:10px">Linked on ${esc(day(link.createdAt))}</div></div>`
    : '<h2>Roblox</h2><div class="card muted">No Roblox account linked.</div>';

  const ticketCard = tickets.length ? `<h2>Recent tickets</h2><div class="card">${tickets.map((t) =>
    `<div style="margin:6px 0">${t.transcriptToken ? `<a href="/t/${esc(t.transcriptToken)}">${esc(day(t.closedAt))} - transcript</a>` : esc(day(t.closedAt))}
     <span class="sub"> · ${esc((t.closeReason ?? '').slice(0, 80))} · avg response ${esc(formatDuration(t.stats?.avgResponseMs))}</span></div>`).join('')}</div>` : '';

  const body = `<div class="sub"><a href="/admin">← All people</a></div>
    <div class="card" style="margin-top:10px"><div class="head">${avatar ? `<img src="${esc(avatar)}" alt="">` : ''}
      <div><h1>${esc(name)}${sum.banned ? ' <span class="b ban">currently banned</span>' : ''}</h1><div class="mono muted">${esc(userId)}</div>${user ? '' : '<div class="sub">This account is no longer visible to the bot.</div>'}</div></div>
      <div class="cards" style="margin-bottom:0"><div class="stat"><b>${sum.warns}</b><span>Active warns</span></div><div class="stat"><b>${sum.kicks}</b><span>Kicks</span></div><div class="stat"><b>${sum.bans}</b><span>Bans</span></div><div class="stat"><b>${sum.unbans}</b><span>Unbans</span></div></div></div>
    ${robloxCard}${ticketCard}
    <h2>History</h2>
    <form class="search" method="GET" action="/admin/user/${esc(userId)}"><select name="type"><option value="">All actions</option>${mod.TYPES.map((x) => `<option value="${x}"${x === type ? ' selected' : ''}>${esc(mod.LABEL[x])}s</option>`).join('')}</select><button type="submit">Filter</button></form>
    <div class="card" style="padding:4px 8px"><table><thead><tr><th class="h">Case</th><th class="h">Action</th><th class="h">Reason</th><th class="h">Moderator</th><th class="h">When</th></tr></thead>
    <tbody>${cases || '<tr><td colspan="5" class="empty">No moderation history.</td></tr>'}</tbody></table></div>
    ${list.pages > 1 ? pager(`/admin/user/${esc(userId)}`, { type }, list.page, list.pages) : ''}`;
  return page(`${name} - Admin`, body, session);
}

/* ---------------------------------- router ----------------------------------- */

async function handle(req) {
  if (!config.admin.enabled) return plain(404, 'Not found');
  const { method, url, headers } = req;
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/admin/login' && method === 'GET') return loginPage();
  if (path === '/admin/auth' && method === 'GET') return startAuth();
  if (path === '/admin/callback' && method === 'GET') return callback(req);

  if (path === '/admin/logout' && method === 'POST') {
    if (headers.origin && headers.origin !== config.web.publicUrl) return plain(403, 'Forbidden');
    return redirect('/admin/login', [auth.clearCookie(auth.SESSION_COOKIE)]);
  }

  const session = await auth.getSession(headers);
  if (!session) return redirect('/admin/login');
  if (limited(`admin:${session.uid}`)) return plain(429, 'Slow down a little.');

  if (method !== 'GET') return plain(405, 'Method not allowed');
  if (path === '/admin') return peoplePage(req, session);
  const m = path.match(/^\/admin\/user\/(\d{15,22})$/);
  if (m) return userPage(req, session, m[1]);
  return page('Not found', '<div class="empty">Page not found. <a href="/admin">Back to the list</a></div>', session, 404);
}

module.exports = { handle };
