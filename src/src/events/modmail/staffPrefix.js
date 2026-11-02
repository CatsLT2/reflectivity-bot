const { Events } = require('discord.js');
const mm = require('../../utils/modmail');
const embeds = require('../../utils/embeds');

/**
 * Staff shortcuts inside a modmail thread channel (no slash command needed):
 *   !r  <text>   reply to the user (your name shown)
 *   !an <text>   reply anonymously ("Staff Team")
 * Attach files to the message to send them too. Needs the Message Content Intent.
 */
module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.bot) return;
    const match = message.content.match(/^!(r|an)(?:\s+([\s\S]*))?$/i);
    if (!match) return;

    const thread = await mm.findThreadByChannel(message.channelId);
    if (!thread) return; // not a modmail channel - ignore
    const cfg = await mm.getConfig(message.guildId);
    if (!mm.isStaff(message.member, cfg)) return;

    const fail = (text) => message.reply({ embeds: [embeds.error(text)] }).catch(() => {});
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
      await fail(`Couldn't deliver that message.\n${mm.describeSendError(err)}`);
    }
  },
};
