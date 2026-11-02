const { Schema, model, models } = require('mongoose');

const schema = new Schema({
  guildId: { type: String, required: true },
  name: { type: String, required: true },
  actions: { type: String, required: true }, // raw text, one action per line
  createdBy: String,
}, { timestamps: true });

schema.index({ guildId: 1, name: 1 }, { unique: true });

module.exports = models.Alias || model('Alias', schema);
