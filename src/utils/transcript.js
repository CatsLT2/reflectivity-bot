/**
 * Web transcripts, served at <PUBLIC_URL>/t/<token>.
 * The token is a long random secret (the link is only posted in your staff log channel) - treat the
 * link like a password. Attachments are served through /t/<token>/a/<message>-<file>, which asks Discord
 * for a fresh link each time, because Discord's own attachment links expire.
 */
const Thread = require('../models/Thread');
const client = require('../core/client');
const { formatDuration } = require('./duration');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOKEN_RE = /^[\w-]{20,64}$/;
const iso = (d) => new Date(d).toISOString();
const day = (d) => iso(d).slice(0, 10);
const clock = (d) => iso(d).slice(11, 19);
const full = (d) => `${iso(d).slice(0, 10)} ${iso(d).slice(11, 19)} UTC`;
const isImage = (a) => /^image\/(png|jpe?g|gif|webp)$/i.test(a.type ?? '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name ?? '');
const safeUrl = (u) => (/^https:\/\//i.test(u ?? '') ? u : null);

function attachments(token, mi, m) {
  return m.attachments.map((a, ai) => {
    const href = a.archiveMessageId ? `/t/${token}/a/${mi}-${ai}` : safeUrl(a.url);
    if (!href) return `<div class="file">📎 ${esc(a.name)} <span class="muted">(no longer available)</span></div>`;
    return isImage(a)
      ? `<a href="${esc(href)}" target="_blank" rel="noreferrer"><img class="img" loading="lazy" src="${esc(href)}" alt="${esc(a.name)}"></a>`
      : `<a class="file" href="${esc(href)}" target="_blank" rel="noreferrer">📎 ${esc(a.name)}</a>`;
  }).join('');
}

function message(token, m, mi) {
  const kind = m.internal ? 'note' : m.staff ? 'staff' : 'user';
  const tags = [
    m.internal ? '<span class="tag note">Internal note</span>' : m.staff ? '<span class="tag staff">Staff</span>' : '<span class="tag user">User</span>',
    m.anonymous ? '<span class="tag anon">sent anonymously</span>' : '',
    m.edited ? '<span class="tag">edited</span>' : '',
    m.deleted ? '<span class="tag del">deleted</span>' : '',
  ].join('');
  const body = m.content ? `<div class="body">${esc(m.content)}</div>` : '';
  return `<div class="msg ${kind}${m.deleted ? ' deleted' : ''}">
  <div class="meta"><span class="name">${esc(m.authorName)}</span>${tags}<time title="${esc(full(m.at))}">${clock(m.at)}</time></div>
  ${body}${attachments(token, mi, m)}</div>`;
}

const CSS = `
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;background:#12141a;color:#e6e8ee;font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8b90a0;margin:28px 0 10px}
.card{background:#1b1e27;border:1px solid #272b37;border-radius:14px;padding:18px}
.head{display:flex;gap:14px;align-items:center}.head img{width:56px;height:56px;border-radius:50%;background:#272b37}
.sub{color:#8b90a0;font-size:13px}.muted{color:#8b90a0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:14px}
.stat{background:#151821;border:1px solid #272b37;border-radius:10px;padding:10px 12px}
.stat b{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8b90a0;font-weight:600}
.stat span{font-size:15px;word-break:break-word}
a{color:#8ea2ff}.survey .q{font-size:12px;color:#8b90a0;text-transform:uppercase;letter-spacing:.06em;margin-top:10px}
.pre{white-space:pre-wrap;word-break:break-word}
.day{text-align:center;color:#8b90a0;font-size:12px;margin:22px 0 8px;position:relative}
.day:before{content:"";position:absolute;left:0;right:0;top:50%;border-top:1px solid #272b37;z-index:0}
.day span{background:#12141a;padding:0 10px;position:relative;z-index:1}
.msg{max-width:82%;margin:8px 0;padding:10px 13px;border-radius:14px;background:#1b1e27;border:1px solid #272b37}
.msg.user{border-left:3px solid #4aa3ff}.msg.staff{margin-left:auto;border-right:3px solid #3ddc84;background:#172620}
.msg.note{max-width:100%;border:1px dashed #b89a2e;background:#272316}.msg.deleted{opacity:.55}.msg.deleted .body{text-decoration:line-through}
.meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin-bottom:4px}
.name{font-weight:650;font-size:13px}time{margin-left:auto;color:#8b90a0}
.tag{font-size:10px;text-transform:uppercase;letter-spacing:.05em;padding:1px 7px;border-radius:99px;background:#2a2f3c;color:#aab}
.tag.user{background:#16324d;color:#7cc0ff}.tag.staff{background:#14402a;color:#6fe0a3}.tag.note{background:#463b12;color:#e8cf6a}.tag.anon{background:#33264d;color:#c3a4ff}.tag.del{background:#4d1a1a;color:#ff8f8f}
.body{white-space:pre-wrap;word-break:break-word}.img{max-width:100%;max-height:420px;border-radius:10px;margin-top:8px;display:block}
.file{display:inline-block;margin-top:8px;padding:6px 10px;background:#232736;border-radius:8px}
.event{text-align:center;color:#8b90a0;font-size:12.5px;margin:10px 0}
@media(max-width:600px){.msg{max-width:100%}}
`;

function stat(label, value) {
  return `<div class="stat"><b>${esc(label)}</b><span>${value}</span></div>`;
}

function render(t, token) {
  const r = t.roblox?.id ? t.roblox : null;
  const rid = r ? String(r.id).replace(/\D/g, '') : '';
  const duration = t.closedAt ? formatDuration(new Date(t.closedAt) - new Date(t.createdAt)) : 'n/a';

  const stats = [
    stat('Opened', esc(full(t.createdAt))),
    stat('Closed', t.closedAt ? esc(full(t.closedAt)) : 'n/a'),
    stat('Duration', esc(duration)),
    stat('Avg response time', esc(formatDuration(t.stats?.avgResponseMs))),
    stat('First response', esc(formatDuration(t.stats?.firstResponseMs))),
    stat('Messages', String(t.messages.filter((m) => !m.internal && !m.deleted).length)),
    stat('Claimed by', esc(t.claimedByName ?? 'nobody')),
    stat('Closed by', esc(t.closedByName ?? 'n/a')),
  ].join('');

  const survey = t.survey?.summary ? `<h2>Opening form</h2><div class="card survey">
    <div class="q">Summary of the issue</div><div class="pre">${esc(t.survey.summary)}</div>
    ${t.survey.extra ? `<div class="q">Extra info / background</div><div class="pre">${esc(t.survey.extra)}</div>` : ''}</div>` : '';

  const roblox = r ? `<h2>Roblox</h2><div class="card"><div class="head">
    ${r.avatar && safeUrl(r.avatar) ? `<img src="${esc(r.avatar)}" alt="">` : ''}
    <div><h1><a href="https://www.roblox.com/users/${rid}/profile" target="_blank" rel="noreferrer">${esc(r.displayName || r.name)}</a>${r.verified ? ' ✔️' : ''}</h1>
    <div class="sub">@${esc(r.name)} · ID ${esc(rid)}</div></div></div>
    <div class="grid">
      ${r.created ? stat('Account created', esc(day(r.created))) : ''}
      ${Number.isFinite(r.friends) ? stat('Friends', r.friends.toLocaleString('en-US')) : ''}
      ${Number.isFinite(r.followers) ? stat('Followers', r.followers.toLocaleString('en-US')) : ''}
      ${Number.isFinite(r.groupCount) ? stat('Groups', String(r.groupCount)) : ''}
      ${r.banned ? stat('Status', '⚠️ banned') : ''}
    </div>
    ${r.groups?.length ? `<div class="sub" style="margin-top:12px">${r.groups.slice(0, 8).map((g) => esc(`${g.name}${g.role ? ` (${g.role})` : ''}`)).join(' · ')}</div>` : ''}
    ${r.description ? `<div class="pre sub" style="margin-top:10px">${esc(r.description)}</div>` : ''}</div>` : '';

  const items = [
    ...t.messages.map((m, mi) => ({ at: m.at, html: message(token, m, mi) })),
    ...t.events.map((e) => ({ at: e.at, html: `<div class="event">${clock(e.at)} · <b>${esc(e.by)}</b> ${esc(e.text)}</div>` })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  let lastDay = '';
  const timeline = items.map((i) => {
    const d = day(i.at);
    const sep = d !== lastDay ? `<div class="day"><span>${d}</span></div>` : '';
    lastDay = d;
    return sep + i.html;
  }).join('\n');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Transcript - ${esc(t.username)}</title><style>${CSS}</style></head><body><div class="wrap">
<div class="card"><div class="head">${t.userAvatar && safeUrl(t.userAvatar) ? `<img src="${esc(t.userAvatar)}" alt="">` : ''}
<div><h1>${esc(t.username)}</h1><div class="sub">Discord ID ${esc(t.userId)}</div></div></div>
<div class="grid">${stats}</div>
${t.closeReason ? `<div class="sub" style="margin-top:14px">Close reason: <span class="pre">${esc(t.closeReason)}</span></div>` : ''}</div>
${survey}${roblox}
<h2>Conversation</h2>
${timeline || '<div class="event">No messages.</div>'}
</div></body></html>`;
}

const notFound = () => ({
  status: 404,
  html: '<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:system-ui;background:#12141a;color:#e6e8ee;display:grid;place-items:center;height:100vh"><p>This transcript doesn\'t exist.</p>',
});

/** GET /t/<token> */
async function page(token) {
  if (!TOKEN_RE.test(token)) return notFound();
  const t = await Thread.findOne({ transcriptToken: token, status: 'closed' }).lean();
  return t ? { status: 200, html: render(t, token) } : notFound();
}

/** GET /t/<token>/a/<message>-<file>  ->  { status: 302, location } with a fresh Discord link */
async function attachment(token, mi, ai) {
  if (!TOKEN_RE.test(token)) return { status: 404 };
  const t = await Thread.findOne({ transcriptToken: token, status: 'closed' }, { messages: 1 }).lean();
  const a = t?.messages?.[mi]?.attachments?.[ai];
  if (!a?.archiveMessageId) return { status: 404 };
  try {
    const channel = await client.channels.fetch(a.archiveChannelId);
    const msg = await channel.messages.fetch(a.archiveMessageId);
    const file = msg.attachments.find((x) => x.name === a.archiveName) ?? msg.attachments.first();
    return file ? { status: 302, location: file.url } : { status: 404 };
  } catch {
    return { status: 404 };
  }
}

module.exports = { page, attachment, render };
