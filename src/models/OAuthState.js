const { Schema, model, models } = require('mongoose');

// Short-lived record for an in-progress Roblox link. Auto-deleted after 10 minutes.
const schema = new Schema({
  state: { type: String, required: true, unique: true },
  codeVerifier: { type: String, required: true },
  discordId: { type: String, required: true },
  pending: { // filled after Roblox redirects back, until the user confirms
    robloxId: String, robloxName: String, displayName: String, avatarUrl: String,
  },
  createdAt: { type: Date, default: Date.now, expires: 600 },
});

module.exports = models.OAuthState || model('OAuthState', schema);
