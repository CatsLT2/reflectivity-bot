const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const mm = require('../../utils/modmail');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Reply to the user in this modmail thread (shortcuts: !r  and  !an for anonymous)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('message').setDescription('What to send').setMaxLength(4000))
    .addBooleanOption((o) => o.setName('anonymous').setDescription('Hide your name from the user'))
    .addAttachmentOption((o) => o.setName('attachment').setDescription('Image or file to include')),

  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction, { enforceClaim: true });
    if (!ctx) return;

    const message = interaction.options.getString('message');
    const attachment = interaction.options.getAttachment('attachment');
    if (!message && !attachment) {
      return interaction.reply({ embeds: [embeds.error('Provide a message, an attachment, or both.')], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();
    try {
      const { embed, files, dmMessageId } = await mm.replyToUser(ctx.thread, interaction.user, message, {
        anonymous: interaction.options.getBoolean('anonymous') ?? false,
        attachments: attachment ? [attachment] : [],
      });
      const echo = await interaction.editReply({ embeds: [embed], files });
      await mm.recordEcho(ctx.thread, dmMessageId, echo.id);
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(`Couldn't deliver that message.\n${mm.describeSendError(err)}`)] });
    }
  },
};
