const { Events } = require('discord.js');
const config = require('../../config');
const log = require('../../utils/logger')('ready');

module.exports = {
  name: Events.ClientReady,
  runOnAllNodes: true, // standby nodes also log in ("warm standby")
  execute(client) {
    log.info(`logged in as ${client.user.tag} on node "${config.node.name}" (${config.node.role}) - waiting for leadership`);
  },
};
