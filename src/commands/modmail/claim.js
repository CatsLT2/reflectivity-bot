const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const mm = require('../../utils/modmail');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim this thread so other staff know you are handling it')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction);
    if (ctx) await mm.handleClaim(interaction, ctx.thread);
  },
};
