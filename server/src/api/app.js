const express = require('express');
const { createHealthRouter } = require('./health');

function createApp({ pool, redis, state }) {
  const app = express();
  app.use(express.json());

  app.use('/health', createHealthRouter({ state, pool, redis }));

  return app;
}

module.exports = { createApp };
