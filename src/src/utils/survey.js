/**
 * Opening survey + per-user preferences.
 *
 * First DM from a user with no open ticket:
 *   1. their message is parked in the DB (PendingTicket) so nothing is lost
 *   2. they get a Components V2 card with a "Fill out form" button
 *   3. the button opens a form (summary of the issue + extra info)
 *   4. on submit the ticket is created and the parked messages are relayed
 */
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, LabelBuilder, MessageFlags,
  ModalBuilder, SeparatorBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const PendingTicket = require('../models/PendingTicket');
const UserPref = require('../models/UserPref');
const embeds = require('./embeds');
const att = require('./attachments');

const REPROMPT_MS = 10 * 60 * 1000;

/* ------------------------------- pending DMs -------------------------------- */

async function addPending(message) {
  return PendingTicket.findOneAndUpdate(
    { userId: message.author.id },
    { $push: { messages: { content: message.content, attachments: [...message.attachments.values()].map(att.toStored), at: new Date() } } },
    { upsert: true, new: true },
  );
}

const shouldPrompt = (pending) => !pending.promptedAt || Date.now() - pending.promptedAt.getTime() > REPROMPT_MS;
const markPrompted = (userId) => PendingTicket.updateOne({ userId }, { $set: { promptedAt: new Date() } });
const takePending = (userId) => PendingTicket.findOneAndDelete({ userId });

/* ------------------------------ the form (V2) -------------------------------- */

/** Components V2 card DM'd to the user. Button id: mm:survey */
function promptPayload() {
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## 📨 Contact the staff team\nBefore we open a ticket, please tell us a little about what you need.\n\nYour message has been saved - it will be sent to staff as soon as you submit the form.',
    ))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mm:survey').setLabel('Fill out form').setEmoji('📝').setStyle(ButtonStyle.Primary),
    ));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/** The form itself: a free-text summary and an optional extra-info box. Submit id: mm:survey:form */
function formModal() {
  return new ModalBuilder()
    .setCustomId('mm:survey:form')
    .setTitle('Contact staff')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Summary of your issue')
        .setDescription('What do you need help with?')
        .setTextInputComponent(new TextInputBuilder().setCustomId('summary').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(5).setMaxLength(1000)),
      new LabelBuilder()
        .setLabel('Extra info / background')
        .setDescription('Anything else we should know? (optional)')
        .setTextInputComponent(new TextInputBuilder().setCustomId('extra').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
    );
}

/* -------------------------------- reactions --------------------------------- */

const reactionsEnabled = async (userId) => (await UserPref.findOne({ userId }).lean())?.reactions !== false;

async function setReactions(userId, value) {
  await UserPref.updateOne({ userId }, { $set: { reactions: value } }, { upsert: true });
  return value;
}

/** Toggle button shown on the "thread opened" panel and after /reactions */
const reactionsRow = (enabled) => new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('mm:reactions')
    .setLabel(enabled ? 'Reactions: ON - tap to turn off' : 'Reactions: OFF - tap to turn on')
    .setEmoji(enabled ? '✅' : '🔕')
    .setStyle(enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
);

/** The panel the user sees once their ticket is open. */
async function openedPayload(userId, greeting) {
  return {
    embeds: [embeds.success(greeting || 'Your message was sent to the staff team. They will reply here soon.', 'Thread opened')],
    components: [reactionsRow(await reactionsEnabled(userId))],
  };
}

module.exports = {
  addPending, shouldPrompt, markPrompted, takePending,
  promptPayload, formModal,
  reactionsEnabled, setReactions, reactionsRow, openedPayload,
};
