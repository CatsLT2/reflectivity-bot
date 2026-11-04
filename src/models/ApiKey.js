const { Schema, model, models } = require('mongoose');

// Only a SHA-256 hash of the key is stored - the key itself is shown once, when created.
const schema = new Schema({
  guildId: { type: String, required: true },
  label: { type: String, required: true },
  hash: { type: String, required: true, unique: true },
  prefix: String, // first characters, to recognise a key in /apikey list
  createdBy: String,
  createdByName: String,
  lastUsedAt: Date,
  uses: { type: Number, default: 0 },
  revoked: Boolean,
}, { timestamps: true });

schema.index({ guildId: 1, label: 1 });

module.exports = models.ApiKey || model('ApiKey', schema);
