const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const mm = require('../../utils/modmail');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unclaim')
    .setDescription('Release your claim on this thread')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction);
    if (ctx) await mm.handleUnclaim(interaction, ctx.thread);
  },
};
