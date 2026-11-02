const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const mm = require('../../utils/modmail');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit')
    .setDescription('Edit your last reply (only works while it is the most recent staff message)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('message').setDescription('The new text').setRequired(true).setMaxLength(4000)),

  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction, { enforceClaim: true });
    if (!ctx) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const res = await mm.editLastReply(ctx.thread, interaction.user, interaction.options.getString('message', true));
      return interaction.editReply({ embeds: [res.ok ? embeds.success('Edited in the user\'s DMs and in this channel.') : embeds.error(res.reason)] });
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error(`Couldn't edit it: ${err.message}`)] });
    }
  },
};
