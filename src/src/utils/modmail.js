/** Modmail service - all thread logic lives here so commands/events stay tiny. */
const crypto = require('crypto');
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  EmbedBuilder, MessageFlags, PermissionFlagsBits: P,
} = require('discord.js');
const config = require('../config');
const client = require('../core/client');
const GuildConfig = require('../models/GuildConfig');
const Thread = require('../models/Thread');
const Task = require('../models/Task');
const RobloxLink = require('../models/RobloxLink');
const embeds = require('./embeds');
const att = require('./attachments');
const stats = require('./stats');
const robloxInfo = require('./robloxInfo');
const { formatDuration } = require('./duration');
const log = require('./logger')('modmail');

const creating = new Map(); // userId -> Promise (prevents duplicate threads on rapid DMs)
const EPHEMERAL = MessageFlags.Ephemeral;

/* ---------------------------------- config ---------------------------------- */

const getConfig = (guildId) =>
  GuildConfig.findOneAndUpdate({ guildId }, { $setOnInsert: { guildId } }, { upsert: true, new: true });

const isConfigured = (cfg) => Boolean(cfg.categoryId && cfg.staffRoleId);

const isStaff = (member, cfg) =>
  member.permissions.has(P.Administrator) || Boolean(cfg.staffRoleId && member.roles.cache.has(cfg.staffRoleId));

/* --------------------------------- lookups ---------------------------------- */

const findOpenThread = (userId) => Thread.findOne({ userId, status: 'open' });
const findThreadByChannel = (channelId) => Thread.findOne({ channelId, status: 'open' });

const fetchChannel = async (guild, id) =>
  guild?.channels.cache.get(id) ?? (await guild?.channels.fetch(id).catch(() => null));

const describeSendError = (err) =>
  err?.code === 50007
    ? 'The user has DMs closed (or has blocked the bot).'
    : `Discord refused the message: ${err?.message ?? err}`;

/**
 * Returns a message if someone else has claimed the thread (Manage Server can always override).
 * `who` only needs { user, memberPermissions } so it works for interactions AND plain messages.
 */
function claimBlock(thread, who) {
  if (!thread.claimedBy || thread.claimedBy === who.user.id) return null;
  if (who.memberPermissions?.has(P.ManageGuild)) return null;
  return `This thread is claimed by <@${thread.claimedBy}>. Ask them to \`/unclaim\`, or have someone with Manage Server step in.`;
}

/** Guard used by staff commands: must be staff AND inside an open thread channel. */
async function requireStaffThread(interaction, { enforceClaim = false } = {}) {
  const deny = (msg) => interaction.reply({ embeds: [embeds.error(msg)], flags: EPHEMERAL }).then(() => null);
  const cfg = await getConfig(interaction.guildId);
  if (!isStaff(interaction.member, cfg)) return deny('Only modmail staff can use this.');
  const thread = await findThreadByChannel(interaction.channelId);
  if (!thread) return deny('Use this inside an open modmail thread channel.');
  if (enforceClaim) {
    const blocked = claimBlock(thread, interaction);
    if (blocked) return deny(blocked);
  }
  return { cfg, thread };
}

const pushEvent = (thread, type, by, text) =>
  Thread.updateOne({ _id: thread._id }, { $push: { events: { type, by, text, at: new Date() } } });

/* ------------------------------ thread creation ----------------------------- */

/** Adds the Roblox profile embed after the thread is already open (so slow Roblox calls never delay it). */
async function enrichRoblox(thread, message, link) {
  const info = await robloxInfo.fetchInfo(link.robloxId);
  if (!info) return;
  await Thread.updateOne({ _id: thread._id }, { $set: { roblox: robloxInfo.snapshot(info) } });
  await message.edit({ embeds: [...message.embeds.map((e) => EmbedBuilder.from(e)), robloxInfo.infoEmbed(info)] });
}

