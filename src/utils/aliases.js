/**
 * Aliases = saved multi-step macros. One action per line:
 *
 *   reply <text>            message the user (shows your name)
 *   areply <text>           message the user anonymously ("Staff Team")
 *   note <text>             internal note (user never sees it)
 *   claim / unclaim         claim or release the thread
 *   close [reason]          close the thread (must be the last action)
 *   wait <time>             pause, then continue with the next lines   (30s ... 30d, e.g. 10m, 2h, 1d12h)
 *   waitclose <time> [why]  shortcut for: wait <time>  +  ifnoreply close <why>
 *
 * Put  ifnoreply  or  ifreply  in front of any action to run it only if the user
 * has NOT / HAS replied since the last wait started.  Example:
 *
 *   reply Are you still there?
 *   wait 12h
 *   ifnoreply reply Last reminder - we'll close this soon.
 *   waitclose 12h No response from user
 *
 * Variables in text: {user} {mention} {staff} {server} {args}.   Use \n for a line break.
 * Waits are stored in the database, so they survive restarts and failover.
 */
const { MessageFlags } = require('discord.js');
const client = require('../core/client');
const Alias = require('../models/Alias');
const Thread = require('../models/Thread');
const Task = require('../models/Task');
const mm = require('./modmail');
const embeds = require('./embeds');
const { parseDuration, formatDuration } = require('./duration');

const NAME_RE = /^[a-z0-9_-]{1,32}$/;
const MAX_STEPS = 12;
const MAX_TOTAL_WAIT = 30 * 86400000;
const TEXT_VERBS = new Set(['reply', 'areply', 'note']);
const BARE_VERBS = new Set(['claim', 'unclaim', 'close']);
const NEEDS_CLAIM_CHECK = new Set(['reply', 'areply', 'close']);

const normaliseName = (s) => s.trim().toLowerCase();

/* --------------------------------- parsing ---------------------------------- */

function parse(raw) {
  const steps = [];
  const errors = [];
  const lines = String(raw).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) errors.push('Add at least one action.');

  lines.forEach((line, i) => {
    const n = i + 1;
    let rest = line;
    let cond = null;
    const c = rest.match(/^(ifnoreply|ifreply)\s*([\s\S]*)$/i);
    if (c) { cond = c[1].toLowerCase() === 'ifnoreply' ? 'noreply' : 'reply'; rest = c[2].trim(); }
    if (!rest) return errors.push(`Line ${n}: \`${line}\` needs an action after it.`);

    const [, word, argRaw = ''] = rest.match(/^(\S+)\s*([\s\S]*)$/);
    const verb = word.toLowerCase();
    const arg = argRaw.trim();

    if (TEXT_VERBS.has(verb)) {
      if (!arg) return errors.push(`Line ${n}: \`${verb}\` needs some text.`);
      return steps.push({ verb, arg, cond });
    }
    if (BARE_VERBS.has(verb)) return steps.push({ verb, arg, cond });

    if (verb === 'wait' || verb === 'waitclose') {
      if (cond) return errors.push(`Line ${n}: \`${verb}\` can't have a condition in front of it.`);
      const [time, ...why] = arg.split(/\s+/);
      const ms = parseDuration(time);
      if (!ms) return errors.push(`Line ${n}: \`${verb}\` needs a time between 30s and 30d, like \`10m\`, \`2h\` or \`1d12h\`.`);
      steps.push({ verb: 'wait', ms });
      if (verb === 'waitclose') steps.push({ verb: 'close', arg: why.join(' ') || 'No response from user', cond: 'noreply' });
      return null;
    }
    return errors.push(`Line ${n}: unknown action \`${word}\`. Use reply, areply, note, claim, unclaim, close, wait, waitclose (optionally after ifnoreply / ifreply).`);
  });

  if (steps.length > MAX_STEPS) errors.push(`Max ${MAX_STEPS} actions per alias.`);
  const closeAt = steps.findIndex((s) => s.verb === 'close');
  if (closeAt !== -1 && closeAt !== steps.length - 1) errors.push('`close` must be the last action.');
  if (steps.at(-1)?.verb === 'wait') errors.push('`wait` can\'t be the last action - add what should happen afterwards.');
  if (steps.reduce((t, s) => t + (s.ms ?? 0), 0) > MAX_TOTAL_WAIT) errors.push('Total waiting time can be at most 30 days.');
  return { steps, errors };
}

