const mongoose = require('mongoose');
const config = require('../config');

async function connect() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
}

// Raw collection for small shared state (leader lease, command hash)
const meta = () => mongoose.connection.collection('meta');

module.exports = { connect, meta, disconnect: () => mongoose.disconnect() };
