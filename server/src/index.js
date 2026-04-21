const pool                        = require('./db/pool');
const { createRedisClient }       = require('./redis/client');
const { ensureTopK }              = require('./redis/topk');
const { getLastLedgerIndex }      = require('./db/fills');
const { loadAllPairMeta }         = require('./redis/pairMeta');
const { createXrplConnection }    = require('./ingest/xrplClient');
const { createLedgerProcessor }   = require('./ingest/ledgerProcessor');
const { Hysteresis }              = require('./ingest/hysteresis');
const { PairRegistry }            = require('./ingest/pairRegistry');
const { createApp }               = require('./api/app');
const { createWebSocketServer }   = require('./api/ws');

async function main() {
  const redis = createRedisClient();
  await redis.connect();
  console.log('[Redis] Connected');

  await ensureTopK(redis);
  console.log('[Redis] TopK structure ready');

  // FF-7: restore pair registry from Redis so subscriptions survive restarts
  const savedMeta = await loadAllPairMeta(redis);
  const pairRegistry = new PairRegistry();
  for (const [pairKey, details] of savedMeta) {
    pairRegistry.register(pairKey, details);
  }
  console.log(`[Registry] Loaded ${savedMeta.size} pair(s) from Redis`);

  const lastKnownLedger = await getLastLedgerIndex(pool);
  if (lastKnownLedger === null) {
    console.log('[DB] No prior fills — first boot');
  } else {
    console.log(`[DB] Last known ledger: ${lastKnownLedger}`);
    console.warn('[DB] Gap check will run after first ledger close — monitor /health for gap details');
  }

  const state = {
    xrplConnected:   false,
    lastLedgerIndex: lastKnownLedger,
    lastKnownLedger,
    currentLedger:   null,
  };

  const hysteresis = new Hysteresis();

  let processor = null;

  const xrplClient = createXrplConnection({
    onTransaction:  (ev) => processor?.handleTransaction(ev),
    onLedgerClosed: (ev) => processor?.handleLedgerClosed(ev),
    onStateChange:  ({ connected }) => { state.xrplConnected = connected; },
  });

  processor = createLedgerProcessor({ pool, redis, state, hysteresis, pairRegistry, xrplClient });

  const app  = createApp({ pool, redis, state, xrplClient, pairRegistry });
  const port = process.env.PORT || 3001;
  const server = app.listen(port, () => {
    console.log(`[API] Listening on port ${port}`);
  });

  const { close: closeWs } = createWebSocketServer({ httpServer: server, redis });

  await xrplClient.connect();

  async function shutdown() {
    console.log('[SHUTDOWN] Graceful shutdown...');
    await xrplClient.disconnect();
    await closeWs();
    server.close();
    await redis.quit();
    await pool.end();
    process.exit(0);
  }

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[STARTUP] Fatal error:', err);
  process.exit(1);
});
