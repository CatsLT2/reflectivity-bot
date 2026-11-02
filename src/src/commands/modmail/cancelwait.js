const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const mm = require('../../utils/modmail');
const Task = require('../../models/Task');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelwait')
    .setDescription('Cancel any pending waits / auto-closes on this thread')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction);
    if (!ctx) return;
    const res = await Task.updateMany({ threadId: ctx.thread._id, status: 'pending' }, { $set: { status: 'cancelled' } });
    await interaction.reply({ embeds: [res.modifiedCount
      ? embeds.success(`${interaction.user} cancelled ${res.modifiedCount} pending wait(s) on this thread.`)
      : embeds.info('There was nothing waiting on this thread.')] });
  },
};
