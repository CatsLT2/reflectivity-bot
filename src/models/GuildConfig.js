const { Schema, model, models } = require('mongoose');

const schema = new Schema({
  guildId: { type: String, required: true, unique: true },
  categoryId: String, // category where modmail channels are created
  logChannelId: String, // transcripts are posted here
  staffRoleId: String, // role that can see and use modmail threads
  verifiedRoleId: String, // role given to members who link a Roblox account
  surveyEnabled: { type: Boolean, default: true }, // ask users for a summary before opening a thread
  greeting: String, // optional custom message shown to users when a thread opens
  blocked: [{ userId: String, reason: String, by: String, at: { type: Date, default: Date.now }, _id: false }],
});

module.exports = models.GuildConfig || model('GuildConfig', schema);
