const { Events } = require('discord.js');
const { handle } = require('../../handlers/commandHandler');

module.exports = { name: Events.InteractionCreate, execute: handle };
