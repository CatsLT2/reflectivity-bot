const {
  SlashCommandBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const mm = require('../../utils/modmail');
const aliases = require('../../utils/aliases');
const embeds = require('../../utils/embeds');

const say = (interaction, embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
const nameOption = (o) => o.setName('name').setDescription('Alias name').setRequired(true).setAutocomplete(true);

const SYNTAX = [
  '`reply <text>` - message the user',
  '`areply <text>` - message anonymously',
  '`note <text>` - internal note',
  '`claim` / `unclaim`',
  '`close [reason]` - must be last',
  '`wait <time>` - pause (30s-30d, e.g. `2h`, `1d12h`)',
  '`waitclose <time> [reason]` - close later unless they reply',
  'Put `ifnoreply` / `ifreply` before an action to make it conditional.',
  '',
  'Variables: `{user}` `{mention}` `{staff}` `{server}` `{args}`',
  'Use `\\n` for a line break.',
].join('\n');

const sub = {
  async create(interaction) {
    const name = aliases.normaliseName(interaction.options.getString('name', true));
    if (!aliases.NAME_RE.test(name)) {
      return say(interaction, embeds.error('Names can only use letters, numbers, `-` and `_` (max 32).'));
    }
    const existing = await aliases.find(interaction.guildId, name);
    const input = new TextInputBuilder()
      .setCustomId('actions')
      .setLabel('Actions (one per line)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('reply Hi {user}, thanks for waiting!\nnote Sent greeting\nclose Resolved')
      .setRequired(true)
      .setMaxLength(4000);
    if (existing) input.setValue(existing.actions);

    const modal = new ModalBuilder()
      .setCustomId(`alias:create:${name}`)
      .setTitle(`${existing ? 'Edit' : 'New'} alias: ${name}`.slice(0, 45))
      .addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  },

  async delete(interaction) {
    const removed = await aliases.remove(interaction.guildId, interaction.options.getString('name', true));
    return say(interaction, removed ? embeds.success(`Deleted alias \`${removed.name}\`.`) : embeds.error('No alias with that name.'));
  },

  async list(interaction) {
    const all = await aliases.list(interaction.guildId);
    if (!all.length) return say(interaction, embeds.info(`No aliases yet. Create one with \`/alias create\`.\n\n**Actions**\n${SYNTAX}`));
    const lines = all.map((a) => `**${a.name}** - ${a.actions.replace(/\s+/g, ' ').slice(0, 80)}`);
    return say(interaction, embeds.info(`${lines.join('\n').slice(0, 3500)}\n\nRun with \`/a\`. Edit with \`/alias create\` using the same name.`, `Aliases (${all.length})`));
  },

  async view(interaction) {
    const alias = await aliases.find(interaction.guildId, interaction.options.getString('name', true));
    if (!alias) return say(interaction, embeds.error('No alias with that name.'));
    return say(interaction, embeds.info(`\`\`\`\n${alias.actions.slice(0, 3800)}\n\`\`\``, `Alias: ${alias.name}`));
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alias')
    .setDescription('Manage modmail aliases (saved multi-step macros)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('create').setDescription('Create or edit an alias').addStringOption(nameOption))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete an alias').addStringOption(nameOption))
    .addSubcommand((s) => s.setName('list').setDescription('List all aliases'))
    .addSubcommand((s) => s.setName('view').setDescription('Show what an alias does').addStringOption(nameOption)),

  autocomplete: aliases.autocomplete,

  async execute(interaction) {
    const cfg = await mm.getConfig(interaction.guildId);
    if (!mm.isStaff(interaction.member, cfg)) return say(interaction, embeds.error('Only modmail staff can use this.'));

    const name = interaction.options.getSubcommand();
    if ((name === 'create' || name === 'delete') && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return say(interaction, embeds.error('You need **Manage Server** to create or delete aliases.'));
    }
    return sub[name](interaction);
  },
};