function fill(text, vars) {
  return String(text ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\{(user|mention|staff|server|args)\}/g, (_, key) => vars[key] ?? '')
    .slice(0, 4000);
}

const describe = (s) => (s.verb === 'wait'
  ? `wait ${formatDuration(s.ms)}`
  : `${s.cond === 'noreply' ? 'if no reply: ' : s.cond === 'reply' ? 'if replied: ' : ''}${s.verb}`);

/* --------------------------------- engine ----------------------------------- */

const userRepliedSince = (threadId, since) =>
  Thread.exists({ _id: threadId, messages: { $elemMatch: { staff: false, at: { $gt: since } } } }).then(Boolean);

/**
 * ctx = { thread, actor, force, since, args, label, guildName, post(payload) -> Message }
 * Runs steps in order. On `wait` it saves the remaining steps as a Task and stops.
 * Returns summary lines for the person who ran it.
 */
async function execute(ctx, steps) {
  const lines = [];
  const skipped = [];
  const vars = {
    user: ctx.thread.username, mention: `<@${ctx.thread.userId}>`, staff: ctx.actor.username,
    server: ctx.guildName, args: ctx.args ?? '',
  };

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];

    if (step.verb === 'wait') {
      const rest = steps.slice(i + 1);
      await Task.create({
        threadId: ctx.thread._id, guildId: ctx.thread.guildId, channelId: ctx.thread.channelId, userId: ctx.thread.userId,
        createdBy: ctx.actor.id, label: ctx.label, args: ctx.args, steps: rest,
        runAt: new Date(Date.now() + step.ms), since: new Date(),
      });
      await ctx.post({ embeds: [embeds.info(
        `Waiting **${formatDuration(step.ms)}**, then: ${rest.map(describe).join(' → ')}\nUse \`/cancelwait\` to stop this.`,
        '⏳ Scheduled',
      )] });
      lines.push(`⏳ waiting ${formatDuration(step.ms)}`);
      break;
    }

    if (step.cond) {
      const replied = await userRepliedSince(ctx.thread._id, ctx.since);
      if ((step.cond === 'noreply' && replied) || (step.cond === 'reply' && !replied)) { skipped.push(step); continue; }
    }

    const text = fill(step.arg, vars);
    if (step.verb === 'reply' || step.verb === 'areply') {
      const { embed, files, dmMessageId } = await mm.replyToUser(ctx.thread, ctx.actor, text, { anonymous: step.verb === 'areply' });
      const echo = await ctx.post({ embeds: [embed], files });
      await mm.recordEcho(ctx.thread, dmMessageId, echo.id);
      lines.push(`💬 sent ${step.verb === 'areply' ? 'anonymous ' : ''}reply`);
    } else if (step.verb === 'note') {
      await ctx.post({ embeds: [await mm.addNote(ctx.thread, ctx.actor, text)] });
      lines.push('📝 added note');
    } else if (step.verb === 'claim') {
      if (!(await mm.claimThread(ctx.thread, ctx.actor, ctx.force))) throw new Error('someone else has claimed this thread');
      await ctx.post({ embeds: [embeds.success(`${ctx.actor} claimed this thread.`)] });
      lines.push('👤 claimed');
    } else if (step.verb === 'unclaim') {
      if (!(await mm.unclaimThread(ctx.thread, ctx.actor, ctx.force))) throw new Error('this thread is not claimed by you');
      await ctx.post({ embeds: [embeds.info(`${ctx.actor} released this thread.`)] });
      lines.push('👤 released');
    } else if (step.verb === 'close') {
      const ok = await mm.closeThread(ctx.thread, ctx.actor, text || `Closed via alias "${ctx.label}"`);
      if (ok) await ctx.post({ embeds: [embeds.success('Thread closed. This channel will be deleted in 5 seconds.')] }).catch(() => {});
      lines.push(ok ? '🔒 closed' : 'already closed');
    }
  }

  if (skipped.length) {
    const closeSkipped = skipped.some((s) => s.verb === 'close' && s.cond === 'noreply');
    await ctx.post({ embeds: [embeds.info(closeSkipped
      ? 'The user replied, so the automatic close was cancelled.'
      : `Skipped ${skipped.length} step(s) because their condition wasn't met.`, '↪️ Skipped')] });
    lines.push(`↪️ skipped ${skipped.length} conditional step(s)`);
  }
  return lines;
}

