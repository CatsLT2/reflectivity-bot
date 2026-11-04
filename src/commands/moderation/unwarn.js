const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Case = require('../../models/Case');
const mod = require('../../utils/moderation');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unwarn').setDescription('Remove a warning (it stays in the history, marked as pardoned)')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((o) => o.setName('case').setDescription('Case number of the warning').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription('Why it is being removed').setMaxLength(500)),

  async execute(interaction) {
    if (!(await mod.requirePerm(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;
    const number = interaction.options.getInteger('case', true);
    const c = await Case.findOneAndUpdate(
      { guildId: interaction.guildId, caseNumber: number, type: 'warn', pardoned: { $ne: true } },
      { $set: { pardoned: true, pardonedBy: interaction.user.id, pardonedAt: new Date(), pardonReason: interaction.options.getString('reason') ?? undefined } },
      { new: true },
    );
    if (!c) return interaction.reply({ embeds: [embeds.error(`No active warning with case number ${number}.`)], flags: MessageFlags.Ephemeral });
    await interaction.reply({ embeds: [embeds.success(`Warning **#${number}** for <@${c.userId}> was removed.`)] });
  },
};
