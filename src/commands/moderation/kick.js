const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const mod = require('../../utils/moderation');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick').setDescription('Kick a member (recorded on the admin website)')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(1000)),

  async execute(interaction) {
    if (!(await mod.requirePerm(interaction, PermissionFlagsBits.KickMembers, 'Kick Members'))) return;
    const user = interaction.options.getUser('user', true);
    const member = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason', true);
    if (!member) return interaction.reply({ embeds: [embeds.error("That user isn't in the server.")], flags: MessageFlags.Ephemeral });
    const blocked = mod.blockReason(interaction, user, member, 'kick');
    if (blocked) return interaction.reply({ embeds: [embeds.error(blocked)], flags: MessageFlags.Ephemeral });

    await interaction.deferReply();
    const c = await mod.createCase({ guildId: interaction.guildId, type: 'kick', user, moderator: interaction.user, reason });
    const dmed = await mod.notifyUser(user, { type: 'kick', guildName: interaction.guild.name, reason, caseNumber: c.caseNumber }); // before they're gone
    try {
      await member.kick(`${interaction.user.username}: ${reason}`.slice(0, 512));
    } catch (err) {
      await c.deleteOne();
      return interaction.editReply({ embeds: [embeds.error(`I couldn't kick them: ${err.message}`)] });
    }
    await interaction.editReply({ embeds: [mod.caseEmbed(c, user).setFooter({ text: dmed ? 'User was notified by DM' : "Couldn't DM the user" })] });
  },
};