async function createThread({ user, guild, cfg, openedBy, survey }) {
  const slug = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || user.id;
  const staffPerms = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

  const channel = await guild.channels.create({
    name: `mm-${slug}`,
    type: ChannelType.GuildText,
    parent: cfg.categoryId,
    topic: `Modmail • ${user.username} (${user.id})`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      { id: cfg.staffRoleId, allow: staffPerms },
      { id: client.user.id, allow: [...staffPerms, P.ManageChannels, P.ManageMessages] },
    ],
    reason: `Modmail thread for ${user.username}`,
  });

  const link = await RobloxLink.findOne({ discordId: user.id }).lean().catch(() => null);
  const thread = await Thread.create({
    guildId: guild.id, channelId: channel.id, userId: user.id,
    username: user.username, userAvatar: user.displayAvatarURL({ size: 128 }), openedBy: openedBy?.id,
    survey: survey?.summary ? { summary: survey.summary, extra: survey.extra || undefined } : undefined,
    roblox: link ? { id: link.robloxId, name: link.robloxName, displayName: link.displayName } : undefined,
  });

  const member = await guild.members.fetch(user.id).catch(() => null);
  const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
  const info = embeds.make(embeds.colors.info, 'New modmail thread',
    '`/claim` take it • `/reply` or `!r` respond • `!an` anonymous • `/a` alias • `/note` • `/close`')
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'User', value: `${user} (\`${user.id}\`)`, inline: true },
      { name: 'Account created', value: ts(user.createdTimestamp), inline: true },
      { name: 'Joined server', value: member?.joinedTimestamp ? ts(member.joinedTimestamp) : 'Not in server', inline: true },
    )
    .setFooter({ text: openedBy ? `Opened by ${openedBy.username}` : 'Opened by the user' });
  if (survey?.summary) info.addFields({ name: '📝 Summary of the issue', value: survey.summary.slice(0, 1024) });
  if (survey?.extra) info.addFields({ name: 'ℹ️ Extra info / background', value: survey.extra.slice(0, 1024) });
  if (link) {
    info.addFields({ name: 'Roblox', value: `[${link.robloxName}](https://www.roblox.com/users/${link.robloxId}/profile) (\`${link.robloxId}\`)`, inline: true });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mm:claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mm:close').setLabel('Close thread').setStyle(ButtonStyle.Danger),
  );

  const sent = await channel.send({
    content: `<@&${cfg.staffRoleId}>`,
    embeds: [info],
    components: [row],
    allowedMentions: { roles: [cfg.staffRoleId] },
  });
  if (link) enrichRoblox(thread, sent, link).catch((e) => log.warn(`roblox profile lookup failed: ${e.message}`));

  log.info(`opened thread for ${user.username} (${user.id}) -> #${channel.name}`);
  return { thread, channel, created: true };
}

/** Returns the user's open thread (creating one if needed). */
function getOrCreateThread({ user, guild, cfg, openedBy, survey }) {
  if (creating.has(user.id)) return creating.get(user.id);

  const promise = (async () => {
    const existing = await findOpenThread(user.id);
    if (existing) {
      const channel = await fetchChannel(guild, existing.channelId);
      if (channel) return { thread: existing, channel, created: false };
      // channel was deleted while we were offline - retire the stale record
      existing.set({ status: 'closed', closedAt: new Date(), closeReason: 'Channel missing' });
      await existing.save();
    }
    return createThread({ user, guild, cfg, openedBy, survey });
  })().finally(() => creating.delete(user.id));

  creating.set(user.id, promise);
  return promise;
}

/* ---------------------------------- claiming -------------------------------- */

function claimThread(thread, user, force = false) {
  const filter = { _id: thread._id, status: 'open' };
  if (!force) filter.$or = [{ claimedBy: null }, { claimedBy: user.id }];
  return Thread.findOneAndUpdate(
    filter,
    { $set: { claimedBy: user.id, claimedByName: user.username, claimedAt: new Date() }, $push: { events: { type: 'claim', by: user.username, text: 'claimed the thread', at: new Date() } } },
    { new: true },
  );
}

function unclaimThread(thread, user, force = false) {
  const filter = { _id: thread._id, status: 'open', claimedBy: force ? { $ne: null } : user.id };
  return Thread.findOneAndUpdate(
    filter,
    { $unset: { claimedBy: '', claimedByName: '', claimedAt: '' }, $push: { events: { type: 'unclaim', by: user.username, text: 'released the thread', at: new Date() } } },
    { new: true },
  );
}

/** Shared by /claim and the Claim button. */
async function handleClaim(interaction, thread) {
  const force = interaction.memberPermissions.has(P.ManageGuild);
  if (thread.claimedBy === interaction.user.id) {
    return interaction.reply({ embeds: [embeds.info('You already claimed this thread.')], flags: EPHEMERAL });
  }
  const updated = await claimThread(thread, interaction.user, force);
  if (!updated) {
    const current = await Thread.findById(thread._id);
    return interaction.reply({
      embeds: [embeds.error(`Already claimed by <@${current?.claimedBy}>. They can \`/unclaim\`, or someone with Manage Server can take over by claiming.`)],
      flags: EPHEMERAL,
    });
  }
  const takeover = thread.claimedBy ? ` (taken over from <@${thread.claimedBy}>)` : '';
  return interaction.reply({ embeds: [embeds.success(`${interaction.user} claimed this thread${takeover}. You'll be pinged for each reply from the user.`)] });
}

