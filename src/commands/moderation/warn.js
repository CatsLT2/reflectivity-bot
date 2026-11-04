const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const mod = require('../../utils/moderation');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn').setDescription('Warn a member (recorded on the admin website)')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Who to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(1000)),

  async execute(interaction) {
    if (!(await mod.requirePerm(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    if (user.bot) return interaction.reply({ embeds: [embeds.error("You can't warn a bot.")], flags: MessageFlags.Ephemeral });
    const blocked = mod.blockReason(interaction, user, interaction.options.getMember('user'), 'warn');
    if (blocked) return interaction.reply({ embeds: [embeds.error(blocked)], flags: MessageFlags.Ephemeral });

    await interaction.deferReply();
    const c = await mod.createCase({ guildId: interaction.guildId, type: 'warn', user, moderator: interaction.user, reason });
    const dmed = await mod.notifyUser(user, { type: 'warn', guildName: interaction.guild.name, reason, caseNumber: c.caseNumber });
    await interaction.editReply({ embeds: [mod.caseEmbed(c, user).setFooter({ text: dmed ? 'User was notified by DM' : "Couldn't DM the user" })] });
  },
};
