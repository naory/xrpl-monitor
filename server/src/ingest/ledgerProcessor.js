const { extractFills }                      = require('./fillExtractor');
const { extractAmmEvents }                  = require('./ammExtractor');
const { writeFills }                         = require('../db/fills');
const { incrementPairs, getTopK }           = require('../redis/topk');
const { buildRebalancePlan, applyRebalancePlan } = require('./subscriptionManager');
const { publishFill, publishTopKChanged }   = require('../redis/publisher');
const { recordVolume, trimWindows, detectTopKChange } = require('../redis/volume');
const { persistPairMeta }                   = require('../redis/pairMeta');
const { recordAmmVolume, trimAmmWindows, upsertPool } = require('../redis/ammVolume');
const { pushLedgerRecord, trimLedgerStats } = require('../redis/ledgerStats');
const { detectBridges }  = require('./bridgeDetector');
const { publishBridge }  = require('../redis/publisher');
const { recordBridgeEvent, trimBridgeEvents } = require('../redis/bridgeTimeseries');

function initAccumulator() {
  return {
    txnCount: 0, successCount: 0, failedCount: 0,
    feeBurnDrops: 0, paymentXrpDrops: 0,
    txTypes: {},
  };
}

function createLedgerProcessor({ pool, redis, state, hysteresis, pairRegistry, xrplClient }) {
  const subscribedKeys = new Set();
  let previousTopK     = null;
  let acc              = initAccumulator();
  let prevClosedAt     = null;
  const seenTxHashes   = new Set();

  async function handleTransaction(event) {
    const txHash = event?.hash;
    if (txHash) {
      if (seenTxHashes.has(txHash)) return;
      seenTxHashes.add(txHash);
      if (seenTxHashes.size > 2000) {
        const first = seenTxHashes.values().next().value;
        seenTxHashes.delete(first);
      }
    }
    // Accumulate ledger stats for ALL validated transactions.
    if (event?.validated && event.tx_json) {
      const txType = event.tx_json.TransactionType ?? 'Unknown';
      const result = event.meta?.TransactionResult ?? '';
      const isSuccess = result === 'tesSUCCESS';

      acc.txnCount++;
      acc.txTypes[txType] = (acc.txTypes[txType] || 0) + 1;
      acc.feeBurnDrops += parseInt(event.tx_json.Fee ?? '0', 10) || 0;
      if (isSuccess) {
        acc.successCount++;
        if (txType === 'Payment' && typeof event.tx_json.Amount === 'string') {
          acc.paymentXrpDrops += parseInt(event.tx_json.Amount, 10) || 0;
        }
      } else {
        acc.failedCount++;
      }
    }

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

    for (const fill of fills) {
      publishFill(redis, fill).catch((err) => {
        console.error('[INGEST] Failed to publish fill:', err.message);
      });
    }

    try {
      const bridges = detectBridges(fills);
      for (const b of bridges) {
        publishBridge(redis, b).catch((err) => {
          console.error('[BRIDGE] Failed to publish bridge event:', err.message);
        });
        recordBridgeEvent(redis, b).catch((err) => {
          console.error('[BRIDGE] Failed to record bridge event:', err.message);
        });
      }
    } catch (err) {
      console.error('[BRIDGE] Detection error:', err.message);
    }

    try {
      const ammEvents = extractAmmEvents(event);
      if (ammEvents.length) {
        for (const ev of ammEvents) {
          if (ev.ammAccount && ev.pairKey) {
            upsertPool(redis, {
              ammAccount: ev.ammAccount,
              pairKey:    ev.pairKey,
              asset1:     ev.asset1,
              asset2:     ev.asset2,
              fee:        ev.fee,
            }).catch(() => {});
          }
        }
        recordAmmVolume(redis, ammEvents).catch((err) => {
          console.error('[AMM] Failed to record volume:', err.message);
        });
      }
    } catch (err) {
      console.error('[AMM] Extract error:', err.message);
    }
  }

  async function handleLedgerClosed({ ledgerIndex, txnCount }) {
    state.currentLedger = ledgerIndex;
    console.log(`[LEDGER] Closed: ${ledgerIndex} (${txnCount} txns)`);

    const now = Date.now();
    const closeTimeSec = prevClosedAt ? (now - prevClosedAt) / 1000 : null;
    prevClosedAt = now;

    // Flush accumulated per-ledger stats to Redis.
    const record = {
      ledgerIndex,
      closedAt: now,
      closeTimeSec,
      ...acc,
    };
    acc = initAccumulator();

    pushLedgerRecord(redis, record).catch((err) => {
      console.error('[LSTATS] Failed to push ledger record:', err.message);
    });

    trimWindows(redis).catch((err) => {
      console.error('[VOLUME] Failed to trim windows:', err.message);
    });
    trimAmmWindows(redis).catch((err) => {
      console.error('[AMM] Failed to trim windows:', err.message);
    });
    trimLedgerStats(redis).catch((err) => {
      console.error('[LSTATS] Failed to trim windows:', err.message);
    });
    trimBridgeEvents(redis).catch((err) => {
      console.error('[BRIDGE] Failed to trim events:', err.message);
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
