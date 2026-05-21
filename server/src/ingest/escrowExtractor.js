const RIPPLE_EPOCH = 946684800;
const ESCROW_TX_TYPES = new Set(['EscrowCreate', 'EscrowFinish', 'EscrowCancel']);

function extractEscrows(event) {
  if (!event?.validated) return [];
  if (event.meta?.TransactionResult !== 'tesSUCCESS') return [];
  const txType = event.tx_json?.TransactionType;
  if (!ESCROW_TX_TYPES.has(txType)) return [];

  const txHash     = event.hash;
  const ledgerIndex = event.ledger_index;
  const ledgerTime  = new Date((event.tx_json.date + RIPPLE_EPOCH) * 1000);

  if (txType === 'EscrowCreate') {
    const hasCondition = !!event.tx_json.Condition;
    return [{
      txType:      'EscrowCreate',
      txHash,
      ledgerIndex,
      ledgerTime,
      type:        hasCondition ? 'ilp' : 'time_lock',
      account:     event.tx_json.Account,
      sequence:    event.tx_json.Sequence,
      destination: event.tx_json.Destination,
      amountDrops: parseInt(event.tx_json.Amount ?? '0', 10),
      finishAfter: event.tx_json.FinishAfter ?? null,
      cancelAfter: event.tx_json.CancelAfter ?? null,
      hasCondition,
    }];
  }

  if (txType === 'EscrowFinish') {
    return [{
      txType:         'EscrowFinish',
      txHash,
      ledgerIndex,
      ledgerTime,
      owner:          event.tx_json.Owner,
      offerSequence:  event.tx_json.OfferSequence,
      hasFulfillment: !!event.tx_json.Fulfillment,
    }];
  }

  // EscrowCancel
  return [{
    txType:         'EscrowCancel',
    txHash,
    ledgerIndex,
    ledgerTime,
    owner:          event.tx_json.Owner,
    offerSequence:  event.tx_json.OfferSequence,
    hasFulfillment: false,
  }];
}

module.exports = { extractEscrows };
