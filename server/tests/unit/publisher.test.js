const { buildFillMessage, buildTopKChangedMessage, CHANNELS } = require('../../src/redis/publisher');

const fill = {
  txHash: 'AABB01',
  ledgerIndex: 90000001,
  ledgerTime: new Date('2025-01-01T00:00:00Z'),
  account: 'rMaker1',
  getsCurrency: 'XRP',
  getsIssuer: null,
  getsValue: '5.000000',
  paysCurrency: 'USD',
  paysIssuer: 'rIssuer1',
  paysValue: '10',
  pairKey: 'XRP|~USD|rIssuer1',
  fillType: 'full',
};

describe('CHANNELS', () => {
  it('exports stable channel name constants', () => {
    expect(CHANNELS.FILLS).toBe('fills');
    expect(CHANNELS.TOPK_CHANGED).toBe('topk:changed');
    expect(typeof CHANNELS.BOOK).toBe('function');
    expect(CHANNELS.BOOK('mykey')).toBe('book:mykey');
  });
});

describe('buildFillMessage', () => {
  it('includes required fields', () => {
    const msg = buildFillMessage(fill);
    expect(msg.type).toBe('fill');
    expect(msg.data.txHash).toBe('AABB01');
    expect(msg.data.pairKey).toBe('XRP|~USD|rIssuer1');
    expect(msg.data.getsCurrency).toBe('XRP');
    expect(msg.data.paysCurrency).toBe('USD');
    expect(msg.data.ledgerIndex).toBe(90000001);
  });

  it('serialises ledgerTime as ISO string', () => {
    const msg = buildFillMessage(fill);
    expect(msg.data.ledgerTime).toBe('2025-01-01T00:00:00.000Z');
  });

  it('produces a JSON-serialisable object', () => {
    expect(() => JSON.stringify(buildFillMessage(fill))).not.toThrow();
  });
});

describe('buildTopKChangedMessage', () => {
  const topK = [
    { pairKey: 'XRP|~USD|rI1', count: 50 },
    { pairKey: 'XRP|~EUR|rI2', count: 30 },
  ];

  it('includes type and data', () => {
    const msg = buildTopKChangedMessage(topK);
    expect(msg.type).toBe('topk:changed');
    expect(Array.isArray(msg.data.pairs)).toBe(true);
    expect(msg.data.pairs).toHaveLength(2);
  });

  it('preserves order of pairs array', () => {
    const msg = buildTopKChangedMessage(topK);
    expect(msg.data.pairs[0].pairKey).toBe('XRP|~USD|rI1');
    expect(msg.data.pairs[1].pairKey).toBe('XRP|~EUR|rI2');
  });

  it('includes a timestamp', () => {
    const before = Date.now();
    const msg = buildTopKChangedMessage(topK);
    const after = Date.now();
    expect(msg.data.timestamp).toBeGreaterThanOrEqual(before);
    expect(msg.data.timestamp).toBeLessThanOrEqual(after);
  });

  it('produces a JSON-serialisable object', () => {
    expect(() => JSON.stringify(buildTopKChangedMessage(topK))).not.toThrow();
  });
});

const { buildBridgeMessage } = require('../../src/redis/publisher');

const bridge = {
  txHash: 'BRIDGE01',
  ledgerIndex: 90000002,
  ledgerTime: new Date('2025-06-01T00:00:00Z'),
  fromCurrency: 'USD',
  fromIssuer: 'rIssuer1',
  fromValue: '50',
  toCurrency: 'EUR',
  toIssuer: 'rIssuer2',
  toValue: '46',
  xrpValue: '100',
};

describe('CHANNELS.BRIDGE', () => {
  it('equals bridge:fill', () => {
    expect(CHANNELS.BRIDGE).toBe('bridge:fill');
  });
});

describe('buildBridgeMessage', () => {
  it('sets type to bridge:fill', () => {
    expect(buildBridgeMessage(bridge).type).toBe('bridge:fill');
  });

  it('includes all bridge fields in data', () => {
    const msg = buildBridgeMessage(bridge);
    expect(msg.data.txHash).toBe('BRIDGE01');
    expect(msg.data.fromCurrency).toBe('USD');
    expect(msg.data.toCurrency).toBe('EUR');
    expect(msg.data.xrpValue).toBe('100');
    expect(msg.data.fromValue).toBe('50');
    expect(msg.data.toValue).toBe('46');
    expect(msg.data.fromIssuer).toBe('rIssuer1');
    expect(msg.data.toIssuer).toBe('rIssuer2');
    expect(msg.data.ledgerIndex).toBe(90000002);
  });

  it('serialises ledgerTime as ISO string', () => {
    const msg = buildBridgeMessage(bridge);
    expect(msg.data.ledgerTime).toBe('2025-06-01T00:00:00.000Z');
  });

  it('is JSON-serialisable', () => {
    expect(() => JSON.stringify(buildBridgeMessage(bridge))).not.toThrow();
  });
});
