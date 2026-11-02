const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const mm = require('../../utils/modmail');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close this modmail thread')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('reason').setDescription('Why it is being closed').setMaxLength(500)),

  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction, { enforceClaim: true });
    if (!ctx) return;

    await interaction.deferReply();
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const ok = await mm.closeThread(ctx.thread, interaction.user, reason);
    await interaction.editReply({
      embeds: [ok
        ? embeds.success('Thread closed. Transcript and attachments saved. This channel will be deleted in 5 seconds.')
        : embeds.error('That thread was already closed.')],
    });
  },
};
