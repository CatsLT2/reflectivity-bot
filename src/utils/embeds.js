const { EmbedBuilder } = require('discord.js');

const colors = {
  success: 0x57f287,
  error: 0xed4245,
  info: 0x5865f2,
  user: 0x3498db,
  staff: 0x2ecc71,
  note: 0xf1c40f,
};

const make = (color, title, description) => {
  const e = new EmbedBuilder().setColor(color);
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  return e;
};

module.exports = {
  colors,
  make,
  success: (description, title) => make(colors.success, title, description),
  error: (description, title) => make(colors.error, title, description),
  info: (description, title) => make(colors.info, title, description),
};
