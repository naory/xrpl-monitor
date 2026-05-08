const { detectBridges } = require('../../src/ingest/bridgeDetector');

const TX = 'DEADBEEF01';
const LEDGER = 90000000;
const TIME = new Date('2025-01-01T00:00:00Z');

// Source leg: taker gave up USD to receive XRP (offer: TakerGets=XRP, TakerPays=USD)
function sourceLeg({ paysCurrency = 'USD', paysIssuer = 'rIssuer1', paysValue = '50', getsValue = '100' } = {}) {
  return {
    txHash: TX, ledgerIndex: LEDGER, ledgerTime: TIME,
    account: 'rMaker1',
    getsCurrency: 'XRP', getsIssuer: null, getsValue,
    paysCurrency, paysIssuer, paysValue,
    pairKey: `XRP|~${paysCurrency}|${paysIssuer}`, fillType: 'full',
  };
}

// Dest leg: taker gave up XRP to receive EUR (offer: TakerGets=EUR, TakerPays=XRP)
function destLeg({ getsCurrency = 'EUR', getsIssuer = 'rIssuer2', getsValue = '46', paysValue = '100' } = {}) {
  return {
    txHash: TX, ledgerIndex: LEDGER, ledgerTime: TIME,
    account: 'rMaker2',
    getsCurrency, getsIssuer, getsValue,
    paysCurrency: 'XRP', paysIssuer: null, paysValue,
    pairKey: `${getsCurrency}|${getsIssuer}~XRP|`, fillType: 'full',
  };
}

describe('detectBridges', () => {
  it('detects USD→XRP→EUR bridge', () => {
    const fills = [sourceLeg(), destLeg()];
    const result = detectBridges(fills);
    expect(result).toHaveLength(1);
    expect(result[0].fromCurrency).toBe('USD');
    expect(result[0].toCurrency).toBe('EUR');
    expect(result[0].fromIssuer).toBe('rIssuer1');
    expect(result[0].toIssuer).toBe('rIssuer2');
  });

  it('sets txHash, ledgerIndex, ledgerTime from fills', () => {
    const [b] = detectBridges([sourceLeg(), destLeg()]);
    expect(b.txHash).toBe(TX);
    expect(b.ledgerIndex).toBe(LEDGER);
    expect(b.ledgerTime).toBe(TIME);
  });

  it('sums xrpValue from source legs', () => {
    const fills = [
      sourceLeg({ getsValue: '60' }),
      sourceLeg({ getsValue: '40' }),
      destLeg(),
    ];
    const [b] = detectBridges(fills);
    expect(parseFloat(b.xrpValue)).toBeCloseTo(100);
  });

  it('sums fromValue from source legs', () => {
    const fills = [
      sourceLeg({ paysValue: '30' }),
      sourceLeg({ paysValue: '20' }),
      destLeg(),
    ];
    const [b] = detectBridges(fills);
    expect(parseFloat(b.fromValue)).toBeCloseTo(50);
  });

  it('sums toValue from dest legs', () => {
    const fills = [
      sourceLeg(),
      destLeg({ getsValue: '20' }),
      destLeg({ getsValue: '26' }),
    ];
    const [b] = detectBridges(fills);
    expect(parseFloat(b.toValue)).toBeCloseTo(46);
  });

  it('returns [] when no source legs', () => {
    expect(detectBridges([destLeg()])).toEqual([]);
  });

  it('returns [] when no dest legs', () => {
    expect(detectBridges([sourceLeg()])).toEqual([]);
  });

  it('returns [] for empty fills', () => {
    expect(detectBridges([])).toEqual([]);
  });

  it('returns [] for direct non-XRP fills', () => {
    const directFill = {
      txHash: TX, ledgerIndex: LEDGER, ledgerTime: TIME,
      account: 'rMaker3',
      getsCurrency: 'EUR', getsIssuer: 'rIssuer2', getsValue: '46',
      paysCurrency: 'USD', paysIssuer: 'rIssuer1', paysValue: '50',
      pairKey: 'EUR|rIssuer2~USD|rIssuer1', fillType: 'full',
    };
    expect(detectBridges([directFill])).toEqual([]);
  });

  it('returns [] when from and to are the same currency', () => {
    const fills = [
      sourceLeg({ paysCurrency: 'USD', paysIssuer: 'rA' }),
      destLeg({ getsCurrency: 'USD', getsIssuer: 'rB' }),
    ];
    expect(detectBridges(fills)).toEqual([]);
  });

  it('returns [] when xrpValue is zero', () => {
    const fills = [sourceLeg({ getsValue: '0' }), destLeg()];
    expect(detectBridges(fills)).toEqual([]);
  });

  it('returns [] for ambiguous multiple source currencies', () => {
    const fills = [
      sourceLeg({ paysCurrency: 'USD' }),
      sourceLeg({ paysCurrency: 'GBP' }),
      destLeg(),
    ];
    expect(detectBridges(fills)).toEqual([]);
  });
});
