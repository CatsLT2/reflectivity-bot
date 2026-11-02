const {
  ActionRowBuilder, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const mm = require('../../utils/modmail');
const embeds = require('../../utils/embeds');

// "Close thread" button -> asks for a close reason -> closes.   ids: mm:close  /  mm:close:reason (the form)
module.exports = {
  id: 'mm:close',
  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction, { enforceClaim: true });
    if (!ctx) return;

    if (!interaction.isModalSubmit()) {
      return interaction.showModal(new ModalBuilder().setCustomId('mm:close:reason').setTitle('Close thread').addLabelComponents(
        new LabelBuilder()
          .setLabel('Close reason')
          .setDescription('Shown to the user and saved in the transcript (optional)')
          .setTextInputComponent(new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
      ));
    }

    const reason = interaction.fields.getTextInputValue('reason').trim() || 'No reason provided';
    await interaction.deferReply();
    const ok = await mm.closeThread(ctx.thread, interaction.user, reason);
    await interaction.editReply({
      embeds: [ok
        ? embeds.success(`Thread closed.\n**Reason:** ${reason}\nThis channel will be deleted in 5 seconds.`)
        : embeds.error('Already closed.')],
    });
  },
};
