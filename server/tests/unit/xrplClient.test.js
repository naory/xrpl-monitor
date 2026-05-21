const xrpl = require('xrpl');

jest.mock('xrpl');

function makeMockClient() {
  return {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    request: jest.fn().mockResolvedValue({ result: {} }),
  };
}

const { createXrplConnection } = require('../../src/ingest/xrplClient');

function makeConn() {
  return createXrplConnection({
    onTransaction: jest.fn(),
    onLedgerClosed: jest.fn(),
    onStateChange: jest.fn(),
  });
}

describe('getCurrentNetwork', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    xrpl.Client.mockImplementation(() => makeMockClient());
  });

  it('defaults to mainnet', () => {
    const conn = makeConn();
    expect(conn.getCurrentNetwork()).toBe('mainnet');
  });
});

describe('switchNetwork', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    xrpl.Client.mockImplementation(() => makeMockClient());
  });

  it('throws status 400 for unknown network name', async () => {
    const conn = makeConn();
    await expect(conn.switchNetwork('unknown')).rejects.toMatchObject({ status: 400 });
  });

  it('throws status 409 when switch is already in progress', async () => {
    const conn = makeConn();
    await conn.connect();
    xrpl.Client.mockImplementation(() => {
      const c = makeMockClient();
      c.disconnect.mockImplementation(() => new Promise(() => {})); // never resolves
      return c;
    });
    const first = conn.switchNetwork('testnet'); // hangs on disconnect
    await expect(conn.switchNetwork('mainnet')).rejects.toMatchObject({ status: 409 });
    // no need to await first — it will hang forever in mock
  });

  it('updates getCurrentNetwork after successful switch', async () => {
    const conn = makeConn();
    await conn.connect();
    await conn.switchNetwork('testnet');
    expect(conn.getCurrentNetwork()).toBe('testnet');
  });

  it('reconnects to testnet URL after switchNetwork("testnet")', async () => {
    const conn = makeConn();
    await conn.connect();
    xrpl.Client.mockClear();
    await conn.switchNetwork('testnet');
    expect(xrpl.Client).toHaveBeenCalledWith('wss://s.altnet.rippletest.net:51233');
  });

  it('reconnects to devnet URL after switchNetwork("devnet")', async () => {
    const conn = makeConn();
    await conn.connect();
    xrpl.Client.mockClear();
    await conn.switchNetwork('devnet');
    expect(xrpl.Client).toHaveBeenCalledWith('wss://s.devnet.rippletest.net:51233');
  });

  it('restores getCurrentNetwork to mainnet after switching back', async () => {
    const conn = makeConn();
    await conn.connect();
    await conn.switchNetwork('testnet');
    await conn.switchNetwork('mainnet');
    expect(conn.getCurrentNetwork()).toBe('mainnet');
  });
});
