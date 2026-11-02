const { Schema, model, models } = require('mongoose');

const schema = new Schema({
  userId: { type: String, required: true, unique: true },
  reactions: { type: Boolean, default: true }, // the ✅ the bot adds to your DMs
});

module.exports = models.UserPref || model('UserPref', schema);
