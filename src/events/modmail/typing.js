const { Events } = require('discord.js');
const Thread = require('../../models/Thread');
const client = require('../../core/client');

// Shows "typing..." on the other side: user typing in DMs -> shows in the thread channel,
// staff typing in a thread channel -> shows in the user's DMs. (Throttled: a typing indicator lasts ~10s.)
const last = new Map();
const THROTTLE_MS = 7000;

module.exports = {
  name: Events.TypingStart,
  async execute(typing) {
    if (typing.user?.bot) return;
    const now = Date.now();
    const key = typing.channel.id;
    if (now - (last.get(key) ?? 0) < THROTTLE_MS) return;
    last.set(key, now);
    if (last.size > 500) for (const [k, t] of last) if (now - t > 60000) last.delete(k);

    if (!typing.inGuild()) {
      const thread = await Thread.findOne({ userId: typing.user.id, status: 'open' }).lean();
      if (!thread) return;
      const channel = client.channels.cache.get(thread.channelId) ?? (await client.channels.fetch(thread.channelId).catch(() => null));
      await channel?.sendTyping().catch(() => {});
    } else {
      const thread = await Thread.findOne({ channelId: typing.channel.id, status: 'open' }).lean();
      if (!thread) return;
      const user = await client.users.fetch(thread.userId).catch(() => null);
      const dm = await user?.createDM().catch(() => null);
      await dm?.sendTyping().catch(() => {});
    }
  },
};
