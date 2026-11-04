const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Case = require('../../models/Case');
const mod = require('../../utils/moderation');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('importbans').setDescription("Add the server's EXISTING bans to the admin website (run once)")
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [embeds.error('Only administrators can do this.')], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let added = 0; let skipped = 0; let after;
    try {
      for (let page = 0; page < 20; page += 1) { // up to 20,000 bans
        const bans = await interaction.guild.bans.fetch({ limit: 1000, ...(after && { after }) });
        for (const ban of bans.values()) {
          if (await Case.exists({ guildId: interaction.guildId, userId: ban.user.id, type: 'ban' })) { skipped += 1; continue; }
          await mod.createCase({ guildId: interaction.guildId, type: 'ban', user: ban.user, moderator: null, reason: ban.reason || 'No reason provided', source: 'import' });
          added += 1;
        }
        if (bans.size < 1000) break;
        after = bans.lastKey();
      }
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error(`Import stopped: ${err.message}\nI need the **Ban Members** permission to read the ban list.`)] });
    }
    await interaction.editReply({ embeds: [embeds.success(`Imported **${added}** ban(s). ${skipped} already had a record.\nImported bans show an "imported" tag, with no moderator.`)] });
  },
};