/** Interactive run (the /a and /waitclose commands). Echoes appear in the channel; the runner gets a private summary. */
async function runSteps(interaction, thread, steps, { label, args } = {}) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ctx = {
    thread, actor: interaction.user, force: interaction.memberPermissions.has('ManageGuild'),
    since: new Date(), args, label, guildName: interaction.guild.name,
    post: (payload) => interaction.channel.send(payload),
  };
  try {
    const lines = await execute(ctx, steps);
    await interaction.editReply({ embeds: [embeds.success(lines.join('\n') || 'Done.', `Ran \`${label}\``)] });
  } catch (err) {
    await interaction.editReply({
      embeds: [embeds.error(`\`${label}\` stopped: ${err?.code === 50007 ? mm.describeSendError(err) : err.message}`)],
    });
  }
}

const run = (interaction, thread, alias, args) => runSteps(interaction, thread, parse(alias.actions).steps, { label: alias.name, args });

/** Called by the scheduler when a waiting task is due. */
async function runTask(task) {
  const thread = await Thread.findOne({ _id: task.threadId, status: 'open' });
  if (!thread) return; // closed in the meantime
  const guild = client.guilds.cache.get(thread.guildId);
  const channel = await mm.fetchChannel(guild, thread.channelId);
  if (!channel) return;

  const actor = (await client.users.fetch(task.createdBy).catch(() => null))
    ?? { id: task.createdBy, username: 'Staff', displayAvatarURL: () => null, toString: () => `<@${task.createdBy}>` };
  const ctx = {
    thread, actor, force: true, since: task.since ?? task.createdAt, args: task.args, label: task.label,
    guildName: guild?.name ?? '', post: (payload) => channel.send(payload),
  };
  const steps = task.steps.map((s) => ({ verb: s.verb, arg: s.arg, cond: s.cond, ms: s.ms }));
  try {
    await execute(ctx, steps);
  } catch (err) {
    await channel.send({ embeds: [embeds.error(`Scheduled steps for \`${task.label}\` stopped: ${err?.code === 50007 ? mm.describeSendError(err) : err.message}`)] }).catch(() => {});
  }
}

/* ------------------------------ storage + UI -------------------------------- */

async function autocomplete(interaction) {
  const focused = normaliseName(interaction.options.getFocused());
  const escaped = focused.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = await Alias.find({ guildId: interaction.guildId, name: { $regex: `^${escaped}` } }).sort({ name: 1 }).limit(25).lean();
  await interaction.respond(found.map((a) => ({
    name: `${a.name} - ${a.actions.replace(/\s+/g, ' ')}`.slice(0, 100),
    value: a.name,
  })));
}

async function save(guildId, name, actions, user) {
  const existed = await Alias.exists({ guildId, name });
  await Alias.findOneAndUpdate({ guildId, name }, { $set: { actions, createdBy: user.id } }, { upsert: true });
  return { created: !existed };
}

const find = (guildId, name) => Alias.findOne({ guildId, name: normaliseName(name) });
const remove = (guildId, name) => Alias.findOneAndDelete({ guildId, name: normaliseName(name) });
const list = (guildId) => Alias.find({ guildId }).sort({ name: 1 }).lean();
const needsClaimCheck = (alias) => parse(alias.actions).steps.some((s) => NEEDS_CLAIM_CHECK.has(s.verb) || (s.cond && s.verb === 'close'));

module.exports = {
  NAME_RE, parse, fill, normaliseName, describe, autocomplete,
  save, find, remove, list, run, runSteps, runTask, execute, needsClaimCheck,
};
