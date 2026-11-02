const { Schema, model, models } = require('mongoose');

// A delayed alias/auto-close step list. Stored in the DB so it survives restarts and failover.
const schema = new Schema({
  threadId: { type: Schema.Types.ObjectId, required: true, index: true },
  guildId: String,
  channelId: String,
  userId: String, // the ticket's user
  createdBy: String, // staff who set it up
  label: String,
  args: String,
  steps: [{ verb: String, arg: String, cond: String, ms: Number, _id: false }],
  runAt: { type: Date, required: true },
  since: Date, // "no reply" is measured from here
  status: { type: String, enum: ['pending', 'running', 'done', 'cancelled', 'failed'], default: 'pending' },
  claimedAt: Date,
  error: String,
}, { timestamps: true });

schema.index({ status: 1, runAt: 1 });

module.exports = models.Task || model('Task', schema);
