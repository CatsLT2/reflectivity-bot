const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const survey = require('../../utils/survey');
const embeds = require('../../utils/embeds');

// Users run this in their DMs with the bot. `global: true` registers it with Discord globally (DM commands need that).
module.exports = {
  global: true,
  data: new SlashCommandBuilder()
    .setName('reactions')
    .setDescription('Turn the ✅ reaction the bot adds to your messages on or off')
    .setContexts(InteractionContextType.BotDM)
    .addStringOption((o) => o.setName('state').setDescription('Leave empty to toggle').addChoices(
      { name: 'on', value: 'on' }, { name: 'off', value: 'off' })),

  async execute(interaction) {
    const state = interaction.options.getString('state');
    const current = await survey.reactionsEnabled(interaction.user.id);
    const next = state ? state === 'on' : !current;
    await survey.setReactions(interaction.user.id, next);
    await interaction.reply({
      embeds: [embeds.success(next ? 'Reactions are **on**. I\'ll add a ✅ to your messages.' : 'Reactions are **off**. Use the button on your ticket panel (or run `/reactions` again) to turn them back on.')],
      components: [survey.reactionsRow(next)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
