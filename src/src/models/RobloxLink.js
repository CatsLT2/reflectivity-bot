const { Schema, model, models } = require('mongoose');

// One Discord account <-> one Roblox account. No OAuth tokens are ever stored.
const schema = new Schema({
  discordId: { type: String, required: true, unique: true },
  robloxId: { type: String, required: true, unique: true },
  robloxName: String, // username (can change on Roblox - the ID is the real identifier)
  displayName: String,
  avatarUrl: String,
}, { timestamps: true });

module.exports = models.RobloxLink || model('RobloxLink', schema);
