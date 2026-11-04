const { Events, MessageType } = require('discord.js');
const mm = require('../../utils/modmail');
const embeds = require('../../utils/embeds');
const log = require('../../utils/logger')('prefix');

/**
 * Staff shortcuts inside a modmail thread channel (no slash command needed):
 *   !r  <text>   reply to the user (your name shown)
 *   !an <text>   reply anonymously ("Staff Team")
 * Attach files to the message to send them too. Needs the Message Content Intent.
 */
let warnedEmpty = false;

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.bot) return;

    // Without the Message Content Intent Discord sends every guild message with EMPTY text.
    if (!warnedEmpty && message.type === MessageType.Default && !message.content
      && !message.attachments.size && !message.embeds.length && !message.stickers.size) {
      warnedEmpty = true;
      log.warn('Got a guild message with empty text. If !r / !an do nothing, the Message Content Intent is not active: '
        + 'turn it ON in discord.com/developers/applications -> your bot -> Bot tab, make sure MESSAGE_CONTENT is not "false" in .env, then restart.');
    }

    const match = message.content.match(/^!(r|an)(?:\s+([\s\S]*))?$/i);
    if (!match) return;

    const thread = await mm.findThreadByChannel(message.channelId);
    if (!thread) {
      log.info(`ignored "!${match[1]}" from ${message.author.username}: #${message.channel.name} is not an open modmail ticket channel`);
      return;
    }
    const cfg = await mm.getConfig(message.guildId);
    const fail = (text) => message.reply({ embeds: [embeds.error(text)] }).catch(() => {});

    if (!mm.isStaff(message.member, cfg)) {
      log.info(`ignored "!${match[1]}" from ${message.author.username}: not modmail staff`);
      return fail('You need the modmail **staff role** (set with `/modmail setup`) or Administrator to use `!r` / `!an`.');
    }

    const blocked = mm.claimBlock(thread, { user: message.author, memberPermissions: message.member.permissions });
    if (blocked) return fail(blocked);

    const anonymous = match[1].toLowerCase() === 'an';
    const text = (match[2] ?? '').trim();
    const files = [...message.attachments.values()];
    if (!text && !files.length) return fail(`Usage: \`!${anonymous ? 'an' : 'r'} your message\` (you can attach files too).`);

    try {
      const { embed, files: echoFiles, dmMessageId } = await mm.replyToUser(thread, message.author, text, { anonymous, attachments: files });
      const echo = await message.channel.send({ embeds: [embed], files: echoFiles });
      await mm.recordEcho(thread, dmMessageId, echo.id);
      await message.delete().catch(() => {}); // tidy up the command message (needs Manage Messages)
    } catch (err) {
      log.warn(`!${match[1]} failed: ${err.message}`);
      await fail(`Couldn't deliver that message.\n${mm.describeSendError(err)}`);
    }
  },
};
