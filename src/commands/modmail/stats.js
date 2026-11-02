const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const mm = require('../../utils/modmail');
const Thread = require('../../models/Thread');
const embeds = require('../../utils/embeds');
const { average } = require('../../utils/stats');
const { formatDuration } = require('../../utils/duration');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Modmail ticket numbers and average response time')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName('days').setDescription('Look back this many days (default 30)').setMinValue(1).setMaxValue(365)),

  async execute(interaction) {
    const cfg = await mm.getConfig(interaction.guildId);
    if (!mm.isStaff(interaction.member, cfg)) {
      return interaction.reply({ embeds: [embeds.error('Only modmail staff can use this.')], flags: MessageFlags.Ephemeral });
    }
    const days = interaction.options.getInteger('days') ?? 30;
    const since = new Date(Date.now() - days * 86400000);
    const [closed, open] = await Promise.all([
      Thread.find({ guildId: interaction.guildId, status: 'closed', closedAt: { $gte: since } }).select('stats createdAt closedAt').lean(),
      Thread.countDocuments({ guildId: interaction.guildId, status: 'open' }),
    ]);

    const avgFirst = average(closed.map((t) => t.stats?.firstResponseMs));
    const avgAll = average(closed.map((t) => t.stats?.avgResponseMs));
    const avgLife = average(closed.map((t) => new Date(t.closedAt) - new Date(t.createdAt)));

    await interaction.reply({
      embeds: [embeds.info(null, `📊 Modmail - last ${days} day${days === 1 ? '' : 's'}`).addFields(
        { name: 'Open now', value: String(open), inline: true },
        { name: 'Closed', value: String(closed.length), inline: true },
        { name: 'Avg ticket length', value: formatDuration(avgLife), inline: true },
        { name: 'Avg first response', value: formatDuration(avgFirst), inline: true },
        { name: 'Avg response time', value: formatDuration(avgAll), inline: true },
      ).setFooter({ text: 'Response time = how long the user waited for a staff reply' })],
    });
  },
};
