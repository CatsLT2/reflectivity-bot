const { Schema, model, models } = require('mongoose');

const schema = new Schema({
  type: { type: String, enum: ['playing', 'watching', 'listening', 'competing'], default: 'playing' },
  text: { type: String, required: true, maxlength: 100 },
  createdBy: String,
}, { timestamps: true });

module.exports = models.Status || model('Status', schema);
