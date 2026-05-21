const { extractEscrows } = require('../../src/ingest/escrowExtractor');

const RIPPLE_EPOCH = 946684800;

function baseEvent(overrides = {}) {
  return {
    validated: true,
    hash: 'DEADBEEF',
    ledger_index: 91234567,
    meta: { TransactionResult: 'tesSUCCESS' },
    tx_json: {
      date: Math.floor(Date.now() / 1000) - RIPPLE_EPOCH,
      Account: 'rCreator',
      Sequence: 42,
      Destination: 'rDest',
      Amount: '500000000',
      TransactionType: 'EscrowCreate',
    },
    ...overrides,
  };
}

describe('extractEscrows', () => {
  it('returns [] for non-escrow tx type', () => {
    const event = baseEvent();
    event.tx_json.TransactionType = 'OfferCreate';
    expect(extractEscrows(event)).toEqual([]);
  });

  it('returns [] for unvalidated event', () => {
    expect(extractEscrows({ ...baseEvent(), validated: false })).toEqual([]);
  });

  it('returns [] for failed transaction', () => {
    const event = baseEvent();
    event.meta.TransactionResult = 'tecUNFUNDED';
    expect(extractEscrows(event)).toEqual([]);
  });

  it('classifies EscrowCreate without Condition as time_lock', () => {
    const [r] = extractEscrows(baseEvent());
    expect(r.txType).toBe('EscrowCreate');
    expect(r.type).toBe('time_lock');
    expect(r.hasCondition).toBe(false);
    expect(r.amountDrops).toBe(500_000_000);
    expect(r.account).toBe('rCreator');
    expect(r.sequence).toBe(42);
    expect(r.destination).toBe('rDest');
    expect(r.finishAfter).toBeNull();
    expect(r.cancelAfter).toBeNull();
  });

  it('classifies EscrowCreate with Condition as ilp', () => {
    const event = baseEvent();
    event.tx_json.Condition = 'A0258020DEADBEEF';
    const [r] = extractEscrows(event);
    expect(r.type).toBe('ilp');
    expect(r.hasCondition).toBe(true);
  });

  it('extracts FinishAfter and CancelAfter', () => {
    const event = baseEvent();
    event.tx_json.FinishAfter = 800000000;
    event.tx_json.CancelAfter = 900000000;
    const [r] = extractEscrows(event);
    expect(r.finishAfter).toBe(800000000);
    expect(r.cancelAfter).toBe(900000000);
  });

  it('extracts EscrowFinish with Fulfillment', () => {
    const event = baseEvent();
    event.tx_json.TransactionType = 'EscrowFinish';
    event.tx_json.Owner = 'rCreator';
    event.tx_json.OfferSequence = 42;
    event.tx_json.Fulfillment = 'A0028000';
    const [r] = extractEscrows(event);
    expect(r.txType).toBe('EscrowFinish');
    expect(r.owner).toBe('rCreator');
    expect(r.offerSequence).toBe(42);
    expect(r.hasFulfillment).toBe(true);
  });

  it('extracts EscrowFinish without Fulfillment', () => {
    const event = baseEvent();
    event.tx_json.TransactionType = 'EscrowFinish';
    event.tx_json.Owner = 'rOwner';
    event.tx_json.OfferSequence = 7;
    const [r] = extractEscrows(event);
    expect(r.hasFulfillment).toBe(false);
  });

  it('extracts EscrowCancel with hasFulfillment false', () => {
    const event = baseEvent();
    event.tx_json.TransactionType = 'EscrowCancel';
    event.tx_json.Owner = 'rOwner';
    event.tx_json.OfferSequence = 7;
    const [r] = extractEscrows(event);
    expect(r.txType).toBe('EscrowCancel');
    expect(r.hasFulfillment).toBe(false);
    expect(r.owner).toBe('rOwner');
    expect(r.offerSequence).toBe(7);
  });
});
