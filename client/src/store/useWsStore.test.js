import { useWsStore } from './useWsStore';

const reset = () =>
  useWsStore.setState({ fills: [], topK: [], selectedPair: null, connected: false, bridges: [], liveBuckets: {} });

beforeEach(reset);

describe('addFill', () => {
  it('prepends the fill to the front of the list', () => {
    useWsStore.getState().addFill({ txHash: 'A', pairKey: 'X~Y' });
    expect(useWsStore.getState().fills[0].txHash).toBe('A');
  });

  it('keeps at most 50 fills, dropping the oldest', () => {
    for (let i = 0; i < 55; i++) {
      useWsStore.getState().addFill({ txHash: `T${i}`, pairKey: 'X~Y' });
    }
    expect(useWsStore.getState().fills).toHaveLength(50);
    expect(useWsStore.getState().fills[0].txHash).toBe('T54');
  });

  it('maintains insertion order (newest first)', () => {
    useWsStore.getState().addFill({ txHash: 'first', pairKey: 'X~Y' });
    useWsStore.getState().addFill({ txHash: 'second', pairKey: 'X~Y' });
    expect(useWsStore.getState().fills[0].txHash).toBe('second');
    expect(useWsStore.getState().fills[1].txHash).toBe('first');
  });
});

describe('setTopK', () => {
  it('replaces the topK list', () => {
    useWsStore.getState().setTopK([{ pairKey: 'A~B', count: 10 }]);
    expect(useWsStore.getState().topK[0].pairKey).toBe('A~B');
  });
});

describe('setSelectedPair', () => {
  it('sets the selected pair', () => {
    useWsStore.getState().setSelectedPair('XRP|~USD|rI1');
    expect(useWsStore.getState().selectedPair).toBe('XRP|~USD|rI1');
  });

  it('can clear the selection with null', () => {
    useWsStore.getState().setSelectedPair('XRP|~USD|rI1');
    useWsStore.getState().setSelectedPair(null);
    expect(useWsStore.getState().selectedPair).toBeNull();
  });
});

describe('setConnected', () => {
  it('updates the connection flag', () => {
    useWsStore.getState().setConnected(true);
    expect(useWsStore.getState().connected).toBe(true);
    useWsStore.getState().setConnected(false);
    expect(useWsStore.getState().connected).toBe(false);
  });
});

describe('addBridge', () => {
  const makeBridge = (txHash = 'BRDG01') => ({
    txHash,
    fromCurrency: 'USD', fromIssuer: 'rIssuer1', fromValue: '50',
    toCurrency: 'EUR',   toIssuer: 'rIssuer2',   toValue: '46',
    xrpValue: '100',
  });

  it('prepends bridge to bridges array', () => {
    useWsStore.getState().addBridge(makeBridge('TX1'));
    useWsStore.getState().addBridge(makeBridge('TX2'));
    const { bridges } = useWsStore.getState();
    expect(bridges[0].txHash).toBe('TX2');
    expect(bridges[1].txHash).toBe('TX1');
  });

  it('caps bridges at 100 entries', () => {
    for (let i = 0; i < 105; i++) {
      useWsStore.getState().addBridge(makeBridge(`TX${i}`));
    }
    expect(useWsStore.getState().bridges).toHaveLength(100);
  });

  it('does not affect fills', () => {
    useWsStore.getState().addBridge(makeBridge());
    expect(useWsStore.getState().fills).toHaveLength(0);
  });
});
