const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const aliases = require('../../utils/aliases');
const embeds = require('../../utils/embeds');

// Handles the modal from /alias create (customId = "alias:create:<name>")
module.exports = {
  id: 'alias:create',
  async execute(interaction) {
    const reply = (embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return reply(embeds.error('You need **Manage Server** to create aliases.'));
    }
    const name = interaction.customId.split(':')[2];
    const raw = interaction.fields.getTextInputValue('actions');

    const { errors } = aliases.parse(raw);
    if (errors.length) {
      return reply(embeds.error(
        `${errors.join('\n')}\n\nYour text, so you can copy it back:\n\`\`\`\n${raw.slice(0, 1500)}\n\`\`\``,
        'Alias not saved',
      ));
    }

    const { created } = await aliases.save(interaction.guildId, name, raw, interaction.user);
    return reply(embeds.success(`Alias \`${name}\` ${created ? 'created' : 'updated'}. Run it in a thread with \`/a name:${name}\`.`));
  },
};