async function handleUnclaim(interaction, thread) {
  const force = interaction.memberPermissions.has(P.ManageGuild);
  const updated = await unclaimThread(thread, interaction.user, force);
  if (!updated) {
    return interaction.reply({
      embeds: [embeds.error('This thread is not claimed, or it is claimed by someone else.')],
      flags: EPHEMERAL,
    });
  }
  return interaction.reply({ embeds: [embeds.info(`${interaction.user} released this thread. Anyone can claim it now.`)] });
}

/* -------------------------------- messaging --------------------------------- */

const pushMessage = (thread, msg) =>
  Thread.updateOne({ _id: thread._id }, { $push: { messages: { ...msg, at: new Date() } } });

/** Turns a discord.js Message into the plain shape relayUserMessage expects. */
const normaliseMessage = (message) => ({
  authorId: message.author.id,
  authorName: message.author.username,
  authorAvatar: message.author.displayAvatarURL(),
  content: message.content,
  attachments: [...message.attachments.values()].map(att.toStored),
});

/**
 * User DM -> thread channel. Attachments are re-uploaded so staff can actually view them.
 * If the thread is claimed, the claimer is pinged for every reply.
 */
async function relayUserMessage(msg, thread, channel) {
  const { files, skipped } = await att.collect(msg.attachments, att.limitFor(channel.guild));

  const embed = new EmbedBuilder()
    .setColor(embeds.colors.user)
    .setAuthor({ name: msg.authorName, iconURL: msg.authorAvatar })
    .setTimestamp();
  if (msg.content) embed.setDescription(msg.content);
  else if (!files.length && !skipped.length) embed.setDescription('*no text*');
  att.applyToEmbed(embed, files, skipped);

  const ping = thread.claimedBy
    ? { content: `<@${thread.claimedBy}>`, allowedMentions: { users: [thread.claimedBy] } }
    : { allowedMentions: { parse: [] } };
  const sent = await channel.send({ ...ping, embeds: [embed], files: att.builders(files) });

  await pushMessage(thread, {
    authorId: msg.authorId, authorName: msg.authorName, content: msg.content,
    attachments: [...[...sent.attachments.values()].map(att.toStored), ...skipped.map(att.toStored)],
    staff: false,
  });
}

/**
 * Staff -> user DM. Throws if the user has DMs closed.
 * Returns { embed, files, dmMessageId } - the caller posts the echo in the staff channel
 * and then calls recordEcho() so /edit and /delete can find both copies.
 */
async function replyToUser(thread, staffUser, content, { anonymous = false, attachments = [] } = {}) {
  const user = await client.users.fetch(thread.userId);
  const { files, skipped } = await att.collect(attachments, att.DEFAULT_LIMIT);

  const embed = new EmbedBuilder()
    .setColor(embeds.colors.staff)
    .setTimestamp()
    .setAuthor(anonymous
      ? { name: 'Staff Team' }
      : { name: staffUser.username, iconURL: staffUser.displayAvatarURL() });
  if (content) embed.setDescription(content);
  else if (!files.length && !skipped.length) embed.setDescription('*no text*');
  att.applyToEmbed(embed, files, skipped);

  const sent = await user.send({ embeds: [embed], files: att.builders(files) });

  await pushMessage(thread, {
    authorId: staffUser.id, authorName: staffUser.username, content, dmMessageId: sent.id,
    attachments: [...[...sent.attachments.values()].map(att.toStored), ...skipped.map(att.toStored)],
    staff: true, anonymous,
  });

  // Staff always see who really sent it
  const echo = EmbedBuilder.from(embed)
    .setAuthor({ name: staffUser.username, iconURL: staffUser.displayAvatarURL() })
    .setFooter({ text: anonymous ? 'Sent anonymously' : 'Sent to user' });
  return { embed: echo, files: att.builders(files), dmMessageId: sent.id };
}

const recordEcho = (thread, dmMessageId, echoMessageId) =>
  Thread.updateOne({ _id: thread._id, 'messages.dmMessageId': dmMessageId }, { $set: { 'messages.$.echoMessageId': echoMessageId } });

async function addNote(thread, user, text) {
  await pushMessage(thread, {
    authorId: user.id, authorName: user.username, content: text, staff: true, internal: true,
  });
  return embeds.make(embeds.colors.note, '📝 Internal note', text)
    .setFooter({ text: user.username, iconURL: user.displayAvatarURL() });
}

/* ----------------------------- delete / edit last ---------------------------- */

