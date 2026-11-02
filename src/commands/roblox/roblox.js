const {
  SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, MessageFlags, ChannelType,
} = require('discord.js');
const roblox = require('../../utils/roblox');
const mm = require('../../utils/modmail');
const embeds = require('../../utils/embeds');
const robloxInfo = require('../../utils/robloxInfo');

// Members link through the panel buttons. These commands are for staff.
const say = (interaction, embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

async function requireStaff(interaction) {
  const cfg = await mm.getConfig(interaction.guildId);
  if (mm.isStaff(interaction.member, cfg)) return true;
  await say(interaction, embeds.error('Only staff can do that.'));
  return false;
}

const requireManage = async (interaction) => {
  if (interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return true;
  await say(interaction, embeds.error('You need **Manage Server** to do that.'));
  return false;
};

const sub = {
  async panel(interaction) {
    if (!(await requireManage(interaction))) return;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    try {
      await channel.send({
        embeds: [roblox.panelEmbed(interaction.options.getString('title'), interaction.options.getString('description'))],
        components: [roblox.panelRow()],
      });
    } catch (err) {
      return say(interaction, embeds.error(`I couldn't post in ${channel}. Make sure I can view it, send messages and embed links there.\n\`${err.message}\``));
    }
    return say(interaction, embeds.success(`Verification panel posted in ${channel}.`));
  },

  async whois(interaction) {
    if (!(await requireStaff(interaction))) return;
    const user = interaction.options.getUser('user', true);
    const link = await roblox.getLink(user.id);
    if (!link) return say(interaction, embeds.error(`${user} hasn't linked a Roblox account.`));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const info = await robloxInfo.fetchInfo(link.robloxId).catch(() => null);
    return interaction.editReply({ embeds: [roblox.linkEmbed(link, `Roblox account of ${user.username}`), ...(info ? [robloxInfo.infoEmbed(info)] : [])] });
  },

  async find(interaction) {
    if (!(await requireStaff(interaction))) return;
    const link = await roblox.findByRoblox(interaction.options.getString('query', true));
    if (!link) return say(interaction, embeds.error('No linked Discord account for that Roblox user.'));
    return say(interaction, roblox.linkEmbed(link).addFields({ name: 'Discord', value: `<@${link.discordId}> (\`${link.discordId}\`)` }));
  },

  async unlink(interaction) {
    if (!(await requireStaff(interaction))) return;
    const user = interaction.options.getUser('user', true);
    const removed = await roblox.unlink(user.id);
    return say(interaction, removed
      ? embeds.success(`Unlinked ${user} from Roblox account **${removed.robloxName}**.`)
      : embeds.error(`${user} doesn't have a linked Roblox account.`));
  },

  async setup(interaction) {
    if (!(await requireManage(interaction))) return;
    const role = interaction.options.getRole('verified_role');
    const cfg = await mm.getConfig(interaction.guildId);
    cfg.verifiedRoleId = role?.id ?? undefined;
    await cfg.save();
    return say(interaction, embeds.success(role
      ? `Members who link a Roblox account will receive ${role}. Make sure the bot's role is above it in Server Settings.`
      : 'Verified role cleared - linking no longer assigns a role.'));
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roblox')
    .setDescription('Roblox linking tools (members use the verification panel)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('panel').setDescription('Admin: post the verification panel with buttons')
      .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('title').setDescription('Custom panel title').setMaxLength(100))
      .addStringOption((o) => o.setName('description').setDescription('Custom panel text (use \\n for a new line)').setMaxLength(1500)))
    .addSubcommand((s) => s.setName('setup').setDescription('Admin: choose the role given to members who link')
      .addRoleOption((o) => o.setName('verified_role').setDescription('Role to give (leave empty to clear)')))
    .addSubcommand((s) => s.setName('whois').setDescription('Staff: show a member\'s linked Roblox account')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand((s) => s.setName('find').setDescription('Staff: find the Discord user for a Roblox name or ID')
      .addStringOption((o) => o.setName('query').setDescription('Roblox username or numeric ID').setRequired(true).setMaxLength(50)))
    .addSubcommand((s) => s.setName('unlink').setDescription('Staff: remove a member\'s Roblox link')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))),

  execute: (interaction) => sub[interaction.options.getSubcommand()](interaction),
};
