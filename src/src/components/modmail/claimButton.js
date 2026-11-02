const mm = require('../../utils/modmail');

module.exports = {
  id: 'mm:claim',
  async execute(interaction) {
    const ctx = await mm.requireStaffThread(interaction);
    if (ctx) await mm.handleClaim(interaction, ctx.thread);
  },
};
