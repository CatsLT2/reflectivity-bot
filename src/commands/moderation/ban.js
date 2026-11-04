const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const mod = require('../../utils/moderation');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban').setDescription('Ban a user (recorded on the admin website)')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(1000))
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Also delete their messages from the last N days (0-7)').setMinValue(0).setMaxValue(7)),

  async execute(interaction) {
    if (!(await mod.requirePerm(interaction, PermissionFlagsBits.BanMembers, 'Ban Members'))) return;
    const user = interaction.options.getUser('user', true);
    const member = interaction.options.getMember('user'); // null if they already left - bans still work
    const reason = interaction.options.getString('reason', true);
    const blocked = mod.blockReason(interaction, user, member, 'ban');
    if (blocked) return interaction.reply({ embeds: [embeds.error(blocked)], flags: MessageFlags.Ephemeral });

    await interaction.deferReply();
    const c = await mod.createCase({ guildId: interaction.guildId, type: 'ban', user, moderator: interaction.user, reason });
    const dmed = await mod.notifyUser(user, { type: 'ban', guildName: interaction.guild.name, reason, caseNumber: c.caseNumber }); // before they're gone
    try {
      await interaction.guild.members.ban(user.id, {
        reason: `${interaction.user.username}: ${reason}`.slice(0, 512),
        deleteMessageSeconds: (interaction.options.getInteger('delete_days') ?? 0) * 86400,
      });
    } catch (err) {
      await c.deleteOne();
      return interaction.editReply({ embeds: [embeds.error(`I couldn't ban them: ${err.message}`)] });
    }
    await interaction.editReply({ embeds: [mod.caseEmbed(c, user).setFooter({ text: dmed ? 'User was notified by DM' : "Couldn't DM the user" })] });
  },
};
