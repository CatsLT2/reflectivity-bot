require('dotenv').config();
const os = require('os');
const dns = require('dns');

// Some routers/ISPs/VPNs break the SRV lookups MongoDB Atlas needs. Use public DNS for this
// process by default. Set DNS_SERVERS=system in .env to use your machine's DNS instead.
if ((process.env.DNS_SERVERS || '').toLowerCase() !== 'system') {
  dns.setServers((process.env.DNS_SERVERS || '1.1.1.1,8.8.8.8').split(',').map((s) => s.trim()).filter(Boolean));
}

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'MONGO_URI'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required .env values: ${missing.join(', ')}`);
  process.exit(1);
}

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

// Accepts "reflectivity.example.org", '"https://x.org/"', "https://x.org/health" ... and returns "https://x.org"
function baseUrl(raw) {
  let v = String(raw || '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try { return new URL(v).origin; } catch { return ''; }
}
const publicUrl = baseUrl(process.env.PUBLIC_URL);
if (process.env.PUBLIC_URL && !publicUrl) console.error(`PUBLIC_URL is not a valid web address: ${process.env.PUBLIC_URL}`);

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  mongoUri: process.env.MONGO_URI,
  // Public base URL of this bot's web callback, e.g. https://bot.example.com (no trailing slash)
  web: {
    host: process.env.WEB_HOST || '127.0.0.1',
    port: num(process.env.WEB_PORT, 3000),
    publicUrl,
  },
  roblox: {
    clientId: process.env.ROBLOX_CLIENT_ID || '',
    clientSecret: process.env.ROBLOX_CLIENT_SECRET || '',
    redirectUri: publicUrl ? `${publicUrl}/roblox/callback` : '',
    enabled: Boolean(process.env.ROBLOX_CLIENT_ID && process.env.ROBLOX_CLIENT_SECRET && publicUrl),
  },
  // Needed for the !r / !an staff shortcuts. Requires the "Message Content Intent" switch in the Developer Portal.
  messageContent: String(process.env.MESSAGE_CONTENT ?? 'true').toLowerCase() !== 'false',
  node: {
    name: process.env.NODE_NAME || os.hostname(),
    role: process.env.NODE_ROLE === 'backup' ? 'backup' : 'primary',
  },
  lease: {
    ttl: num(process.env.LEASE_TTL_MS, 10000),
    interval: num(process.env.LEASE_INTERVAL_MS, 3000),
    margin: num(process.env.LEASE_MARGIN_MS, 3000), // leader stops acting this long before its lease expires (prevents overlap)
  },
};
