/**
 * Routes interactions to commands, autocomplete handlers and components.
 * Command module shape:
 *   { data: SlashCommandBuilder, cooldown?: seconds, execute(interaction), autocomplete?(interaction) }
 * Component module shape:
 *   { id: 'prefix', execute(interaction) }   // matches customId === id or customId.startsWith(id + ':')
 */
const { MessageFlags } = require('discord.js');
const { registry } = require('./loader');
const log = require('../utils/logger')('commands');

const cooldowns = new Map();

async function fail(interaction, content = '❌ Something went wrong running that.') {
  try {
    if (interaction.deferred) await interaction.editReply({ content, embeds: [], components: [] });
    else if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch { /* interaction expired */ }
}

async function runCommand(interaction) {
  const cmd = registry.commands.get(interaction.commandName);
  if (!cmd) return fail(interaction, '❌ That command no longer exists.');

  if (cmd.cooldown) {
    const key = `${interaction.commandName}:${interaction.user.id}`;
    const readyAt = cooldowns.get(key) ?? 0;
    if (Date.now() < readyAt) {
      const secs = Math.ceil((readyAt - Date.now()) / 1000);
      return fail(interaction, `⏳ Slow down - try again in ${secs}s.`);
    }
    cooldowns.set(key, Date.now() + cmd.cooldown * 1000);
  }

  await cmd.execute(interaction);
}

async function runComponent(interaction) {
  const id = interaction.customId;
  const comp = registry.components.find((c) => id === c.id || id.startsWith(`${c.id}:`));
  if (comp) await comp.execute(interaction);
}

async function handle(interaction) {
  try {
    if (interaction.isAutocomplete()) {
      await registry.commands.get(interaction.commandName)?.autocomplete?.(interaction);
    } else if (interaction.isCommand()) {
      await runCommand(interaction);
    } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      await runComponent(interaction);
    }
  } catch (err) {
    log.error(`interaction failed (${interaction.commandName ?? interaction.customId}):`, err);
    if (!interaction.isAutocomplete()) await fail(interaction);
  }
}

module.exports = { handle };
