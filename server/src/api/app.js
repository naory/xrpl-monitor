const express = require('express');
const { createHealthRouter } = require('./health');
const { createBookRouter }   = require('./book');
const { createFillsRouter }  = require('./fills');
const { createAmmRouter }    = require('./amm');
const { createLedgerRouter } = require('./ledger');

function createApp({ pool, redis, state, xrplClient, pairRegistry }) {
  const app = express();
  app.use(express.json());

  app.use('/health', createHealthRouter({ state, pool, redis }));
  app.use('/book',   createBookRouter({ redis, xrplClient, pairRegistry }));
  app.use('/fills',  createFillsRouter({ pool, redis }));
  app.use('/amm',    createAmmRouter({ redis }));
  app.use('/ledger', createLedgerRouter({ redis }));

  return app;
}

module.exports = { createApp };
