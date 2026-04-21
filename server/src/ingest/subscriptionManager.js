function buildRebalancePlan({ topKPairs, subscribedKeys, toSubscribe, toUnsubscribe }) {
  return {
    subscribe:   toSubscribe.filter((k) => !subscribedKeys.has(k)),
    unsubscribe: toUnsubscribe.filter((k) => subscribedKeys.has(k)),
  };
}

async function applyRebalancePlan({ plan, subscribedKeys, pairRegistry, xrplClient, redis }) {
  const { setOrderBook } = require('../redis/orderbook');

  for (const pairKey of plan.unsubscribe) {
    const fmt = pairRegistry.toXrplFormat(pairKey);
    if (fmt) {
      try {
        await xrplClient.unsubscribeOrderBook(fmt.takerGets, fmt.takerPays);
      } catch (err) {
        console.error(`[SUBS] Failed to unsubscribe ${pairKey}:`, err.message);
      }
    }
    subscribedKeys.delete(pairKey);
    console.log(`[SUBS] Unsubscribed: ${pairKey}`);
  }

  for (const pairKey of plan.subscribe) {
    const fmt = pairRegistry.toXrplFormat(pairKey);
    if (!fmt) {
      console.warn(`[SUBS] No registry entry for ${pairKey} — skipping subscription`);
      continue;
    }
    try {
      const { bids, asks, ledgerIndex } = await xrplClient.subscribeOrderBook(fmt.takerGets, fmt.takerPays);
      subscribedKeys.add(pairKey);
      await setOrderBook(redis, pairKey, { bids, asks, ledgerIndex });
      console.log(`[SUBS] Subscribed: ${pairKey} (${bids.length} bids, ${asks.length} asks)`);
    } catch (err) {
      console.error(`[SUBS] Failed to subscribe ${pairKey}:`, err.message);
    }
  }
}

module.exports = { buildRebalancePlan, applyRebalancePlan };
