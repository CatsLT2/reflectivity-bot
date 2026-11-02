const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const mm = require('../../utils/modmail');
const aliases = require('../../utils/aliases');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('a')
    .setDescription('Run a saved alias in this modmail thread')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('name').setDescription('Alias to run').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('args').setDescription('Extra text, available as {args} in the alias').setMaxLength(1000)),

  autocomplete: aliases.autocomplete,

  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction);
    if (!ctx) return;

    const alias = await aliases.find(interaction.guildId, interaction.options.getString('name', true));
    if (!alias) {
      return interaction.reply({ embeds: [embeds.error('No alias with that name. Use `/alias list`.')], flags: MessageFlags.Ephemeral });
    }
    if (aliases.needsClaimCheck(alias)) {
      const blocked = mm.claimBlock(ctx.thread, interaction);
      if (blocked) return interaction.reply({ embeds: [embeds.error(blocked)], flags: MessageFlags.Ephemeral });
    }
    return aliases.run(interaction, ctx.thread, alias, interaction.options.getString('args'));
  },
};
