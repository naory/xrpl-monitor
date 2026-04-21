const CHANNELS = {
  FILLS:        'fills',
  TOPK_CHANGED: 'topk:changed',
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

function buildBookUpdateMessage(pairKey, book) {
  return {
    type: 'book:update',
    data: { pairKey, ...book },
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

async function publishBookUpdate(redis, pairKey, book) {
  const msg = JSON.stringify(buildBookUpdateMessage(pairKey, book));
  await redis.publish(CHANNELS.BOOK(pairKey), msg);
}

module.exports = {
  CHANNELS,
  buildFillMessage,
  buildTopKChangedMessage,
  buildBookUpdateMessage,
  publishFill,
  publishTopKChanged,
  publishBookUpdate,
};
