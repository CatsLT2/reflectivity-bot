const { MessageFlags } = require('discord.js');
const config = require('../../config');
const mm = require('../../utils/modmail');
const survey = require('../../utils/survey');
const embeds = require('../../utils/embeds');

const priv = (embed) => ({ embeds: [embed], flags: MessageFlags.Ephemeral });

// DM flow.  button mm:survey -> opens the form.  form mm:survey:form -> creates the ticket.
module.exports = {
  id: 'mm:survey',
  async execute(interaction) {
    if (!interaction.isModalSubmit()) return interaction.showModal(survey.formModal());

    const summary = interaction.fields.getTextInputValue('summary').trim();
    const extra = interaction.fields.getTextInputValue('extra').trim();

    const guild = interaction.client.guilds.cache.get(config.guildId);
    const cfg = guild && (await mm.getConfig(guild.id));
    if (!guild || !mm.isConfigured(cfg)) return interaction.reply(priv(embeds.error('Modmail is not available right now.')));
    if (cfg.blocked.some((b) => b.userId === interaction.user.id)) return interaction.reply(priv(embeds.error('You are not able to use modmail.')));

    await interaction.deferReply();
    const pending = await survey.takePending(interaction.user.id);
    const { thread, channel, created } = await mm.getOrCreateThread({ user: interaction.user, guild, cfg, survey: { summary, extra } });

    // Relay everything they sent while filling in the form (or, for an existing ticket, the form text itself).
    const user = interaction.user;
    for (const m of pending?.messages ?? []) {
      await mm.relayUserMessage({
        authorId: user.id, authorName: user.username, authorAvatar: user.displayAvatarURL(),
        content: m.content, attachments: m.attachments,
      }, thread, channel);
    }
    if (!created) {
      await mm.relayUserMessage({
        authorId: user.id, authorName: user.username, authorAvatar: user.displayAvatarURL(),
        content: `**Summary:** ${summary}${extra ? `\n**Extra info:** ${extra}` : ''}`, attachments: [],
      }, thread, channel);
    }
    return interaction.editReply(await survey.openedPayload(user.id, cfg.greeting));
  },
};
