const { extractFills }                      = require('./fillExtractor');
const { extractAmmEvents }                  = require('./ammExtractor');
const { writeFills }                         = require('../db/fills');
const { incrementPairs, getTopK }           = require('../redis/topk');
const { buildRebalancePlan, applyRebalancePlan } = require('./subscriptionManager');
const { publishFill, publishTopKChanged, publishBridge, publishXrpDemand, publishEscrow } = require('../redis/publisher');
const { recordVolume, trimWindows, detectTopKChange } = require('../redis/volume');
const { persistPairMeta }                   = require('../redis/pairMeta');
const { recordAmmVolume, trimAmmWindows, upsertPool } = require('../redis/ammVolume');
const { pushLedgerRecord, trimLedgerStats } = require('../redis/ledgerStats');
const { detectBridges }  = require('./bridgeDetector');
const { upsertBridgeBuckets } = require('../db/bridgeBuckets');
const { upsertXrpDemandBuckets } = require('../db/xrpDemandBuckets');
const { extractEscrows }     = require('./escrowExtractor');
const { upsertEscrowBuckets } = require('../db/escrowBuckets');

function initAccumulator() {
  return {
    txnCount: 0, successCount: 0, failedCount: 0,
    feeBurnDrops: 0, paymentXrpDrops: 0,
    txTypes: {},
  };
}

