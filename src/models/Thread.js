const { Schema, model, models } = require('mongoose');

const attachmentSchema = new Schema({
  name: String, url: String, size: Number, type: String,
  // Where a permanent copy lives (log channel). Used to serve fresh links on the web transcript.
  archiveChannelId: String, archiveMessageId: String, archiveName: String,
}, { _id: false });

const messageSchema = new Schema({
  authorId: String,
  authorName: String,
  content: { type: String, default: '' },
  attachments: [attachmentSchema],
  staff: Boolean,
  internal: Boolean, // staff-only note, never sent to the user
  anonymous: Boolean,
  dmMessageId: String, // the message the user received (for /edit and /delete)
  echoMessageId: String, // the copy shown in the staff channel
  deleted: Boolean,
  deletedBy: String,
  edited: Boolean,
  editedAt: Date,
  at: { type: Date, default: Date.now },
}, { _id: false });

const eventSchema = new Schema({ type: String, by: String, text: String, at: { type: Date, default: Date.now } }, { _id: false });

const schema = new Schema({
  guildId: String,
  channelId: { type: String, index: true },
  userId: { type: String, index: true },
  username: String,
  userAvatar: String,
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  survey: { summary: String, extra: String }, // answers from the opening form
  roblox: { // snapshot taken when the thread opened (if the user had linked an account)
    id: String, name: String, displayName: String, created: String, description: String,
    friends: Number, followers: Number, following: Number, groupCount: Number,
    groups: [{ name: String, role: String, _id: false }], avatar: String, banned: Boolean, verified: Boolean,
  },
  claimedBy: String,
  claimedByName: String,
  claimedAt: Date,
  openedBy: String, // staff member id when opened with /modmail contact
  closedBy: String,
  closedByName: String,
  closeReason: String,
  closedAt: Date,
  stats: { avgResponseMs: Number, firstResponseMs: Number, responses: Number },
  transcriptToken: { type: String, index: true, sparse: true },
  messages: [messageSchema],
  events: [eventSchema],
}, { timestamps: true });

module.exports = models.Thread || model('Thread', schema);
