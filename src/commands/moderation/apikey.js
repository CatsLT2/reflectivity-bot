const crypto = require('crypto');
const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const ApiKey = require('../../models/ApiKey');
const config = require('../../config');
const embeds = require('../../utils/embeds');

const say = (interaction, embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
const nameOpt = (o) => o.setName('label').setDescription('Key label').setRequired(true).setAutocomplete(true);
const ts = (d) => (d ? `<t:${Math.floor(new Date(d).getTime() / 1000)}:R>` : 'never');

const sub = {
  async create(interaction) {
    if (!config.web.publicUrl) return say(interaction, embeds.error('Set `PUBLIC_URL` in `.env` first - the API is served from your website address.'));
    const label = interaction.options.getString('label', true).trim().slice(0, 40);
    if (await ApiKey.exists({ guildId: interaction.guildId, label, revoked: { $ne: true } })) {
      return say(interaction, embeds.error(`There's already an active key called **${label}**. Pick another label or revoke it first.`));
    }
    const key = `rbx_${crypto.randomBytes(32).toString('base64url')}`;
    await ApiKey.create({
      guildId: interaction.guildId, label, hash: crypto.createHash('sha256').update(key).digest('hex'),
      prefix: key.slice(0, 8), createdBy: interaction.user.id, createdByName: interaction.user.username,
    });
    return say(interaction, embeds.success(
      `**Copy this key now - it will never be shown again:**\n\`\`\`\n${key}\n\`\`\`\nSend it in a header: \`X-API-Key: <key>\`\nEndpoint: \`${config.web.publicUrl}/api/roblox?user=<username or ID>\`\n\nKeep it in server-side scripts only (never in a LocalScript).`,
      `API key "${label}" created`,
    ));
  },

  async list(interaction) {
    const keys = await ApiKey.find({ guildId: interaction.guildId }).sort({ createdAt: -1 }).limit(25).lean();
    const lines = keys.map((k) => `${k.revoked ? '🚫' : '🔑'} **${k.label}** \`${k.prefix}…\` - ${k.uses} use(s), last used ${ts(k.lastUsedAt)}${k.revoked ? ' *(revoked)*' : ''}`);
    return say(interaction, embeds.info(lines.join('\n') || 'No API keys yet. Create one with `/apikey create`.', 'API keys'));
  },

  async revoke(interaction) {
    const label = interaction.options.getString('label', true);
    const k = await ApiKey.findOneAndUpdate({ guildId: interaction.guildId, label, revoked: { $ne: true } }, { $set: { revoked: true } }, { new: true });
    return say(interaction, k ? embeds.success(`Key **${k.label}** was revoked and stops working immediately.`) : embeds.error('No active key with that label.'));
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('apikey').setDescription('Manage API keys for the Roblox endpoint')
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('create').setDescription('Create a new key (shown once)')
      .addStringOption((o) => o.setName('label').setDescription('What this key is for, e.g. "main game"').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('list').setDescription('List keys'))
    .addSubcommand((s) => s.setName('revoke').setDescription('Revoke a key').addStringOption(nameOpt)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const keys = await ApiKey.find({ guildId: interaction.guildId, revoked: { $ne: true } }).sort({ label: 1 }).limit(25).lean();
    await interaction.respond(keys.filter((k) => k.label.toLowerCase().includes(focused)).map((k) => ({ name: `${k.label} (${k.prefix}…)`, value: k.label })));
  },

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return say(interaction, embeds.error('You need **Manage Server** to manage API keys.'));
    return sub[interaction.options.getSubcommand()](interaction);
  },
};
