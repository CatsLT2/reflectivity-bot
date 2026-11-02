const {
  SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const mongoose = require('mongoose');
const Status = require('../../models/Status');
const presence = require('../../core/presence');
const embeds = require('../../utils/embeds');

const MAX_STATUSES = 50;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const say = (interaction, embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

const sub = {
  async add(interaction) {
    if ((await Status.countDocuments()) >= MAX_STATUSES) return say(interaction, embeds.error(`You can have at most ${MAX_STATUSES} statuses.`));
    const type = interaction.options.getString('type', true);
    const text = interaction.options.getString('text', true).trim();
    await Status.create({ type, text, createdBy: interaction.user.id });
    presence.kick();
    return say(interaction, embeds.success(`Added **${cap(type)}** ${text}`, 'Status added'));
  },

  async remove(interaction) {
    const id = interaction.options.getString('status', true);
    const removed = mongoose.isValidObjectId(id) ? await Status.findByIdAndDelete(id) : null;
    if (!removed) return say(interaction, embeds.error('Pick a status from the list that appears as you type.'));
    presence.kick();
    return say(interaction, embeds.success(`Removed **${cap(removed.type)}** ${removed.text}`, 'Status removed'));
  },

  async list(interaction) {
    const all = await Status.find().sort({ createdAt: 1 }).lean();
    const seconds = await presence.getInterval();
    const body = all.length
      ? all.map((s, i) => `${i + 1}. **${cap(s.type)}** ${s.text}`).join('\n').slice(0, 3500)
      : 'No statuses yet - add one with `/status add`.';
    return say(interaction, embeds.info(`${body}\n\nRotates every **${seconds}s**.\nPlaceholders: \`{servers}\` \`{members}\` \`{threads}\``, `Statuses (${all.length})`));
  },

  async interval(interaction) {
    const value = await presence.setIntervalSeconds(interaction.options.getInteger('seconds', true));
    presence.kick();
    return say(interaction, embeds.success(`Statuses now rotate every **${value}s**.`));
  },

  async next(interaction) {
    presence.kick();
    return say(interaction, embeds.success('Switched to the next status.'));
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Manage the bot\'s rotating status')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Add a status to the rotation')
      .addStringOption((o) => o.setName('type').setDescription('Activity type').setRequired(true).addChoices(
        { name: 'Playing', value: 'playing' },
        { name: 'Watching', value: 'watching' },
        { name: 'Listening to', value: 'listening' },
        { name: 'Competing in', value: 'competing' },
      ))
      .addStringOption((o) => o.setName('text').setDescription('Status text - supports {servers} {members} {threads}').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a status from the rotation')
      .addStringOption((o) => o.setName('status').setDescription('Status to remove').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Show all statuses'))
    .addSubcommand((s) => s.setName('interval').setDescription('How often statuses rotate')
      .addIntegerOption((o) => o.setName('seconds').setDescription(`Seconds between changes (min ${presence.MIN_INTERVAL})`).setRequired(true).setMinValue(presence.MIN_INTERVAL).setMaxValue(3600)))
    .addSubcommand((s) => s.setName('next').setDescription('Switch to the next status now')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const all = await Status.find().sort({ createdAt: 1 }).lean();
    await interaction.respond(
      all.filter((s) => s.text.toLowerCase().includes(focused)).slice(0, 25)
        .map((s) => ({ name: `[${cap(s.type)}] ${s.text}`.slice(0, 100), value: String(s._id) })),
    );
  },

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return say(interaction, embeds.error('You need **Manage Server** to manage statuses.'));
    }
    return sub[interaction.options.getSubcommand()](interaction);
  },
};
