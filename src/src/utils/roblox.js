/**
 * Roblox account linking via Roblox OAuth 2.0 (authorization code + PKCE).
 *
 *  1. /roblox link      -> makes a one-time state + PKCE verifier, hands the user a Roblox login URL
 *  2. Roblox redirects  -> GET  <PUBLIC_URL>/roblox/callback   (handleCallback)
 *     we swap the code for a token, read the Roblox identity, then ask the user to CONFIRM
 *  3. User confirms     -> POST <PUBLIC_URL>/roblox/confirm    (handleConfirm) -> saved in the DB
 *
 * The confirm step stops "link swapping": someone sending you their link so YOUR Roblox account
 * gets attached to THEIR Discord account. The page names the Discord account being linked.
 * No Roblox tokens are stored; the refresh token is revoked straight after we read your ID.
 */
const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config');
const client = require('../core/client');
const RobloxLink = require('../models/RobloxLink');
const OAuthState = require('../models/OAuthState');
const GuildConfig = require('../models/GuildConfig');
const embeds = require('./embeds');
const log = require('./logger')('roblox');

const AUTHORIZE = 'https://apis.roblox.com/oauth/v1/authorize';
const TOKEN = 'https://apis.roblox.com/oauth/v1/token';
const REVOKE = 'https://apis.roblox.com/oauth/v1/token/revoke';
const USERINFO = 'https://apis.roblox.com/oauth/v1/userinfo';
const TIMEOUT = () => AbortSignal.timeout(10000);

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const profileUrl = (id) => `https://www.roblox.com/users/${id}/profile`;

/* ------------------------------- web pages ---------------------------------- */

