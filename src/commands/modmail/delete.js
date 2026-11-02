const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const mm = require('../../utils/modmail');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete')
    .setDescription("Delete the last message a staff member sent to the user (removed from their DMs too)")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction, { enforceClaim: true });
    if (!ctx) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const res = await mm.deleteLastReply(ctx.thread, interaction.user);
      if (!res.ok) return interaction.editReply({ embeds: [embeds.error(res.reason)] });
      await interaction.channel.send({ embeds: [embeds.info(`🗑️ ${interaction.user} deleted the last message from **${res.msg.authorName}**.`)] });
      return interaction.editReply({ embeds: [embeds.success('Deleted from the user\'s DMs and this channel.')] });
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error(`Couldn't delete it: ${err.message}`)] });
    }
  },
};
