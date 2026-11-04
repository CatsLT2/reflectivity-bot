const { Schema, model, models } = require('mongoose');

// Atomic counters (case numbers). _id = "case:<guildId>"
const schema = new Schema({ _id: String, seq: { type: Number, default: 0 } });

module.exports = models.Counter || model('Counter', schema);
