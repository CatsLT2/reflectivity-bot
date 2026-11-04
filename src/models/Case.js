const { Schema, model, models } = require('mongoose');

// One moderation action: warn / kick / ban / unban.
const schema = new Schema({
  guildId: { type: String, required: true },
  caseNumber: { type: Number, required: true },
  type: { type: String, enum: ['warn', 'kick', 'ban', 'unban'], required: true },
  userId: { type: String, required: true },
  userTag: String, // username when the action happened
  moderatorId: String,
  moderatorName: String,
  reason: { type: String, default: 'No reason provided', maxlength: 1000 },
  source: { type: String, enum: ['bot', 'discord', 'import'], default: 'bot' }, // bot = our slash commands, discord = done by hand (audit log), import = existing ban list
  pardoned: Boolean, // warns only: removed with /unwarn
  pardonedBy: String,
  pardonedAt: Date,
  pardonReason: String,
}, { timestamps: true });

schema.index({ guildId: 1, caseNumber: 1 }, { unique: true });
schema.index({ guildId: 1, createdAt: -1 });
schema.index({ guildId: 1, userId: 1, createdAt: -1 });

module.exports = models.Case || model('Case', schema);
