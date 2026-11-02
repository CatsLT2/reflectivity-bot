const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const mm = require('../../utils/modmail');
const aliases = require('../../utils/aliases');
const embeds = require('../../utils/embeds');
const { parseDuration } = require('../../utils/duration');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('waitclose')
    .setDescription('Close this thread after a delay - unless the user replies first')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('time').setDescription('How long to wait, e.g. 30m, 2h, 1d12h (30s - 30d)').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Close reason (default: No response from user)').setMaxLength(500))
    .addStringOption((o) => o.setName('message').setDescription('Message to send the user now, e.g. "Are you still there?"').setMaxLength(1500)),

  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction, { enforceClaim: true });
    if (!ctx) return;

    const ms = parseDuration(interaction.options.getString('time', true));
    if (!ms) {
      return interaction.reply({ embeds: [embeds.error('Use a time between 30 seconds and 30 days, like `30m`, `2h` or `1d12h`.')], flags: MessageFlags.Ephemeral });
    }
    const message = interaction.options.getString('message');
    const steps = [
      ...(message ? [{ verb: 'reply', arg: message }] : []),
      { verb: 'wait', ms },
      { verb: 'close', arg: interaction.options.getString('reason') ?? 'No response from user', cond: 'noreply' },
    ];
    return aliases.runSteps(interaction, ctx.thread, steps, { label: 'waitclose' });
  },
};
