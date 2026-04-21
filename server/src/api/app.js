const express = require('express');
const { createHealthRouter } = require('./health');
const { createBookRouter } = require('./book');

function createApp({ pool, redis, state, xrplClient, pairRegistry }) {
  const app = express();
  app.use(express.json());

  app.use('/health', createHealthRouter({ state, pool, redis }));
  app.use('/book',   createBookRouter({ redis, xrplClient, pairRegistry }));

  return app;
}

module.exports = { createApp };
