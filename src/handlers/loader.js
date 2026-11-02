/**
 * Hot-reloading feature loader.
 *
 * Scans commands/, events/ and components/ for .js files, builds a registry,
 * and watches the folders. Add / edit / delete a file and the registry is
 * rebuilt live - no restart. A file that fails to load keeps its previous
 * working version, so a typo never takes a feature down.
 *
 * Files starting with "_" are ignored (handy for shared helpers or drafts).
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const chokidar = require('chokidar');
const log = require('../utils/logger')('loader');

const SRC = path.resolve(__dirname, '..');
const KINDS = ['commands', 'events', 'components'];
const HOT_PATHS = [...KINDS, 'utils'].map((d) => path.join(SRC, d)); // utils reload too
const HOT_PREFIXES = HOT_PATHS.map((p) => p + path.sep);

const registry = {
  commands: new Map(), // name -> module
  events: new Map(), // eventName -> [module]
  components: [], // [module]
};

const bus = new EventEmitter();
let modules = new Map(); // file -> { kind, mod }

const validators = {
  commands: (m) => m?.data?.name && typeof m.execute === 'function',
  events: (m) => typeof m?.name === 'string' && typeof m.execute === 'function',
  components: (m) => typeof m?.id === 'string' && typeof m.execute === 'function',
};

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') && !entry.name.startsWith('_') ? [full] : [];
  });
}

function rebuild() {
  registry.commands.clear();
  registry.events.clear();
  registry.components.length = 0;

  for (const [file, { kind, mod }] of modules) {
    if (kind === 'commands') {
      if (registry.commands.has(mod.data.name)) {
        log.warn(`duplicate command /${mod.data.name} in ${path.relative(SRC, file)} (overriding)`);
      }
      registry.commands.set(mod.data.name, mod);
    } else if (kind === 'events') {
      const list = registry.events.get(mod.name) ?? [];
      list.push(mod);
      registry.events.set(mod.name, list);
    } else {
      registry.components.push(mod);
    }
  }
}

function loadAll() {
  // Drop cached copies of everything hot so edits (including utils) are picked up.
  for (const key of Object.keys(require.cache)) {
    if (HOT_PREFIXES.some((p) => key.startsWith(p))) delete require.cache[key];
  }

  const next = new Map();
  for (const kind of KINDS) {
    for (const file of walk(path.join(SRC, kind))) {
      const rel = path.relative(SRC, file);
      try {
        const mod = require(file);
        if (!validators[kind](mod)) throw new Error(`invalid ${kind.slice(0, -1)} export shape`);
        next.set(file, { kind, mod });
      } catch (err) {
        log.error(`failed to load ${rel}: ${err.message}`);
        const previous = modules.get(file);
        if (previous) {
          next.set(file, previous);
          log.warn(`keeping previous working version of ${rel}`);
        }
      }
    }
  }

  modules = next;
  rebuild();

  const eventCount = [...registry.events.values()].reduce((n, l) => n + l.length, 0);
  log.info(`loaded ${registry.commands.size} commands, ${eventCount} event handlers, ${registry.components.length} components`);
}

function watch() {
  const watcher = chokidar.watch(HOT_PATHS, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  let timer;
  const onChange = (what, file) => {
    if (!file.endsWith('.js')) return;
    log.info(`${what}: ${path.relative(SRC, file)}`);
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        loadAll();
        bus.emit('reloaded');
      } catch (err) {
        log.error('reload failed:', err);
      }
    }, 300);
  };

  watcher
    .on('add', (f) => onChange('added', f))
    .on('change', (f) => onChange('changed', f))
    .on('unlink', (f) => onChange('removed', f));

  return watcher;
}

module.exports = { registry, loadAll, watch, on: (...args) => bus.on(...args) };
