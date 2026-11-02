const { Schema, model, models } = require('mongoose');

// DMs received while the user is still filling in the opening form. Auto-deleted after 1 hour.
const schema = new Schema({
  userId: { type: String, required: true, unique: true },
  messages: [{
    content: String,
    attachments: [{ name: String, url: String, size: Number, type: String, _id: false }],
    at: { type: Date, default: Date.now },
    _id: false,
  }],
  promptedAt: Date,
  createdAt: { type: Date, default: Date.now, expires: 3600 },
});

module.exports = models.PendingTicket || model('PendingTicket', schema);
