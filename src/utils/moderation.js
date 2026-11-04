/** Moderation cases (warn / kick / ban / unban) and the search used by the admin site + API. */
const { EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const client = require('../core/client');
const Case = require('../models/Case');
const Counter = require('../models/Counter');
const RobloxLink = require('../models/RobloxLink');
const embeds = require('./embeds');

const PAGE_SIZE = 10; // people / cases per page - fixed on purpose, never taken from a request
const TYPES = ['warn', 'kick', 'ban', 'unban'];
const LABEL = { warn: 'Warn', kick: 'Kick', ban: 'Ban', unban: 'Unban' };
const COLOR = { warn: 0xf1c40f, kick: 0xe67e22, ban: 0xed4245, unban: 0x57f287 };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------------------------------- cases ---------------------------------- */

async function nextCaseNumber(guildId) {
  const c = await Counter.findOneAndUpdate({ _id: `case:${guildId}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return c.seq;
}

/** user = anything with { id, username }. moderator likewise (or null for "unknown"). */
async function createCase({ guildId, type, user, moderator, reason, source = 'bot' }) {
  return Case.create({
    guildId, type, caseNumber: await nextCaseNumber(guildId),
    userId: user.id, userTag: user.username ?? user.tag ?? 'unknown',
    moderatorId: moderator?.id, moderatorName: moderator?.username ?? 'Unknown',
    reason: String(reason || 'No reason provided').slice(0, 1000), source,
  });
}

const caseEmbed = (c, user) => new EmbedBuilder()
  .setColor(COLOR[c.type]).setTitle(`Case #${c.caseNumber} - ${LABEL[c.type]}`)
  .addFields(
    { name: 'User', value: `${user ?? `<@${c.userId}>`} (\`${c.userId}\`)`, inline: true },
    { name: 'Moderator', value: c.moderatorId ? `<@${c.moderatorId}>` : c.moderatorName, inline: true },
    { name: 'Reason', value: c.reason.slice(0, 1024) },
  ).setTimestamp(c.createdAt);

/** Best-effort DM. Never throws. */
async function notifyUser(user, { type, guildName, reason, caseNumber }) {
  const verb = { warn: 'warned in', kick: 'kicked from', ban: 'banned from', unban: 'unbanned in' }[type];
  try {
    await user.send({ embeds: [new EmbedBuilder().setColor(COLOR[type]).setTitle(`You were ${verb} ${guildName}`)
      .addFields({ name: 'Reason', value: String(reason).slice(0, 1024) }).setFooter({ text: `Case #${caseNumber}` })] });
    return true;
  } catch { return false; }
}

/** Why this moderator can't act on this target, or null if fine. */
function blockReason(interaction, user, member, action) {
  const guild = interaction.guild;
  if (user.id === interaction.user.id) return `You can't ${action} yourself.`;
  if (user.id === client.user.id) return `I can't ${action} myself.`;
  if (user.id === guild.ownerId) return `You can't ${action} the server owner.`;
  if (member) {
    if (interaction.user.id !== guild.ownerId && member.roles.highest.position >= interaction.member.roles.highest.position) {
      return `You can't ${action} someone whose highest role is equal to or above yours.`;
    }
    if (action === 'kick' && !member.kickable) return "I can't kick them - my role must be above theirs.";
    if (action === 'ban' && !member.bannable) return "I can't ban them - my role must be above theirs.";
  }
  return null;
}

const requirePerm = async (interaction, perm, name) => {
  if (interaction.memberPermissions.has(perm)) return true;
  await interaction.reply({ embeds: [embeds.error(`You need the **${name}** permission.`)], flags: 64 });
  return false;
};

/* ---------------------------- listing / searching ---------------------------- */

/**
 * Turns a search box value into { ids, nameRe }:
 *   17-20 digits or <@mention>  -> Discord ID
 *   shorter number              -> Roblox user ID (resolved through linked accounts)
 *   text                        -> Discord username (as stored on cases) OR linked Roblox username / display name
 */
async function resolveSearch(raw) {
  const q = String(raw ?? '').trim().slice(0, 40);
  if (!q) return { empty: true, ids: [], nameRe: null };
  const mention = q.match(/^<@!?(\d{15,22})>$/);
  if (mention) return { ids: [mention[1]], nameRe: null, kind: 'discord-id' };
  if (/^\d{15,22}$/.test(q)) return { ids: [q], nameRe: null, kind: 'discord-id' };
  if (/^\d{1,14}$/.test(q)) {
    const links = await RobloxLink.find({ robloxId: q }).limit(5).lean();
    return { ids: links.map((l) => l.discordId), nameRe: null, kind: 'roblox-id' };
  }
  const re = new RegExp(escapeRegex(q.replace(/^@/, '')), 'i');
  const links = await RobloxLink.find({ $or: [{ robloxName: re }, { displayName: re }] }).limit(50).lean();
  return { ids: links.map((l) => l.discordId), nameRe: re, kind: 'name' };
}

function caseFilter(guildId, { type, search }) {
  const f = { guildId };
  if (TYPES.includes(type)) f.type = type;
  if (search && !search.empty) {
    const or = [];
    if (search.ids.length) or.push({ userId: { $in: search.ids } });
    if (search.nameRe) or.push({ userTag: search.nameRe });
    f.$or = or.length ? or : [{ _id: null }]; // nothing matched -> nothing returned
  }
  return f;
}

/** One page (10) of PEOPLE with their warn / kick / ban counts. */
async function listPeople(guildId, { q, type, page = 1 }) {
  const search = await resolveSearch(q);
  const match = caseFilter(guildId, { type, search });
  const skip = (Math.max(1, page) - 1) * PAGE_SIZE;
  const count = (t, extra = {}) => ({ $sum: { $cond: [{ $and: [{ $eq: ['$type', t] }, ...(extra.activeOnly ? [{ $ne: ['$pardoned', true] }] : [])] }, 1, 0] } });

  const [res] = await Case.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $group: {
      _id: '$userId', name: { $first: '$userTag' }, last: { $first: '$createdAt' }, lastType: { $first: '$type' },
      warns: count('warn', { activeOnly: true }), kicks: count('kick'), bans: count('ban'), cases: { $sum: 1 },
    } },
    { $sort: { last: -1, _id: 1 } },
    { $facet: { rows: [{ $skip: skip }, { $limit: PAGE_SIZE }], total: [{ $count: 'n' }] } },
  ]);
  const total = res?.total?.[0]?.n ?? 0;
  const rows = res?.rows ?? [];

  // Roblox links for just these <=10 people (one small query)
  const links = rows.length ? await RobloxLink.find({ discordId: { $in: rows.map((r) => r._id) } }).lean() : [];
  const byId = new Map(links.map((l) => [l.discordId, l]));
  return {
    search, total, page: Math.max(1, page), pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    people: rows.map((r) => ({ ...r, userId: r._id, roblox: byId.get(r._id) ?? null })),
  };
}

/** Totals for the dashboard header (3 cheap counts). */
async function totals(guildId) {
  const [warns, kicks, bans] = await Promise.all(['warn', 'kick', 'ban'].map((t) =>
    Case.countDocuments({ guildId, type: t, ...(t === 'warn' ? { pardoned: { $ne: true } } : {}) })));
  return { warns, kicks, bans };
}

/** Per-user counts + "is currently banned" (last ban/unban decides). */
async function userSummary(guildId, userId) {
  const [warns, kicks, bans, unbans, lastBanEvent] = await Promise.all([
    Case.countDocuments({ guildId, userId, type: 'warn', pardoned: { $ne: true } }),
    Case.countDocuments({ guildId, userId, type: 'kick' }),
    Case.countDocuments({ guildId, userId, type: 'ban' }),
    Case.countDocuments({ guildId, userId, type: 'unban' }),
    Case.findOne({ guildId, userId, type: { $in: ['ban', 'unban'] } }).sort({ createdAt: -1 }).lean(),
  ]);
  return { warns, kicks, bans, unbans, banned: lastBanEvent?.type === 'ban' };
}

/** One page (10) of a person's cases, newest first. */
async function listCases(guildId, userId, { type, page = 1 } = {}) {
  const filter = { guildId, userId, ...(TYPES.includes(type) ? { type } : {}) };
  const [total, cases] = await Promise.all([
    Case.countDocuments(filter),
    Case.find(filter).sort({ createdAt: -1 }).skip((Math.max(1, page) - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
  ]);
  return { total, cases, page: Math.max(1, page), pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

module.exports = {
  PAGE_SIZE, TYPES, LABEL, COLOR, escapeRegex,
  createCase, caseEmbed, notifyUser, blockReason, requirePerm,
  resolveSearch, listPeople, totals, userSummary, listCases, P,
};