function page(status, title, body, form) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16181d;color:#e8e9ec;font:16px/1.5 system-ui,sans-serif}
  main{max-width:420px;margin:24px;padding:32px;background:#1f2229;border-radius:14px;text-align:center}
  h1{font-size:22px;margin:0 0 12px} p{color:#b6b9c2;margin:8px 0} b{color:#fff}
  button{margin-top:20px;padding:12px 24px;font-size:16px;border:0;border-radius:8px;background:#5865f2;color:#fff;cursor:pointer}
  button:hover{background:#4752c4} img{width:72px;height:72px;border-radius:50%;margin-bottom:12px;background:#2b2f38}
</style></head><body><main><h1>${esc(title)}</h1>${body}${form ?? ''}</main></body></html>`;
  return { status, html };
}

const fail = (title, message) => page(400, title, `<p>${esc(message)}</p><p>You can close this tab and run <b>/roblox link</b> again in Discord.</p>`);

/* ------------------------------- step 1: URL -------------------------------- */

async function beginLink(user) {
  const state = b64url(crypto.randomBytes(24));
  const codeVerifier = b64url(crypto.randomBytes(48)); // 64 chars (spec: 43-128)
  const challenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());

  await OAuthState.create({ state, codeVerifier, discordId: user.id });

  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: config.roblox.clientId,
    redirect_uri: config.roblox.redirectUri,
    scope: 'openid profile',
    response_type: 'code',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

/* --------------------------- step 2: Roblox redirect ------------------------- */

async function discordName(discordId) {
  const user = await client.users.fetch(discordId).catch(() => null);
  return user ? user.username : `the Discord account with ID ${discordId}`;
}

async function confirmPage(st) {
  const p = st.pending;
  const who = await discordName(st.discordId);
  return page(200, 'Confirm account link', `
    ${p.avatarUrl ? `<img src="${esc(p.avatarUrl)}" alt="">` : ''}
    <p>Roblox account <b>${esc(p.displayName || p.robloxName)}</b> (@${esc(p.robloxName)})</p>
    <p>will be linked to Discord account <b>${esc(who)}</b>.</p>
    <p>Only continue if that Discord account is <b>yours</b>.</p>`,
  `<form method="POST" action="/roblox/confirm"><input type="hidden" name="state" value="${esc(st.state)}"><button type="submit">Link accounts</button></form>`);
}

async function handleCallback(query) {
  if (query.error) return fail('Link cancelled', query.error === 'access_denied' ? 'You declined the request.' : `Roblox returned an error: ${query.error}`);
  if (!query.state || !query.code) return fail('Invalid link', 'This link is missing information.');

  const st = await OAuthState.findOne({ state: String(query.state) });
  if (!st) return fail('Link expired', 'This link has expired or was already used.');
  if (st.pending?.robloxId) return confirmPage(st); // page was refreshed

  // Authorization codes live for ONE minute and work once - exchange immediately.
  const tokenRes = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(query.code),
      code_verifier: st.codeVerifier,
      client_id: config.roblox.clientId,
      client_secret: config.roblox.clientSecret,
    }),
    signal: TIMEOUT(),
  });
  if (!tokenRes.ok) {
    log.warn(`token exchange failed: HTTP ${tokenRes.status}`);
    return fail('Link failed', 'Roblox would not complete the sign-in. The code may have expired - try again.');
  }
  const tokens = await tokenRes.json();

  const infoRes = await fetch(USERINFO, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: TIMEOUT() });
  if (!infoRes.ok) return fail('Link failed', 'Could not read your Roblox profile.');
  const info = await infoRes.json();

  // We only needed your identity once - revoke so nothing lingers.
  if (tokens.refresh_token) {
    fetch(REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokens.refresh_token, client_id: config.roblox.clientId, client_secret: config.roblox.clientSecret }),
      signal: TIMEOUT(),
    }).catch(() => {});
  }

  if (!info.sub) return fail('Link failed', 'Roblox did not return an account ID.');
  st.pending = {
    robloxId: String(info.sub),
    robloxName: info.preferred_username ?? String(info.sub),
    displayName: info.nickname ?? info.name ?? info.preferred_username,
    avatarUrl: info.picture ?? undefined,
  };
  await st.save();
  return confirmPage(st);
}

/* ---------------------------- step 3: user confirms -------------------------- */

async function applyRole(discordId, add) {
  try {
    const cfg = await GuildConfig.findOne({ guildId: config.guildId });
    if (!cfg?.verifiedRoleId) return;
    const guild = client.guilds.cache.get(config.guildId);
    const member = await guild?.members.fetch(discordId);
    if (!member) return;
    if (add) await member.roles.add(cfg.verifiedRoleId, 'Linked Roblox account');
    else await member.roles.remove(cfg.verifiedRoleId, 'Unlinked Roblox account');
  } catch (err) {
    log.warn(`could not update verified role for ${discordId}: ${err.message}`);
  }
}

async function handleConfirm(form) {
  const st = await OAuthState.findOneAndDelete({ state: String(form.state ?? ''), 'pending.robloxId': { $exists: true } });
  if (!st) return fail('Link expired', 'This confirmation has expired or was already used.');
  const p = st.pending;

  try {
    await RobloxLink.findOneAndUpdate(
      { discordId: st.discordId },
      { $set: { robloxId: p.robloxId, robloxName: p.robloxName, displayName: p.displayName, avatarUrl: p.avatarUrl } },
      { upsert: true, new: true },
    );
  } catch (err) {
    if (err.code === 11000) {
      return fail('Already linked', `Roblox account @${p.robloxName} is already linked to a different Discord account. Ask staff to unlink it first.`);
    }
    throw err;
  }

  await applyRole(st.discordId, true);
  client.users.fetch(st.discordId)
    .then((u) => u.send({ embeds: [embeds.success(`Your Discord account is now linked to Roblox account **${p.robloxName}**.`, 'Roblox linked')] }))
    .catch(() => {});

  log.info(`linked discord ${st.discordId} -> roblox ${p.robloxId} (${p.robloxName})`);
  return page(200, 'Accounts linked ✅', `<p>Roblox <b>@${esc(p.robloxName)}</b> is now linked to your Discord account.</p><p>You can close this tab.</p>`);
}

/* --------------------------------- lookups ----------------------------------- */

const getLink = (discordId) => RobloxLink.findOne({ discordId });

function findByRoblox(query) {
  const q = query.trim().replace(/^@/, '');
  if (/^\d+$/.test(q)) return RobloxLink.findOne({ robloxId: q });
  return RobloxLink.findOne({ robloxName: new RegExp(`^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
}

async function unlink(discordId) {
  const removed = await RobloxLink.findOneAndDelete({ discordId });
  if (removed) await applyRole(discordId, false);
  return removed;
}

/* -------------------------------- panel UI ----------------------------------- */

const EPHEMERAL = MessageFlags.Ephemeral;

/** The buttons under the verification panel. Handled by components/roblox/panel.js */
function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('roblox:link').setLabel('Link Roblox Account').setEmoji('🔗').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('roblox:me').setLabel('My Account').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('roblox:unlink').setLabel('Unlink').setStyle(ButtonStyle.Danger),
  );
}

function panelEmbed(title, description) {
  return embeds.make(
    embeds.colors.info,
    title || 'Verify with Roblox',
    (description || 'Link your Roblox account to your Discord account.\n\n**1.** Click **Link Roblox Account**\n**2.** Sign in to Roblox and approve\n**3.** Confirm on the page that opens\n\nWe only see your Roblox username and ID - never your password.').replace(/\\n/g, '\n'),
  );
}

function linkEmbed(l, title = 'Roblox account') {
  const e = embeds.info(
    `**${l.displayName || l.robloxName}** (@${l.robloxName})\nID: \`${l.robloxId}\`\n[View profile](${profileUrl(l.robloxId)})\nLinked <t:${Math.floor(new Date(l.createdAt).getTime() / 1000)}:R>`,
    title,
  );
  if (l.avatarUrl) e.setThumbnail(l.avatarUrl);
  return e;
}

/** Private reply payload with a one-time Roblox sign-in button for this user. */
async function linkPrompt(user) {
  if (!config.roblox.enabled) {
    return { embeds: [embeds.error('Roblox linking is not set up yet. Please tell an admin.')], flags: EPHEMERAL };
  }
  const existing = await getLink(user.id);
  const url = await beginLink(user);
  const intro = existing
    ? `You're currently linked to **${existing.robloxName}**. Continuing will replace it.`
    : 'Press the button below to sign in to Roblox.';
  return {
    embeds: [embeds.info(`${intro}\n\nThis button is private to you and expires in 10 minutes. **Don't share it.**`, 'Link your Roblox account')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Connect Roblox account').setStyle(ButtonStyle.Link).setURL(url),
    )],
    flags: EPHEMERAL,
  };
}

module.exports = {
  beginLink, handleCallback, handleConfirm, getLink, findByRoblox, unlink, profileUrl,
  panelRow, panelEmbed, linkEmbed, linkPrompt,
};
