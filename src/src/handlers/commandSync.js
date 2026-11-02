/**
 * Pushes slash command definitions to Discord whenever they change.
 *  - normal commands  -> registered to your server (instant)
 *  - `global: true`   -> registered globally (needed for commands that work in DMs with the bot)
 * A hash of each set is stored in the shared DB, so unchanged commands never trigger an API call.
 * Only the ACTIVE node syncs.
 */
const crypto = require('crypto');
const { REST, Routes } = require('discord.js');
const config = require('../config');
const db = require('../core/database');
const loader = require('./loader');
const log = require('../utils/logger')('sync');

const rest = new REST({ version: '10' }).setToken(config.token);
let chain = Promise.resolve();

async function push(key, route, body, force, label) {
  const hash = crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex');
  const saved = await db.meta().findOne({ _id: key });
  if (!force && (saved?.hash === hash || (!saved && body.length === 0))) return;
  await rest.put(route, { body });
  await db.meta().updateOne({ _id: key }, { $set: { hash, at: new Date() } }, { upsert: true });
  log.info(`synced ${body.length} ${label} slash command(s) to Discord`);
}

async function run(force) {
  const all = [...loader.registry.commands.values()];
  const guildBody = all.filter((c) => !c.global).map((c) => c.data.toJSON());
  const globalBody = all.filter((c) => c.global).map((c) => c.data.toJSON());
  await push(`commands:${config.guildId}`, Routes.applicationGuildCommands(config.clientId, config.guildId), guildBody, force, 'server');
  await push('commands:global', Routes.applicationCommands(config.clientId), globalBody, force, 'global');
}

/** Queue a sync (serialised so overlapping reloads can't race). */
function queue(force = false) {
  chain = chain.then(() => run(force)).catch((err) => log.error('command sync failed:', err.message));
  return chain;
}

module.exports = { queue };
