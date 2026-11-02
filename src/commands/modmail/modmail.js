const {
  SlashCommandBuilder, InteractionContextType, ChannelType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const mm = require('../../utils/modmail');
const embeds = require('../../utils/embeds');

const say = (interaction, embed, ephemeral = true) =>
  interaction.reply({ embeds: [embed], ...(ephemeral && { flags: MessageFlags.Ephemeral }) });

const subcommands = {
  async setup(interaction, cfg) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return say(interaction, embeds.error('You need **Manage Server** to run setup.'));
    }
    const category = interaction.options.getChannel('category', true);
    const role = interaction.options.getRole('staff_role', true);
    const log = interaction.options.getChannel('log_channel');

    cfg.categoryId = category.id;
    cfg.staffRoleId = role.id;
    cfg.logChannelId = log?.id ?? cfg.logChannelId;
    const survey = interaction.options.getBoolean('survey');
    if (survey !== null) cfg.surveyEnabled = survey;
    await cfg.save();

    return say(interaction, embeds.success(
      `**Category:** ${category}\n**Staff role:** ${role}\n**Transcripts:** ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'not set'}\n**Opening form:** ${cfg.surveyEnabled === false ? 'off' : 'on'}\n\nUsers can now DM the bot to open a thread.`,
      'Modmail configured',
    ));
  },

  async contact(interaction, cfg) {
    if (!mm.isConfigured(cfg)) return say(interaction, embeds.error('Run `/modmail setup` first.'));
    const user = interaction.options.getUser('user', true);
    if (user.bot) return say(interaction, embeds.error("You can't open a thread with a bot."));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { thread, channel, created } = await mm.getOrCreateThread({
      user, guild: interaction.guild, cfg, openedBy: interaction.user,
    });
    if (!created) return interaction.editReply({ embeds: [embeds.info(`They already have an open thread: ${channel}`)] });

    const opener = interaction.options.getString('message') ?? 'The staff team has opened a conversation with you. Reply here to respond.';
    try {
      const { embed, files } = await mm.replyToUser(thread, interaction.user, opener, { anonymous: false });
      await channel.send({ embeds: [embed], files });
      return interaction.editReply({ embeds: [embeds.success(`Thread opened: ${channel}`)] });
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error(`Thread created (${channel}) but the message couldn't be delivered.\n${mm.describeSendError(err)}`)] });
    }
  },

  async block(interaction, cfg) {
    const user = interaction.options.getUser('user', true);
    if (cfg.blocked.some((b) => b.userId === user.id)) return say(interaction, embeds.error(`${user} is already blocked.`));
    cfg.blocked.push({ userId: user.id, reason: interaction.options.getString('reason') ?? 'No reason', by: interaction.user.id });
    await cfg.save();
    return say(interaction, embeds.success(`${user} can no longer open modmail threads.`));
  },

  async unblock(interaction, cfg) {
    const user = interaction.options.getUser('user', true);
    if (!cfg.blocked.some((b) => b.userId === user.id)) return say(interaction, embeds.error(`${user} isn't blocked.`));
    cfg.blocked = cfg.blocked.filter((b) => b.userId !== user.id);
    await cfg.save();
    return say(interaction, embeds.success(`${user} was unblocked.`));
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modmail')
    .setDescription('Modmail administration')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('setup').setDescription('Configure modmail')
      .addChannelOption((o) => o.setName('category').setDescription('Category for thread channels').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addRoleOption((o) => o.setName('staff_role').setDescription('Role that handles modmail').setRequired(true))
      .addChannelOption((o) => o.setName('log_channel').setDescription('Where transcripts are posted').addChannelTypes(ChannelType.GuildText))
      .addBooleanOption((o) => o.setName('survey').setDescription('Ask users to fill in a short form before a ticket opens (default: on)')))
    .addSubcommand((s) => s.setName('contact').setDescription('Open a thread with a user')
      .addUserOption((o) => o.setName('user').setDescription('User to contact').setRequired(true))
      .addStringOption((o) => o.setName('message').setDescription('First message to send').setMaxLength(2000)))
    .addSubcommand((s) => s.setName('block').setDescription('Block a user from modmail')
      .addUserOption((o) => o.setName('user').setDescription('User to block').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
    .addSubcommand((s) => s.setName('unblock').setDescription('Unblock a user')
      .addUserOption((o) => o.setName('user').setDescription('User to unblock').setRequired(true))),

  async execute(interaction) {
    const cfg = await mm.getConfig(interaction.guildId);
    const sub = interaction.options.getSubcommand();
    if (sub !== 'setup' && !mm.isStaff(interaction.member, cfg)) {
      return say(interaction, embeds.error('Only modmail staff can use this.'));
    }
    return subcommands[sub](interaction, cfg);
  },
};
