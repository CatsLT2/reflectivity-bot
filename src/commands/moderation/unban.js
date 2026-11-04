const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const mod = require('../../utils/moderation');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban').setDescription('Unban a user (recorded on the admin website)')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('user_id').setDescription('The banned user\'s Discord ID').setRequired(true).setMinLength(15).setMaxLength(22))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(1000)),

  async execute(interaction) {
    if (!(await mod.requirePerm(interaction, PermissionFlagsBits.BanMembers, 'Ban Members'))) return;
    const id = interaction.options.getString('user_id', true).trim();
    const reason = interaction.options.getString('reason', true);
    if (!/^\d{15,22}$/.test(id)) return interaction.reply({ embeds: [embeds.error('That doesn\'t look like a Discord ID.')], flags: MessageFlags.Ephemeral });

    await interaction.deferReply();
    const ban = await interaction.guild.bans.fetch(id).catch(() => null);
    if (!ban) return interaction.editReply({ embeds: [embeds.error('That user isn\'t banned.')] });
    try {
      await interaction.guild.bans.remove(id, `${interaction.user.username}: ${reason}`.slice(0, 512));
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error(`I couldn't unban them: ${err.message}`)] });
    }
    const c = await mod.createCase({ guildId: interaction.guildId, type: 'unban', user: ban.user, moderator: interaction.user, reason });
    await interaction.editReply({ embeds: [mod.caseEmbed(c, ban.user)] });
  },
};
