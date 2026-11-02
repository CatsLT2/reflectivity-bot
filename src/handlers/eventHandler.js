/**
 * Event dispatcher. One discord.js listener per event name; it looks up the
 * *current* handlers in the registry on every event, so hot-reloaded handlers
 * take effect immediately.
 *
 * Handlers only run on the ACTIVE (leader) node unless they set
 * `runOnAllNodes: true` (e.g. the ready logger).
 */
const loader = require('./loader');
const leader = require('../core/leader');
const log = require('../utils/logger')('events');

const bound = new Set();

function dispatch(name, args) {
  const active = leader.isLeader();
  const handlers = (loader.registry.events.get(name) ?? []).filter((h) => h.runOnAllNodes || active);
  return Promise.all(
    handlers.map(async (h) => {
      try {
        await h.execute(...args);
      } catch (err) {
        log.error(`handler for "${name}" failed:`, err);
      }
    }),
  );
}

function bind(client) {
  for (const name of loader.registry.events.keys()) {
    if (bound.has(name)) continue;
    bound.add(name);
    client.on(name, (...args) => dispatch(name, args));
  }
}

function attach(client) {
  bind(client);
  loader.on('reloaded', () => bind(client)); // pick up brand-new event names
}

module.exports = { attach };
