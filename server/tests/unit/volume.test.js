const { computeCutoff, encodeVolumeEvent, decodeVolumeEvent, WINDOWS, detectTopKChange } = require('../../src/redis/volume');

describe('WINDOWS', () => {
  it('defines expected window sizes in milliseconds', () => {
    expect(WINDOWS['10m']).toBe(10 * 60 * 1000);
    expect(WINDOWS['1h']).toBe(60 * 60 * 1000);
    expect(WINDOWS['24h']).toBe(24 * 60 * 60 * 1000);
  });
});

describe('computeCutoff', () => {
  const now = 1_000_000_000_000;

  it('returns now minus the window size', () => {
    expect(computeCutoff('10m', now)).toBe(now - WINDOWS['10m']);
    expect(computeCutoff('1h',  now)).toBe(now - WINDOWS['1h']);
    expect(computeCutoff('24h', now)).toBe(now - WINDOWS['24h']);
  });

  it('throws for unknown window names', () => {
    expect(() => computeCutoff('7d', now)).toThrow();
  });
});

describe('encodeVolumeEvent / decodeVolumeEvent', () => {
  it('round-trips a simple entry', () => {
    const pairKey = 'XRP|~USD|rIssuer1';
    const encoded = encodeVolumeEvent(pairKey, '10.5', 'TXHASH01', 'rAccount1', 1234567890000);
    const decoded = decodeVolumeEvent(encoded);
    expect(decoded.pairKey).toBe(pairKey);
    expect(decoded.volume).toBe('10.5');
    expect(decoded.timestamp).toBe(1234567890000);
  });

  it('handles pairKey with special characters', () => {
    const pairKey = 'USD|rIssuerA~EUR|rIssuerB';
    const encoded = encodeVolumeEvent(pairKey, '0.000001', 'TXHASH02', 'rAccount2', 9999999);
    const decoded = decodeVolumeEvent(encoded);
    expect(decoded.pairKey).toBe(pairKey);
  });

  it('encodes fills from the same pair/value/time uniquely when tx or account differs', () => {
    const pairKey = 'XRP|~USD|rIssuer1';
    const e1 = encodeVolumeEvent(pairKey, '5', 'TX01', 'rMaker1', 1000);
    const e2 = encodeVolumeEvent(pairKey, '5', 'TX01', 'rMaker2', 1000);
    expect(e1).not.toBe(e2);
  });

  it('decodeVolumeEvent returns null for malformed input', () => {
    expect(decodeVolumeEvent('not-valid-json')).toBeNull();
    expect(decodeVolumeEvent(null)).toBeNull();
  });
});

describe('detectTopKChange', () => {
  const a = [{ pairKey: 'A' }, { pairKey: 'B' }];
  const b = [{ pairKey: 'A' }, { pairKey: 'B' }];

  it('returns false when pair composition is identical', () => {
    expect(detectTopKChange(a, b)).toBe(false);
  });

  it('returns true when a pair is added', () => {
    expect(detectTopKChange(a, [...b, { pairKey: 'C' }])).toBe(true);
  });

  it('returns true when a pair is removed', () => {
    expect(detectTopKChange(a, [{ pairKey: 'A' }])).toBe(true);
  });

  it('returns true when order changes', () => {
    expect(detectTopKChange(a, [{ pairKey: 'B' }, { pairKey: 'A' }])).toBe(true);
  });

  it('returns true when previous is null (first call)', () => {
    expect(detectTopKChange(null, a)).toBe(true);
  });

  it('returns false for two empty arrays', () => {
    expect(detectTopKChange([], [])).toBe(false);
  });
});
