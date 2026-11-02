/**
 * Runs delayed alias steps ("wait 24h", "/waitclose"). Tasks live in the database, so they
 * survive restarts and failover. Only the ACTIVE node runs them (started/stopped by leader events).
 */
const leader = require('./leader');
const Task = require('../models/Task');
const log = require('../utils/logger')('scheduler');

const POLL_MS = 10 * 1000;
const STALE_MS = 5 * 60 * 1000; // a task "running" this long means its node died mid-run

let timer = null;
let busy = false;

async function tick() {
  if (busy || !leader.isLeader()) return;
  busy = true;
  try {
    await Task.updateMany({ status: 'running', claimedAt: { $lt: new Date(Date.now() - STALE_MS) } }, { $set: { status: 'pending' } });

    for (let i = 0; i < 25; i += 1) {
      const task = await Task.findOneAndUpdate(
        { status: 'pending', runAt: { $lte: new Date() } },
        { $set: { status: 'running', claimedAt: new Date() } },
        { sort: { runAt: 1 }, new: true },
      );
      if (!task) break;
      try {
        await require('../utils/aliases').runTask(task); // lazy: hot-reloadable
        await Task.updateOne({ _id: task._id, status: 'running' }, { $set: { status: 'done' } });
      } catch (err) {
        log.error(`task ${task._id} failed:`, err);
        await Task.updateOne({ _id: task._id }, { $set: { status: 'failed', error: String(err.message).slice(0, 300) } });
      }
    }
  } catch (err) {
    log.warn(`scheduler tick failed: ${err.message}`);
  } finally {
    busy = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, POLL_MS);
  tick();
  log.info('scheduler started');
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
