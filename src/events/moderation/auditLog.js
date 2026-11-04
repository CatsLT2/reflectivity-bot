const { Events, AuditLogEvent } = require('discord.js');
const client = require('../../core/client');
const config = require('../../config');
const mod = require('../../utils/moderation');
const log = require('../../utils/logger')('modlog');

// Records kicks / bans / unbans done BY HAND in Discord (right-click -> Ban, another bot, ...) so they
// show up on the admin website too. Needs the bot to have "View Audit Log". Our own slash commands are skipped
// (they already recorded themselves).
const WATCH = {
  [AuditLogEvent.MemberKick]: 'kick',
  [AuditLogEvent.MemberBanAdd]: 'ban',
  [AuditLogEvent.MemberBanRemove]: 'unban',
};

module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  async execute(entry, guild) {
    const type = WATCH[entry.action];
    if (!type || guild.id !== config.guildId || !entry.targetId) return;
    if (entry.executorId === client.user.id) return;

    const user = entry.target ?? (await client.users.fetch(entry.targetId).catch(() => null)) ?? { id: entry.targetId, username: 'unknown' };
    const moderator = entry.executor ?? (entry.executorId ? await client.users.fetch(entry.executorId).catch(() => null) : null);
    const c = await mod.createCase({ guildId: guild.id, type, user, moderator, reason: entry.reason || 'No reason provided', source: 'discord' });
    log.info(`recorded manual ${type} of ${user.username ?? user.id} as case #${c.caseNumber}`);
  },
};