/** Finds the most recent staff reply (not a note, not already deleted). */
async function lastAgentMessage(threadId) {
  const t = await Thread.findById(threadId).lean();
  const index = t.messages.findLastIndex((m) => m.staff && !m.internal && !m.deleted);
  return { t, index, msg: index >= 0 ? t.messages[index] : null };
}

async function tryDelete(channel, id) {
  if (!id) return true;
  try { await channel.messages.delete(id); return true; } catch (e) { return e?.code === 10008; } // 10008 = already gone
}

async function deleteLastReply(thread, actor) {
  const { t, index, msg } = await lastAgentMessage(thread._id);
  if (!msg) return { ok: false, reason: "There's no staff reply to delete." };

  const user = await client.users.fetch(t.userId);
  const dm = await user.createDM();
  if (!(await tryDelete(dm, msg.dmMessageId))) {
    return { ok: false, reason: "Discord wouldn't let me delete that message from the user's DMs." };
  }
  const guild = client.guilds.cache.get(t.guildId);
  const channel = await fetchChannel(guild, t.channelId);
  if (channel) await tryDelete(channel, msg.echoMessageId);

  await Thread.updateOne({ _id: t._id }, {
    $set: { [`messages.${index}.deleted`]: true, [`messages.${index}.deletedBy`]: actor.id },
    $push: { events: { type: 'delete', by: actor.username, text: `deleted a message from ${msg.authorName}`, at: new Date() } },
  });
  return { ok: true, msg };
}

async function editLastReply(thread, actor, content) {
  const { t, index, msg } = await lastAgentMessage(thread._id);
  if (!msg) return { ok: false, reason: "There's no staff reply to edit." };
  if (msg.authorId !== actor.id) {
    return { ok: false, reason: `The last reply was sent by **${msg.authorName}**. You can only edit your own last message, and only while it's the most recent reply.` };
  }
  if (!msg.dmMessageId) return { ok: false, reason: "That message can't be edited." };

  const user = await client.users.fetch(t.userId);
  const dm = await user.createDM();
  const dmMsg = await dm.messages.fetch(msg.dmMessageId).catch(() => null);
  if (!dmMsg?.embeds[0]) return { ok: false, reason: 'The original message is gone from the user\'s DMs.' };
  await dmMsg.edit({ embeds: [EmbedBuilder.from(dmMsg.embeds[0]).setDescription(content).setFooter({ text: 'edited' })] });

  const guild = client.guilds.cache.get(t.guildId);
  const channel = await fetchChannel(guild, t.channelId);
  const echo = msg.echoMessageId && channel ? await channel.messages.fetch(msg.echoMessageId).catch(() => null) : null;
  if (echo?.embeds[0]) {
    const old = echo.embeds[0].footer?.text ?? 'Sent to user';
    await echo.edit({ embeds: [EmbedBuilder.from(echo.embeds[0]).setDescription(content).setFooter({ text: `${old.replace(/ • edited$/, '')} • edited` })] });
  }

  await Thread.updateOne({ _id: t._id }, {
    $set: { [`messages.${index}.content`]: content, [`messages.${index}.edited`]: true, [`messages.${index}.editedAt`]: new Date() },
    $push: { events: { type: 'edit', by: actor.username, text: 'edited their last reply', at: new Date() } },
  });
  return { ok: true, echo };
}

/* ----------------------------------- close ---------------------------------- */

function buildTranscriptText(t) {
  const iso = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 19);
  const lines = [
    `Modmail transcript - ${t.username} (${t.userId})`,
    `Opened: ${iso(t.createdAt)}   Closed: ${iso(t.closedAt)}`,
    `Claimed by: ${t.claimedByName ?? 'nobody'}   Closed by: ${t.closedByName ?? 'unknown'}`,
    `Reason: ${t.closeReason}`,
    `Avg response: ${formatDuration(t.stats?.avgResponseMs)}   First response: ${formatDuration(t.stats?.firstResponseMs)}`,
    '='.repeat(60),
  ];
  if (t.survey?.summary) lines.push(`Summary: ${t.survey.summary}`, `Extra info: ${t.survey.extra ?? '-'}`, '='.repeat(60));
  for (const m of t.messages) {
    const tag = m.internal ? 'NOTE' : m.staff ? `STAFF${m.anonymous ? ' (anon)' : ''}` : 'USER';
    lines.push(`[${iso(m.at)}] [${tag}] ${m.authorName}: ${m.content}${m.deleted ? ' [DELETED]' : ''}${m.edited ? ' [edited]' : ''}`);
    for (const a of m.attachments) lines.push(`    attachment: ${a.name} (${Math.round((a.size ?? 0) / 1024)} KB)`);
  }
  return lines.join('\n');
}

