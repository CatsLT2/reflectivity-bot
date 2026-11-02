const { MessageFlags } = require('discord.js');
const roblox = require('../../utils/roblox');
const embeds = require('../../utils/embeds');

const priv = (embed) => ({ embeds: [embed], flags: MessageFlags.Ephemeral });

// Handles the verification panel buttons: roblox:link, roblox:me, roblox:unlink
module.exports = {
  id: 'roblox',
  async execute(interaction) {
    const action = interaction.customId.split(':')[1];

    if (action === 'link') {
      return interaction.reply(await roblox.linkPrompt(interaction.user));
    }

    if (action === 'me') {
      const link = await roblox.getLink(interaction.user.id);
      return interaction.reply(priv(link
        ? roblox.linkEmbed(link, 'Your linked Roblox account')
        : embeds.info('You haven\'t linked a Roblox account yet. Press **Link Roblox Account** on the panel.')));
    }

    if (action === 'unlink') {
      const removed = await roblox.unlink(interaction.user.id);
      return interaction.reply(priv(removed
        ? embeds.success(`Unlinked from Roblox account **${removed.robloxName}**.`)
        : embeds.error('You don\'t have a linked Roblox account.')));
    }
  },
};