function truncateToHour(ledgerTime) {
  const d = new Date(ledgerTime);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

function ttfBucket(ttfMs) {
  if (ttfMs < 5_000)               return 'ttfLt5s';
  if (ttfMs < 30_000)              return 'ttfLt30s';
  if (ttfMs < 5 * 60_000)          return 'ttfLt5m';
  if (ttfMs < 60 * 60_000)         return 'ttfLt1h';
  if (ttfMs < 24 * 60 * 60_000)    return 'ttfLt1d';
  return 'ttfGte1d';
}

function createLedgerProcessor({ pool, redis, state, hysteresis, pairRegistry, xrplClient }) {
  const subscribedKeys = new Set();
  let previousTopK     = null;
  let acc              = initAccumulator();
  let bridgeAcc        = new Map();
  let xrpDemandAcc     = new Map();
  let escrowAcc        = new Map();
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

    try {
      const escrowEvents = extractEscrows(event);
      for (const ev of escrowEvents) {
        const hour = truncateToHour(ev.ledgerTime);

        if (ev.txType === 'EscrowCreate') {
          // Store in Redis for TTF lookup when Finish/Cancel arrives
          const redisKey = `escrow:ttf:${ev.account}:${ev.sequence}`;
          const payload  = JSON.stringify({ type: ev.type, amountDrops: ev.amountDrops, createdAtMs: ev.ledgerTime.getTime() });
          redis.set(redisKey, payload, 'EX', 604800 /* 7 days — escrows older than this fall back to hasFulfillment classification */).catch(() => {});

          // Accumulate hourly bucket
          const key   = `${hour.toISOString()}:${ev.type}`;
          const entry = escrowAcc.get(key) ?? {
            hour, type: ev.type,
            creates: 0, finishes: 0, cancels: 0,
            xrpCreated: 0, xrpFinished: 0, xrpCancelled: 0,
            ttfLt5s: 0, ttfLt30s: 0, ttfLt5m: 0, ttfLt1h: 0, ttfLt1d: 0, ttfGte1d: 0,
          };
          entry.creates++;
          entry.xrpCreated += ev.amountDrops / 1_000_000;
          escrowAcc.set(key, entry);

          // Publish live event
          publishEscrow(redis, {
            txType: 'EscrowCreate', escrowType: ev.type,
            txHash: ev.txHash, ledgerIndex: ev.ledgerIndex,
            amountXrp: ev.amountDrops / 1_000_000,
            destination: ev.destination,
          }).catch(() => {});

        } else {
          // EscrowFinish or EscrowCancel — look up TTF from Redis
          const redisKey = `escrow:ttf:${ev.owner}:${ev.offerSequence}`;
          let escrowType = ev.hasFulfillment ? 'ilp' : 'time_lock';
          let amountXrp  = 0;
          let ttfMs      = null;

          try {
            const stored = await redis.get(redisKey);
            if (stored) {
              const parsed = JSON.parse(stored);
              escrowType = parsed.type;
              amountXrp  = parsed.amountDrops / 1_000_000;
              ttfMs      = ev.ledgerTime.getTime() - parsed.createdAtMs;
              await redis.del(redisKey);
            }
          } catch (_) {}

          const key   = `${hour.toISOString()}:${escrowType}`;
          const entry = escrowAcc.get(key) ?? {
            hour, type: escrowType,
            creates: 0, finishes: 0, cancels: 0,
            xrpCreated: 0, xrpFinished: 0, xrpCancelled: 0,
            ttfLt5s: 0, ttfLt30s: 0, ttfLt5m: 0, ttfLt1h: 0, ttfLt1d: 0, ttfGte1d: 0,
          };

          if (ev.txType === 'EscrowFinish') {
            entry.finishes++;
            entry.xrpFinished += amountXrp;
            if (ttfMs != null) entry[ttfBucket(ttfMs)]++;
          } else {
            entry.cancels++;
            entry.xrpCancelled += amountXrp;
          }
          escrowAcc.set(key, entry);

          publishEscrow(redis, {
            txType: ev.txType, escrowType,
            txHash: ev.txHash, ledgerIndex: ev.ledgerIndex,
            amountXrp: amountXrp > 0 ? amountXrp : undefined,
            ttfMs: ttfMs ?? undefined,
            owner: ev.owner,
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[ESCROW] Processing error:', err.message);
    }

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

    const bridges = detectBridges(fills);

    try {
      for (const b of bridges) {
        publishBridge(redis, b).catch((err) => {
          console.error('[BRIDGE] Failed to publish bridge event:', err.message);
        });
        const hour       = truncateToHour(b.ledgerTime);
        const fromIssuer = b.fromIssuer ?? '';
        const toIssuer   = b.toIssuer   ?? '';
        const key        = `${hour.toISOString()}:${b.fromCurrency}:${fromIssuer}:${b.toCurrency}:${toIssuer}`;
        const entry      = bridgeAcc.get(key) ?? {
          hour, fromCurrency: b.fromCurrency, fromIssuer,
          toCurrency: b.toCurrency, toIssuer,
          fromVolume: 0, toVolume: 0, xrpVolume: 0, eventCount: 0,
        };
        entry.fromVolume  += Number(b.fromValue);
        entry.toVolume    += Number(b.toValue);
        entry.xrpVolume   += Number(b.xrpValue);
        entry.eventCount  += 1;
        bridgeAcc.set(key, entry);
      }
    } catch (err) {
      console.error('[BRIDGE] Detection error:', err.message);
    }

    try {
      if (bridges.length === 0) {
        // No autobridging in this tx — capture direct XRP demand per currency
        const txDemand = new Map(); // currency -> { xrpBought, xrpSold, count }
        for (const f of fills) {
          let currency  = null;
          let xrpBought = 0;
          let xrpSold   = 0;
          if (f.getsCurrency === 'XRP' && f.paysCurrency !== 'XRP') {
            currency  = f.paysCurrency;
            xrpBought = parseFloat(f.getsValue) || 0;
          } else if (f.paysCurrency === 'XRP' && f.getsCurrency !== 'XRP') {
            currency = f.getsCurrency;
            xrpSold  = parseFloat(f.paysValue) || 0;
          }
          if (!currency || currency === 'XRP') continue;
          const e = txDemand.get(currency) ?? { xrpBought: 0, xrpSold: 0, count: 0 };
          e.xrpBought += xrpBought;
          e.xrpSold   += xrpSold;
          e.count     += 1;
          txDemand.set(currency, e);
        }
        if (txDemand.size > 0) {
          const ledgerTime  = fills[0]?.ledgerTime;
          const ledgerIndex = fills[0]?.ledgerIndex;
          const hour        = truncateToHour(ledgerTime);
          for (const [currency, { xrpBought, xrpSold, count }] of txDemand) {
            if (xrpBought === 0 && xrpSold === 0) continue;
            publishXrpDemand(redis, { txHash, currency, xrpBought, xrpSold, ledgerIndex }).catch((err) => {
              console.error('[XRP_DEMAND] Failed to publish:', err.message);
            });
            const key   = `${hour.toISOString()}:${currency}`;
            const entry = xrpDemandAcc.get(key) ?? { hour, currency, xrpBought: 0, xrpSold: 0, eventCount: 0 };
            entry.xrpBought += xrpBought;
            entry.xrpSold   += xrpSold;
            entry.eventCount += count;
            xrpDemandAcc.set(key, entry);
          }
        }
      }
    } catch (err) {
      console.error('[XRP_DEMAND] Detection error:', err.message);
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
    if (bridgeAcc.size > 0) {
      const rows = [...bridgeAcc.values()];
      bridgeAcc.clear();
      upsertBridgeBuckets(pool, rows).catch((err) => {
        console.error('[BRIDGE] Failed to upsert bridge buckets:', err.message);
      });
    }
    if (xrpDemandAcc.size > 0) {
      const rows = [...xrpDemandAcc.values()];
      xrpDemandAcc.clear();
      upsertXrpDemandBuckets(pool, rows).catch((err) => {
        console.error('[XRP_DEMAND] Failed to upsert demand buckets:', err.message);
      });
    }
    if (escrowAcc.size > 0) {
      const rows = [...escrowAcc.values()];
      escrowAcc.clear();
      upsertEscrowBuckets(pool, rows).catch((err) => {
        console.error('[ESCROW] Failed to upsert buckets:', err.message);
      });
    }

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
