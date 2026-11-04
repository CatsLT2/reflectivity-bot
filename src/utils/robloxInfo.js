/**
 * Public Roblox profile info (no login needed). Best effort: Roblox can rate-limit or change these
 * public endpoints, so every call is optional and anything missing is simply left out.
 */
const { EmbedBuilder } = require('discord.js');
const embeds = require('./embeds');

const cache = new Map(); // robloxId -> { at, data }
const TTL = 10 * 60 * 1000;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchInfo(robloxId) {
  const id = String(robloxId).replace(/\D/g, '');
  if (!id) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const [user, friends, followers, following, groups, thumb] = await Promise.allSettled([
    getJson(`https://users.roblox.com/v1/users/${id}`),
    getJson(`https://friends.roblox.com/v1/users/${id}/friends/count`),
    getJson(`https://friends.roblox.com/v1/users/${id}/followers/count`),
    getJson(`https://friends.roblox.com/v1/users/${id}/followings/count`),
    getJson(`https://groups.roblox.com/v2/users/${id}/groups/roles`),
    getJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=false`),
  ]);
  const v = (r) => (r.status === 'fulfilled' ? r.value : null);
  const u = v(user);
  if (!u?.name) return null; // profile lookup failed - nothing useful to show

  const g = v(groups)?.data ?? null;
  const data = {
    id,
    name: u.name,
    displayName: u.displayName,
    created: u.created,
    description: (u.description ?? '').slice(0, 300),
    banned: Boolean(u.isBanned),
    verified: Boolean(u.hasVerifiedBadge),
    friends: v(friends)?.count,
    followers: v(followers)?.count,
    following: v(following)?.count,
    groupCount: g ? g.length : undefined,
    groups: (g ?? []).slice(0, 10).map((x) => ({ name: x.group?.name, role: x.role?.name })),
    avatar: v(thumb)?.data?.[0]?.imageUrl,
  };
  cache.set(id, { at: Date.now(), data });
  return data;
}

const nameCache = new Map(); // lowercase name -> { id, at }

/** Username -> Roblox user ID via Roblox's public API (cached 5 min, including "not found"). */
async function resolveUsername(name) {
  const key = String(name).toLowerCase();
  const hit = nameCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.id;
  let id = null;
  try {
    const res = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [name], excludeBannedUsers: false }), signal: AbortSignal.timeout(4000),
    });
    if (res.ok) id = (await res.json()).data?.[0]?.id?.toString() ?? null;
  } catch { /* offline / rate limited: treat as not found for now */ }
  if (nameCache.size > 500) nameCache.clear();
  nameCache.set(key, { id, at: Date.now() });
  return id;
}

const num = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : 'n/a');

function infoEmbed(info) {
  const e = new EmbedBuilder().setColor(0xe2231a).setTitle('🎮 Roblox profile')
    .setURL(`https://www.roblox.com/users/${info.id}/profile`);
  const created = info.created ? Math.floor(new Date(info.created).getTime() / 1000) : null;
  e.addFields(
    { name: 'Username', value: `[${info.name}](https://www.roblox.com/users/${info.id}/profile)${info.verified ? ' ✔️' : ''}`, inline: true },
    { name: 'Display name', value: info.displayName || info.name, inline: true },
    { name: 'User ID', value: `\`${info.id}\``, inline: true },
  );
  if (created) e.addFields({ name: 'Account created', value: `<t:${created}:D> (<t:${created}:R>)`, inline: true });
  e.addFields(
    { name: 'Friends', value: num(info.friends), inline: true },
    { name: 'Followers', value: num(info.followers), inline: true },
  );
  if (info.groupCount != null) {
    const names = info.groups.slice(0, 5).map((x) => `${x.name}${x.role ? ` (${x.role})` : ''}`).join('\n');
    e.addFields({ name: `Groups (${info.groupCount})`, value: (names || 'None').slice(0, 1024) });
  }
  if (info.description) e.addFields({ name: 'About', value: info.description.slice(0, 300) });
  if (info.banned) e.addFields({ name: '⚠️ Status', value: 'This Roblox account is banned.' });
  if (info.avatar) e.setThumbnail(info.avatar);
  return e;
}

/** Fields we keep on the ticket so the web transcript can show them later. */
const snapshot = (info) => ({
  id: info.id, name: info.name, displayName: info.displayName, created: info.created, description: info.description,
  friends: info.friends, followers: info.followers, following: info.following, groupCount: info.groupCount,
  groups: info.groups, avatar: info.avatar, banned: info.banned, verified: info.verified,
});

module.exports = { fetchInfo, resolveUsername, infoEmbed, snapshot, embeds };
