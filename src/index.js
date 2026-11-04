const config = require('./config');
const client = require('./core/client');
const db = require('./core/database');
const leader = require('./core/leader');
const loader = require('./handlers/loader');
const events = require('./handlers/eventHandler');
const sync = require('./handlers/commandSync');
const presence = require('./core/presence');
const web = require('./core/web');
const scheduler = require('./core/scheduler');
const log = require('./utils/logger')('main');

async function main() {
  log.info(`starting node "${config.node.name}" (role: ${config.node.role})`);
  log.info(config.messageContent
    ? '!r / !an shortcuts: ON (Message Content Intent requested)'
    : '!r / !an shortcuts: OFF (MESSAGE_CONTENT=false in .env)');

  await db.connect();
  log.info('database connected');

  loader.loadAll();
  loader.watch();
  events.attach(client);

  // Whenever features change or we become the active node, make sure Discord has the right commands.
  loader.on('reloaded', () => { if (leader.isLeader()) sync.queue(); });
  leader.on('elected', () => { sync.queue(); presence.start(); scheduler.start(); });
  leader.on('demoted', () => { presence.stop(); scheduler.stop(); });

  // Web server: ticket transcripts + Roblox OAuth callback. Stateless (all data is in the shared DB),
  // so it runs on every node - whichever node PUBLIC_URL reaches will work.
  if (config.web.publicUrl) {
    if (config.roblox.enabled) log.info(`Roblox redirect URL (must be registered in your Roblox app): ${config.roblox.redirectUri}`);
    else log.info('Roblox linking disabled (set ROBLOX_CLIENT_ID and ROBLOX_CLIENT_SECRET to enable)');
    log.info(`Transcripts will be served at ${config.web.publicUrl}/t/<token>`);
    log.info(config.admin.enabled
      ? `Admin site: ${config.web.publicUrl}/admin  (add ${config.web.publicUrl}/admin/callback as a Redirect in your Discord app's OAuth2 settings)`
      : 'Admin site disabled (set DISCORD_CLIENT_SECRET and a SESSION_SECRET of 32+ characters in .env to enable)');
    log.info(`Roblox API: ${config.web.publicUrl}/api/roblox?user=<name or ID>  (create keys with /apikey create)`);
    web.start();
  } else {
    log.info('PUBLIC_URL not set - web transcripts and Roblox linking are disabled (transcripts fall back to .txt files)');
  }

  client.on('error', (err) => log.error('client error:', err));
  client.on('warn', (msg) => log.warn(msg));

  await client.login(config.token);

  // Only start competing for leadership once we are connected to Discord (warm standby).
  leader.start(() => client.isReady());
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received - releasing lease and shutting down`);
  try {
    presence.stop();
    scheduler.stop();
    web.stop();
    await leader.stop(); // hands over to the standby immediately
    await client.destroy();
    await db.disconnect();
  } finally {
    process.exit(0);
  }
}

['SIGINT', 'SIGTERM', 'SIGBREAK'].forEach((s) => process.on(s, () => shutdown(s)));
process.on('unhandledRejection', (err) => log.error('unhandled rejection:', err));
process.on('uncaughtException', (err) => {
  log.error('uncaught exception:', err);
  process.exit(1); // the auto-restart wrapper (systemd / start-bot.cmd) brings us back
});

main().catch((err) => {
  if (/disallowed intents/i.test(String(err?.message))) {
    log.error('Discord refused the login: a privileged intent is not enabled.\n  -> Go to discord.com/developers/applications -> your bot -> Bot tab -> turn ON "Message Content Intent" and save.\n  -> Or set MESSAGE_CONTENT=false in .env to run without the !r / !an shortcuts.');
    process.exit(1);
  }
  log.error('fatal startup error:', err);
  process.exit(1);
});
