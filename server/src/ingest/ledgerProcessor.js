const { extractFills } = require('./fillExtractor');
const { writeFills } = require('../db/fills');
const { incrementPairs, getTopK } = require('../redis/topk');
const { buildRebalancePlan, applyRebalancePlan } = require('./subscriptionManager');

function createLedgerProcessor({ pool, redis, state, hysteresis, pairRegistry, xrplClient }) {
  const subscribedKeys = new Set();

  async function handleTransaction(event) {
    const fills = extractFills(event);
    if (!fills.length) return;

    state.lastLedgerIndex = event.ledger_index;

    // Register pair details for every fill seen so subscriptionManager can subscribe later
    for (const f of fills) {
      pairRegistry.register(f.pairKey, {
        getsCurrency: f.getsCurrency, getsIssuer: f.getsIssuer,
        paysCurrency: f.paysCurrency, paysIssuer: f.paysIssuer,
      });
    }

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

  async function handleLedgerClosed({ ledgerIndex, txnCount }) {
    state.currentLedger = ledgerIndex;
    console.log(`[LEDGER] Closed: ${ledgerIndex} (${txnCount} txns)`);

    try {
      const topKPairs = await getTopK(redis);
      const { toSubscribe, toUnsubscribe } = hysteresis.update(topKPairs.map((p) => p.pairKey));
      const plan = buildRebalancePlan({ topKPairs, subscribedKeys, toSubscribe, toUnsubscribe });

      if (plan.subscribe.length || plan.unsubscribe.length) {
        await applyRebalancePlan({ plan, subscribedKeys, pairRegistry, xrplClient, redis });
      }
    } catch (err) {
      console.error('[REBALANCE] Error during ledger rebalance:', err.message);
    }
  }

  return { handleTransaction, handleLedgerClosed, subscribedKeys };
}

module.exports = { createLedgerProcessor };
