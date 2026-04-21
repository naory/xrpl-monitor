const { extractFills }                      = require('./fillExtractor');
const { writeFills }                         = require('../db/fills');
const { incrementPairs, getTopK }           = require('../redis/topk');
const { buildRebalancePlan, applyRebalancePlan } = require('./subscriptionManager');
const { publishFill, publishTopKChanged }   = require('../redis/publisher');
const { recordVolume, trimWindows, detectTopKChange } = require('../redis/volume');
const { persistPairMeta }                   = require('../redis/pairMeta');

function createLedgerProcessor({ pool, redis, state, hysteresis, pairRegistry, xrplClient }) {
  const subscribedKeys = new Set();
  let previousTopK     = null;

  async function handleTransaction(event) {
    const fills = extractFills(event);
    if (!fills.length) return;

    state.lastLedgerIndex = event.ledger_index;

    for (const f of fills) {
      const details = {
        getsCurrency: f.getsCurrency, getsIssuer: f.getsIssuer,
        paysCurrency: f.paysCurrency, paysIssuer: f.paysIssuer,
      };
      pairRegistry.register(f.pairKey, details);
      persistPairMeta(redis, f.pairKey, details).catch((err) => {
        console.error('[INGEST] Failed to persist pair meta:', err.message);
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
      console.error('[INGEST] Failed to increment TopK:', err.message);
    }

    try {
      await recordVolume(redis, fills);
    } catch (err) {
      console.error('[INGEST] Failed to record volume:', err.message);
    }

    // Publish each fill to Pub/Sub — fire-and-forget
    for (const fill of fills) {
      publishFill(redis, fill).catch((err) => {
        console.error('[INGEST] Failed to publish fill:', err.message);
      });
    }
  }

  async function handleLedgerClosed({ ledgerIndex, txnCount }) {
    state.currentLedger = ledgerIndex;
    console.log(`[LEDGER] Closed: ${ledgerIndex} (${txnCount} txns)`);

    // Trim stale volume window entries
    trimWindows(redis).catch((err) => {
      console.error('[VOLUME] Failed to trim windows:', err.message);
    });

    try {
      const topKPairs = await getTopK(redis);
      const { toSubscribe, toUnsubscribe } = hysteresis.update(topKPairs.map((p) => p.pairKey));
      const plan = buildRebalancePlan({ topKPairs, subscribedKeys, toSubscribe, toUnsubscribe });

      if (plan.subscribe.length || plan.unsubscribe.length) {
        await applyRebalancePlan({ plan, subscribedKeys, pairRegistry, xrplClient, redis });
      }

      if (detectTopKChange(previousTopK, topKPairs)) {
        previousTopK = topKPairs;
        publishTopKChanged(redis, topKPairs).catch((err) => {
          console.error('[PUBLISH] Failed to publish topk:changed:', err.message);
        });
      }
    } catch (err) {
      console.error('[REBALANCE] Error during ledger rebalance:', err.message);
    }
  }

  return { handleTransaction, handleLedgerClosed, subscribedKeys };
}

module.exports = { createLedgerProcessor };
