const express = require('express');
const { createHealthRouter } = require('./health');
const { createBookRouter }   = require('./book');
const { createFillsRouter }  = require('./fills');
const { createAmmRouter }    = require('./amm');
const { createLedgerRouter } = require('./ledger');
const { createBridgeRouter } = require('./bridge');
const { createXrpDemandRouter } = require('./xrpDemand');
const { createEscrowRouter }    = require('./escrow');
const { createNetworkRouter }   = require('./network');

function createApp({ pool, redis, state, xrplClient, pairRegistry }) {
  const app = express();
  app.use(express.json());

  app.use('/health',     createHealthRouter({ state, pool, redis, xrplClient }));
  app.use('/book',       createBookRouter({ redis, xrplClient, pairRegistry }));
  app.use('/fills',      createFillsRouter({ pool, redis }));
  app.use('/amm',        createAmmRouter({ redis }));
  app.use('/ledger',     createLedgerRouter({ redis }));
  app.use('/bridge',     createBridgeRouter({ pool }));
  app.use('/xrp-demand', createXrpDemandRouter({ pool }));
  app.use('/escrow',     createEscrowRouter({ pool }));
  app.use('/network',    createNetworkRouter({ xrplClient, redis, state }));

  return app;
}

module.exports = { createApp };
