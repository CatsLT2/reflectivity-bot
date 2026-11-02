const { Events } = require('discord.js');
const Thread = require('../../models/Thread');
const Task = require('../../models/Task');
const log = require('../../utils/logger')('modmail');

// If staff delete a thread channel by hand, retire the thread so the user can open a fresh one.
module.exports = {
  name: Events.ChannelDelete,
  async execute(channel) {
    if (!channel.guild) return;
    const t = await Thread.findOneAndUpdate(
      { channelId: channel.id, status: 'open' },
      { $set: { status: 'closed', closedAt: new Date(), closeReason: 'Channel deleted manually' } },
    );
    if (!t) return;
    await Task.updateMany({ threadId: t._id, status: 'pending' }, { $set: { status: 'cancelled' } });
    log.info(`thread for ${t.username} closed (channel deleted manually)`);
  },
};
