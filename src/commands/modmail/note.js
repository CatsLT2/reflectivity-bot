const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const mm = require('../../utils/modmail');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Add an internal note (the user never sees this)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('text').setDescription('Note').setRequired(true).setMaxLength(2000)),

  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction);
    if (!ctx) return;
    const embed = await mm.addNote(ctx.thread, interaction.user, interaction.options.getString('text', true));
    await interaction.reply({ embeds: [embed] });
  },
};
