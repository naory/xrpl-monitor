const { extractFills } = require('./fillExtractor');
const { writeFills } = require('../db/fills');
const { incrementPairs } = require('../redis/topk');

function createLedgerProcessor({ pool, redis, state }) {
  async function handleTransaction(event) {
    const fills = extractFills(event);
    if (!fills.length) return;

    state.lastLedgerIndex = event.ledger_index;

    try {
      await writeFills(pool, fills);
    } catch (err) {
      console.error('[INGEST] Failed to write fills to DB:', err.message);
    }

    try {
      const pairKeys = fills.map((f) => f.pairKey);
      await incrementPairs(redis, pairKeys);
    } catch (err) {
      console.error('[INGEST] Failed to increment TopK in Redis:', err.message);
    }
  }

  function handleLedgerClosed(event) {
    state.currentLedger = event.ledger_index;
    console.log(`[LEDGER] Closed: ${event.ledger_index} (${event.txn_count ?? 0} txns)`);
  }

  return { handleTransaction, handleLedgerClosed };
}

module.exports = { createLedgerProcessor };
