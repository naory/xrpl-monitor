const { VALID_NETWORKS, validateNetworkName } = require('../../src/api/network');

describe('VALID_NETWORKS', () => {
  it('includes mainnet, testnet, and devnet', () => {
    expect(VALID_NETWORKS).toContain('mainnet');
    expect(VALID_NETWORKS).toContain('testnet');
    expect(VALID_NETWORKS).toContain('devnet');
    expect(VALID_NETWORKS).toHaveLength(3);
  });
});

describe('validateNetworkName', () => {
  it('returns null for valid networks', () => {
    expect(validateNetworkName('mainnet')).toBeNull();
    expect(validateNetworkName('testnet')).toBeNull();
    expect(validateNetworkName('devnet')).toBeNull();
  });

  it('returns error string for unknown network', () => {
    const result = validateNetworkName('unknown');
    expect(typeof result).toBe('string');
    expect(result).toContain('unknown');
  });

  it('returns error string for empty input', () => {
    expect(typeof validateNetworkName('')).toBe('string');
  });

  it('returns error string for missing input', () => {
    expect(typeof validateNetworkName(undefined)).toBe('string');
  });
});
