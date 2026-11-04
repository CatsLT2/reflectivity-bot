const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('../config');

// Intents are fixed at login. If a new feature needs more, add them here and restart once.
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMessageTyping, // "typing..." relay: staff -> user
  GatewayIntentBits.DirectMessageTyping, // "typing..." relay: user -> staff
  GatewayIntentBits.GuildModeration, // audit-log feed: catches kicks/bans done by hand in Discord (not privileged)
];
// Privileged: enable "Message Content Intent" for your bot at discord.com/developers. Set MESSAGE_CONTENT=false to skip.
if (config.messageContent) intents.push(GatewayIntentBits.MessageContent);

module.exports = new Client({
  intents,
  partials: [Partials.Channel, Partials.Message], // required to receive DMs
});
