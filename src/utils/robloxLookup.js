/** Roblox username / ID  ->  linked Discord account + that person's moderation record. */
const client = require('../core/client');
const RobloxLink = require('../models/RobloxLink');
const robloxInfo = require('./robloxInfo');
const mod = require('./moderation');

const INPUT_RE = /^[A-Za-z0-9_]{1,40}$/; // Roblox usernames are letters, digits and underscores
const isValidInput = (v) => typeof v === 'string' && INPUT_RE.test(v.trim());

async function findLink(input) {
  const s = String(input).trim();
  if (/^\d{1,14}$/.test(s)) return RobloxLink.findOne({ robloxId: s }).lean(); // numbers = Roblox user ID
  const byName = await RobloxLink.findOne({ robloxName: new RegExp(`^${mod.escapeRegex(s)}$`, 'i') }).lean();
  if (byName) return byName;
  // Accounts can be renamed on Roblox, so resolve the name to the permanent ID and try that.
  const id = await robloxInfo.resolveUsername(s);
  return id ? RobloxLink.findOne({ robloxId: id }).lean() : null;
}

const caseJson = (c) => ({
  case: c.caseNumber, type: c.type, reason: c.reason, moderator: c.moderatorName ?? null,
  source: c.source, pardoned: Boolean(c.pardoned), createdAt: new Date(c.createdAt).toISOString(),
});

async function lookup(guildId, input, page = 1) {
  const link = await findLink(input);
  if (!link) return { linked: false, input: String(input) };

  const [summary, list, user] = await Promise.all([
    mod.userSummary(guildId, link.discordId),
    mod.listCases(guildId, link.discordId, { page }),
    client.users.fetch(link.discordId).catch(() => null),
  ]);
  return {
    linked: true,
    roblox: { id: link.robloxId, username: link.robloxName, displayName: link.displayName ?? null },
    discord: { id: link.discordId, username: user?.username ?? null },
    moderation: { warns: summary.warns, kicks: summary.kicks, bans: summary.bans, unbans: summary.unbans, banned: summary.banned },
    cases: list.cases.map(caseJson),
    page: list.page, pageSize: mod.PAGE_SIZE, totalCases: list.total, totalPages: list.pages,
  };
}

module.exports = { lookup, findLink, isValidInput };
