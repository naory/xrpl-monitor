const CHANNELS = {
  FILLS:        'fills',
  TOPK_CHANGED: 'topk:changed',
  BRIDGE:       'bridge:fill',
  XRP_DEMAND:   'xrpl:xrp-demand',
  BOOK:         (pairKey) => `book:${pairKey}`,
};

function buildFillMessage(fill) {
  return {
    type: 'fill',
    data: {
      txHash:       fill.txHash,
      ledgerIndex:  fill.ledgerIndex,
      ledgerTime:   fill.ledgerTime instanceof Date
                      ? fill.ledgerTime.toISOString()
                      : fill.ledgerTime,
      account:      fill.account,
      pairKey:      fill.pairKey,
      getsCurrency: fill.getsCurrency,
      getsIssuer:   fill.getsIssuer,
      getsValue:    fill.getsValue,
      paysCurrency: fill.paysCurrency,
      paysIssuer:   fill.paysIssuer,
      paysValue:    fill.paysValue,
      fillType:     fill.fillType,
    },
  };
}

function buildTopKChangedMessage(topK) {
  return {
    type: 'topk:changed',
    data: {
      pairs:     topK,
      timestamp: Date.now(),
    },
  };
}

function buildBridgeMessage(bridge) {
  return {
    type: 'bridge:fill',
    data: {
      txHash:       bridge.txHash,
      ledgerIndex:  bridge.ledgerIndex,
      ledgerTime:   bridge.ledgerTime instanceof Date
                      ? bridge.ledgerTime.toISOString()
                      : bridge.ledgerTime,
      fromCurrency: bridge.fromCurrency,
      fromIssuer:   bridge.fromIssuer,
      fromValue:    bridge.fromValue,
      toCurrency:   bridge.toCurrency,
      toIssuer:     bridge.toIssuer,
      toValue:      bridge.toValue,
      xrpValue:     bridge.xrpValue,
    },
  };
}

async function publishFill(redis, fill) {
  const msg = JSON.stringify(buildFillMessage(fill));
  await redis.publish(CHANNELS.FILLS, msg);
}

async function publishTopKChanged(redis, topK) {
  const msg = JSON.stringify(buildTopKChangedMessage(topK));
  await redis.publish(CHANNELS.TOPK_CHANGED, msg);
}

async function publishBridge(redis, bridge) {
  const msg = JSON.stringify(buildBridgeMessage(bridge));
  await redis.publish(CHANNELS.BRIDGE, msg);
}

function buildXrpDemandMessage(event) {
  return {
    type: 'xrp-demand',
    data: {
      txHash:      event.txHash,
      currency:    event.currency,
      xrpBought:   String(event.xrpBought),
      xrpSold:     String(event.xrpSold),
      ledgerIndex: event.ledgerIndex,
    },
  };
}

async function publishXrpDemand(redis, event) {
  const msg = JSON.stringify(buildXrpDemandMessage(event));
  await redis.publish(CHANNELS.XRP_DEMAND, msg);
}

module.exports = {
  CHANNELS,
  buildFillMessage,
  buildTopKChangedMessage,
  buildBridgeMessage,
  buildXrpDemandMessage,
  publishFill,
  publishTopKChanged,
  publishBridge,
  publishXrpDemand,
};
