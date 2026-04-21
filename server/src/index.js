const pool = require('./db/pool');
const { createRedisClient } = require('./redis/client');
const { ensureTopK } = require('./redis/topk');
const { getLastLedgerIndex } = require('./db/fills');
const { createXrplConnection } = require('./ingest/xrplClient');
const { createLedgerProcessor } = require('./ingest/ledgerProcessor');
const { Hysteresis } = require('./ingest/hysteresis');
const { PairRegistry } = require('./ingest/pairRegistry');
const { createApp } = require('./api/app');

async function main() {
  const redis = createRedisClient();
  await redis.connect();
  console.log('[Redis] Connected');

  await ensureTopK(redis);
  console.log('[Redis] TopK structure ready');

  const lastKnownLedger = await getLastLedgerIndex(pool);
  if (lastKnownLedger === null) {
    console.log('[DB] No prior fills — first boot');
  } else {
    console.log(`[DB] Last known ledger: ${lastKnownLedger}`);
    // FF-1: warn about potential gap so operators know to check /health
    console.warn('[DB] Gap check will run after first ledger close — monitor /health for gap details');
  }

  const state = {
    xrplConnected:   false,
    lastLedgerIndex: lastKnownLedger,
    lastKnownLedger,
    currentLedger:   null,
  };

  const hysteresis   = new Hysteresis();
  const pairRegistry = new PairRegistry();

  // xrplClient is created before ledgerProcessor because ledgerProcessor needs it,
  // but the callbacks need ledgerProcessor — resolve the cycle via a late-bound wrapper.
  let processor = null;

  const xrplClient = createXrplConnection({
    onTransaction:   (ev) => processor?.handleTransaction(ev),
    onLedgerClosed:  (ev) => processor?.handleLedgerClosed(ev),
    onStateChange:   ({ connected }) => { state.xrplConnected = connected; },
  });

  processor = createLedgerProcessor({ pool, redis, state, hysteresis, pairRegistry, xrplClient });

  const app  = createApp({ pool, redis, state, xrplClient, pairRegistry });
  const port = process.env.PORT || 3001;
  const server = app.listen(port, () => {
    console.log(`[API] Listening on port ${port}`);
  });

  await xrplClient.connect();

  async function shutdown() {
    console.log('[SHUTDOWN] Graceful shutdown...');
    await xrplClient.disconnect();
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
