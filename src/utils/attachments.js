/**
 * Attachment handling for modmail.
 *
 * Discord CDN links from DMs are signed and EXPIRE, and a bare link in an embed is not viewable.
 * So we download each file and re-upload it as a real attachment: images render inline (the first
 * image sits inside the embed) and files are openable. Files that are too big fall back to a link.
 */
const { AttachmentBuilder } = require('discord.js');
const log = require('./logger')('attachments');

const DEFAULT_LIMIT = 10 * 1024 * 1024; // conservative; boosted servers report a higher limit
const MAX_FILES = 10; // Discord's per-message cap
const IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

const isImage = (a) => IMAGE_TYPE.test(a.contentType ?? a.type ?? '') || IMAGE_EXT.test(a.name ?? '');
const safeName = (name) => String(name || 'file').replace(/[^\w.\-]/g, '_').slice(-100) || 'file';
const toStored = (a) => ({ name: a.name, url: a.url, size: a.size, type: a.contentType ?? a.type });
const limitFor = (guild) => guild?.maximumUploadLimit ?? DEFAULT_LIMIT;
const builders = (files) => files.map((f) => new AttachmentBuilder(f.buffer, { name: f.name }));

async function download(a, limit) {
  if (a.size && a.size > limit) return null;
  try {
    const res = await fetch(a.url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > limit) return null;
    return { name: safeName(a.name), buffer, image: isImage(a), source: a };
  } catch (err) {
    log.warn(`could not download ${a.name}: ${err.message}`);
    return null;
  }
}

/** Downloads as many attachments as fit in one message. Anything else is returned in `skipped`. */
async function collect(list, limit = DEFAULT_LIMIT) {
  const files = [];
  const skipped = [];
  const used = new Set();
  let bytes = 0;

  for (const a of list) {
    if (files.length >= MAX_FILES) { skipped.push(a); continue; }
    const f = await download(a, limit - bytes);
    if (!f) { skipped.push(a); continue; }
    while (used.has(f.name)) f.name = `${files.length + 1}_${f.name}`;
    used.add(f.name);
    bytes += f.buffer.length;
    files.push(f);
  }
  return { files, skipped };
}

/** Puts the first image inside the embed and lists any skipped files as links. */
function applyToEmbed(embed, files, skipped) {
  const img = files.find((f) => f.image);
  if (img) embed.setImage(`attachment://${img.name}`);
  if (skipped.length) {
    embed.addFields({
      name: 'Attachments (too large to copy - open link)',
      value: skipped.map((a) => `[${a.name}](${a.url})`).join('\n').slice(0, 1024),
    });
  }
  return embed;
}

/**
 * Re-posts files into `channel` in size-limited batches (keeps them after a thread channel is deleted).
 * Returns an array aligned with `list`: { channelId, messageId, name } for each saved file, or null.
 */
async function archive(list, channel, title) {
  const results = new Array(list.length).fill(null);
  if (!list.length) return results;

  const limit = limitFor(channel.guild);
  const failed = [];
  let batch = []; // { file, index }
  let bytes = 0;
  let n = 0;

  const flush = async () => {
    if (!batch.length) return;
    try {
      const sent = await channel.send({ content: title.slice(0, 1900), files: builders(batch.map((b) => b.file)) });
      for (const b of batch) results[b.index] = { channelId: channel.id, messageId: sent.id, name: b.file.name };
    } catch (e) {
      log.warn(`archive upload failed: ${e.message}`);
      batch.forEach((b) => failed.push(list[b.index]));
    }
    batch = [];
    bytes = 0;
  };

  for (let i = 0; i < list.length; i += 1) {
    const f = await download(list[i], limit);
    if (!f) { failed.push(list[i]); continue; }
    f.name = `${++n}-${f.name}`;
    if (batch.length >= MAX_FILES || bytes + f.buffer.length > limit) await flush();
    batch.push({ file: f, index: i });
    bytes += f.buffer.length;
  }
  await flush();
  if (failed.length) {
    await channel.send(`⚠️ Could not archive: ${failed.map((a) => a.name).join(', ')}`.slice(0, 1900)).catch(() => {});
  }
  return results;
}

module.exports = { collect, applyToEmbed, archive, builders, toStored, limitFor, isImage, DEFAULT_LIMIT };
