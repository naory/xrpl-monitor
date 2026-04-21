const { PairRegistry } = require('../../src/ingest/pairRegistry');

const details = {
  getsCurrency: 'XRP', getsIssuer: null,
  paysCurrency: 'USD', paysIssuer: 'rIssuer1',
};

describe('PairRegistry', () => {
  it('returns null for an unknown pair', () => {
    const r = new PairRegistry();
    expect(r.get('unknown~key')).toBeNull();
  });

  it('stores and retrieves pair details by key', () => {
    const r = new PairRegistry();
    r.register('mykey', details);
    expect(r.get('mykey')).toEqual(details);
  });

  it('overwrites details on re-registration (last-write wins)', () => {
    const r = new PairRegistry();
    r.register('mykey', { ...details, paysCurrency: 'EUR' });
    r.register('mykey', details);
    expect(r.get('mykey').paysCurrency).toBe('USD');
  });

  it('size reflects number of distinct keys registered', () => {
    const r = new PairRegistry();
    r.register('k1', details);
    r.register('k2', details);
    r.register('k1', details); // duplicate
    expect(r.size()).toBe(2);
  });

  it('toXrplFormat returns correct XRPL API objects for XRP pair', () => {
    const r = new PairRegistry();
    r.register('mykey', details);
    const { takerGets, takerPays } = r.toXrplFormat('mykey');
    expect(takerGets).toEqual({ currency: 'XRP' });
    expect(takerPays).toEqual({ currency: 'USD', issuer: 'rIssuer1' });
  });

  it('toXrplFormat returns null for unknown pair', () => {
    const r = new PairRegistry();
    expect(r.toXrplFormat('unknown')).toBeNull();
  });
});
