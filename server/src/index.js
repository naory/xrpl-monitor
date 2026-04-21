const pool = require('./db/pool');
const { createRedisClient } = require('./redis/client');
const { ensureTopK } = require('./redis/topk');
const { getLastLedgerIndex } = require('./db/fills');
const { createXrplConnection } = require('./ingest/xrplClient');
const { createLedgerProcessor } = require('./ingest/ledgerProcessor');
const { createApp } = require('./api/app');

async function main() {
  const redis = createRedisClient();
  await redis.connect();
  console.log('[Redis] Connected');

  await ensureTopK(redis);
  console.log('[Redis] TopK structure ready');

  const lastKnownLedger = await getLastLedgerIndex(pool);
  console.log(`[DB] Last known ledger: ${lastKnownLedger ?? 'none (first boot)'}`);

  const state = {
    xrplConnected: false,
    lastLedgerIndex: lastKnownLedger,
    lastKnownLedger,
    currentLedger: null,
  };

  const { handleTransaction, handleLedgerClosed } = createLedgerProcessor({ pool, redis, state });

  const xrpl = createXrplConnection({
    onTransaction: handleTransaction,
    onLedgerClosed: handleLedgerClosed,
    onStateChange: ({ connected }) => {
      state.xrplConnected = connected;
    },
  });

  await xrpl.connect();

  const app = createApp({ pool, redis, state });
  const port = process.env.PORT || 3001;
  const server = app.listen(port, () => {
    console.log(`[API] Listening on port ${port}`);
  });

  async function shutdown() {
    console.log('[SHUTDOWN] Graceful shutdown...');
    await xrpl.disconnect();
    server.close();
    await redis.quit();
    await pool.end();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[STARTUP] Fatal error:', err);
  process.exit(1);
});