const transcriptUrl = (token) => (config.web.publicUrl ? `${config.web.publicUrl}/t/${token}` : null);

/** Returns false if the thread was already closed. */
async function closeThread(thread, closer, reason = 'No reason provided') {
  const token = crypto.randomBytes(24).toString('base64url');
  const closed = await Thread.findOneAndUpdate(
    { _id: thread._id, status: 'open' },
    { $set: { status: 'closed', closedAt: new Date(), closedBy: closer.id, closedByName: closer.username, closeReason: reason, transcriptToken: token } },
    { new: true },
  );
  if (!closed) return false;

  closed.stats = stats.responseStats(closed.messages);
  await Thread.updateOne({ _id: closed._id }, {
    $set: { stats: closed.stats },
    $push: { events: { type: 'close', by: closer.username, text: `closed the thread: ${reason}`, at: new Date() } },
  });
  await Task.updateMany({ threadId: closed._id, status: 'pending' }, { $set: { status: 'cancelled' } });

  const guild = client.guilds.cache.get(closed.guildId);
  const cfg = await GuildConfig.findOne({ guildId: closed.guildId });

  if (guild && cfg?.logChannelId) {
    const logChannel = await fetchChannel(guild, cfg.logChannelId);
    if (logChannel) {
      const url = transcriptUrl(token);
      const summary = embeds.make(embeds.colors.note, 'Modmail thread closed').addFields(
        { name: 'User', value: `<@${closed.userId}> (\`${closed.userId}\`)`, inline: true },
        { name: 'Claimed by', value: closed.claimedBy ? `<@${closed.claimedBy}>` : 'nobody', inline: true },
        { name: 'Closed by', value: `<@${closer.id}>`, inline: true },
        { name: 'Messages', value: String(closed.messages.length), inline: true },
        { name: 'Avg response time', value: formatDuration(closed.stats.avgResponseMs), inline: true },
        { name: 'First response', value: formatDuration(closed.stats.firstResponseMs), inline: true },
      );
      if (closed.survey?.summary) summary.addFields({ name: 'Issue', value: closed.survey.summary.slice(0, 1024) });
      if (closed.roblox?.id) summary.addFields({ name: 'Roblox', value: `[${closed.roblox.name}](https://www.roblox.com/users/${closed.roblox.id}/profile)`, inline: true });
      summary.addFields({ name: 'Close reason', value: reason.slice(0, 1024) });

      const payload = { embeds: [summary] };
      if (url) {
        payload.components = [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('View transcript').setEmoji('📄').setStyle(ButtonStyle.Link).setURL(url),
        )];
      } else {
        payload.files = [new AttachmentBuilder(Buffer.from(buildTranscriptText(closed), 'utf8'), { name: `transcript-${closed.username}-${closed.userId}.txt` })];
      }
      await logChannel.send(payload).catch((e) => log.warn(`could not post transcript: ${e.message}`));

      // The thread channel is about to be deleted, so keep a copy of every file in the log channel
      // and remember where, so the web transcript can serve fresh links later.
      const flat = [];
      closed.messages.forEach((m, mi) => m.attachments.forEach((a, ai) => flat.push({ mi, ai, a })));
      const saved = await att.archive(flat.map((f) => f.a), logChannel, `📎 Attachments from **${closed.username}**'s thread`);
      const set = {};
      saved.forEach((r, i) => {
        if (!r) return;
        const base = `messages.${flat[i].mi}.attachments.${flat[i].ai}`;
        set[`${base}.archiveChannelId`] = r.channelId;
        set[`${base}.archiveMessageId`] = r.messageId;
        set[`${base}.archiveName`] = r.name;
      });
      if (Object.keys(set).length) await Thread.updateOne({ _id: closed._id }, { $set: set });
    }
  }

  const user = await client.users.fetch(closed.userId).catch(() => null);
  await user?.send({
    embeds: [embeds.info(`Your thread was closed.\n**Reason:** ${reason}\n\nSend another message any time to open a new one.`, 'Thread closed')],
  }).catch(() => {});

  const channel = guild && (await fetchChannel(guild, closed.channelId));
  setTimeout(() => channel?.delete('Modmail thread closed').catch(() => {}), 5000);
  return true;
}

module.exports = {
  getConfig, isConfigured, isStaff, claimBlock, requireStaffThread, describeSendError, fetchChannel,
  getOrCreateThread, findThreadByChannel, findOpenThread,
  handleClaim, handleUnclaim, claimThread, unclaimThread, pushEvent,
  normaliseMessage, relayUserMessage, replyToUser, recordEcho, addNote,
  deleteLastReply, editLastReply, closeThread, transcriptUrl,
};
