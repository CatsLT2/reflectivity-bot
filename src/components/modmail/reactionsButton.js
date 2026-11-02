const survey = require('../../utils/survey');

// Toggle button on the ticket panel in the user's DMs.
module.exports = {
  id: 'mm:reactions',
  async execute(interaction) {
    const next = await survey.setReactions(interaction.user.id, !(await survey.reactionsEnabled(interaction.user.id)));
    await interaction.update({ components: [survey.reactionsRow(next)] });
  },
};
