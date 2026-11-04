const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const mod = require('../../utils/moderation');
const embeds = require('../../utils/embeds');

const ICON = { warn: '⚠️', kick: '👢', ban: '🔨', unban: '✅' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cases').setDescription("Show a member's warns, kicks and bans (10 per page)")
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),

  async execute(interaction) {
    if (!(await mod.requirePerm(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;
    const user = interaction.options.getUser('user', true);
    const [sum, list] = await Promise.all([
      mod.userSummary(interaction.guildId, user.id),
      mod.listCases(interaction.guildId, user.id, { page: interaction.options.getInteger('page') ?? 1 }),
    ]);
    const lines = list.cases.map((c) =>
      `${ICON[c.type]} **#${c.caseNumber}** ${mod.LABEL[c.type]}${c.pardoned ? ' *(pardoned)*' : ''} - <t:${Math.floor(new Date(c.createdAt).getTime() / 1000)}:d> by ${c.moderatorId ? `<@${c.moderatorId}>` : c.moderatorName}\n> ${c.reason.slice(0, 150)}`);
    await interaction.reply({
      embeds: [embeds.info(lines.join('\n') || 'No moderation history.', `${user.username}${sum.banned ? ' - currently banned' : ''}`)
        .setFooter({ text: `${sum.warns} warn(s) • ${sum.kicks} kick(s) • ${sum.bans} ban(s) • page ${list.page}/${list.pages}` })],
      flags: MessageFlags.Ephemeral,
    });
  },
};
