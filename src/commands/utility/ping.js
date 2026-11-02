const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const embeds = require('../../utils/embeds');

module.exports = {
  cooldown: 3,
  data: new SlashCommandBuilder().setName('ping').setDescription('Check latency and which node is serving you'),
  async execute(interaction) {
    await interaction.reply({
      embeds: [embeds.info(
        `**Gateway:** ${interaction.client.ws.ping}ms\n**Served by:** ${config.node.name} (${config.node.role})`,
        '🏓 Pong!',
      )],
    });
  },
};
