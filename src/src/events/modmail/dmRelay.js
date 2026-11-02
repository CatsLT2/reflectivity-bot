const { Events } = require('discord.js');
const config = require('../../config');
const mm = require('../../utils/modmail');
const survey = require('../../utils/survey');
const embeds = require('../../utils/embeds');
const log = require('../../utils/logger')('modmail');

const reject = (message, text) => message.reply({ embeds: [embeds.error(text)] }).catch(() => {});

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || message.guild) return; // DMs from real users only

    const guild = message.client.guilds.cache.get(config.guildId);
    if (!guild) return;

    try {
      const cfg = await mm.getConfig(guild.id);
      if (!mm.isConfigured(cfg)) return void reject(message, 'Modmail is not available right now.');
      if (cfg.blocked.some((b) => b.userId === message.author.id)) return void reject(message, 'You are not able to use modmail.');

      const open = await mm.findOpenThread(message.author.id);

      // No ticket yet and the opening form is on: park the message and ask for a short summary first.
      if (!open && cfg.surveyEnabled !== false) {
        const pending = await survey.addPending(message);
        if (survey.shouldPrompt(pending)) {
          await message.channel.send(survey.promptPayload());
          await survey.markPrompted(message.author.id);
        }
        return;
      }

      const { thread, channel, created } = await mm.getOrCreateThread({ user: message.author, guild, cfg });
      await mm.relayUserMessage(mm.normaliseMessage(message), thread, channel);

      if (created) await message.channel.send(await survey.openedPayload(message.author.id, cfg.greeting));
      if (await survey.reactionsEnabled(message.author.id)) await message.react('✅').catch(() => {});
    } catch (err) {
      log.error('failed to relay DM:', err);
      await message.react('❌').catch(() => {});
    }
  },
};
