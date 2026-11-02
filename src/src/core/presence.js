/**
 * Rotating bot status. Runs only on the ACTIVE node (started/stopped by leader events in index.js).
 * The status list lives in the database and is re-read every cycle, so /status add|remove
 * take effect without a restart.
 */
const { ActivityType } = require('discord.js');
const client = require('./client');
const db = require('./database');
const leader = require('./leader');
const config = require('../config');
const Status = require('../models/Status');
const Thread = require('../models/Thread');
const log = require('../utils/logger')('presence');

const DEFAULT_INTERVAL = 30; // seconds
const MIN_INTERVAL = 15; // Discord rate-limits presence updates; stay well under it
const TYPES = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};
const FALLBACK = { type: 'watching', text: 'your DMs for modmail' };

let running = false;
let timer = null;
let index = 0;
let gen = 0; // invalidates in-flight loops when kicked/stopped

async function getInterval() {
  const doc = await db.meta().findOne({ _id: 'presence' });
  return Math.max(MIN_INTERVAL, doc?.intervalSec ?? DEFAULT_INTERVAL);
}

async function setIntervalSeconds(sec) {
  const value = Math.max(MIN_INTERVAL, Math.min(3600, Math.round(sec)));
  await db.meta().updateOne({ _id: 'presence' }, { $set: { intervalSec: value } }, { upsert: true });
  return value;
}

/** Placeholders usable in status text: {servers} {members} {threads} */
async function fill(text) {
  let out = text;
  if (out.includes('{threads}')) out = out.replaceAll('{threads}', String(await Thread.countDocuments({ status: 'open' })));
  out = out.replaceAll('{servers}', String(client.guilds.cache.size));
  out = out.replaceAll('{members}', String(client.guilds.cache.get(config.guildId)?.memberCount ?? 0));
  return out.slice(0, 128);
}

async function applyNext() {
  const list = await Status.find().sort({ createdAt: 1 }).lean();
  let entry = FALLBACK;
  if (list.length) {
    entry = list[index % list.length];
    index = (index + 1) % list.length;
  }
  client.user.setPresence({
    activities: [{ name: await fill(entry.text), type: TYPES[entry.type] ?? ActivityType.Playing }],
    status: 'online',
  });
}

async function loop(myGen) {
  if (!running || myGen !== gen) return;
  try {
    if (leader.isLeader() && client.isReady()) await applyNext();
  } catch (err) {
    log.warn(`status update failed: ${err.message}`);
  }
  let seconds = DEFAULT_INTERVAL;
  try { seconds = await getInterval(); } catch { /* keep default */ }
  if (!running || myGen !== gen) return;
  timer = setTimeout(() => loop(myGen), seconds * 1000);
}

/** Show the next status right now and restart the countdown. */
function kick() {
  clearTimeout(timer);
  gen += 1;
  return loop(gen);
}

function start() {
  if (running) return;
  running = true;
  log.info('status rotation started');
  kick();
}

function stop() {
  if (!running) return;
  running = false;
  gen += 1;
  clearTimeout(timer);
  log.info('status rotation stopped');
}

module.exports = { start, stop, kick, getInterval, setIntervalSeconds, MIN_INTERVAL, TYPES };
