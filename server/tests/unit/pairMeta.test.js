const { encodePairMeta, decodePairMeta } = require('../../src/redis/pairMeta');

const details = {
  getsCurrency: 'XRP',  getsIssuer: null,
  paysCurrency: 'USD',  paysIssuer: 'rIssuer1',
};

describe('encodePairMeta / decodePairMeta', () => {
  it('round-trips correctly', () => {
    const encoded = encodePairMeta(details);
    const decoded = decodePairMeta(encoded);
    expect(decoded).toEqual(details);
  });

  it('encodes to a non-empty string', () => {
    expect(typeof encodePairMeta(details)).toBe('string');
    expect(encodePairMeta(details).length).toBeGreaterThan(0);
  });

  it('decodePairMeta returns null for invalid input', () => {
    expect(decodePairMeta('not-json')).toBeNull();
    expect(decodePairMeta(null)).toBeNull();
  });

  it('preserves null issuer fields', () => {
    const decoded = decodePairMeta(encodePairMeta(details));
    expect(decoded.getsIssuer).toBeNull();
    expect(decoded.paysIssuer).toBe('rIssuer1');
  });
});
