# Network Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hot-switch the XRPL WebSocket connection between Mainnet, Testnet, and Devnet from the UI without restarting the server.

**Architecture:** A `POST /network/switch` endpoint calls `xrplClient.switchNetwork(name)` which disconnects and reconnects the XRPL client, then publishes a `{ type: 'network_change', data: { network } }` WebSocket event. The client renders a network selector in the app header; on switch it fires the REST call and waits for the WS confirmation to clear live store state. Network defaults to `'mainnet'` on restart — no persistence.

**Tech Stack:** Node.js/Express, xrpl.js v4, ioredis pub/sub, Jest (server unit tests), React + MUI, Zustand, Vitest (client unit tests)

---

### Task 1: Server — `switchNetwork` and `getCurrentNetwork` in xrplClient.js

**Files:**
- Modify: `server/src/ingest/xrplClient.js`
- Create: `server/tests/unit/xrplClient.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/tests/unit/xrplClient.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npm test -- --testPathPattern=xrplClient
```

Expected: `TypeError: conn.switchNetwork is not a function` (or similar).

- [ ] **Step 3: Implement changes in xrplClient.js**

Replace the entire file with:

```js
const xrpl = require('xrpl');

const XRPL_ENDPOINTS = {
  mainnet: 'wss://s1.ripple.com/',
  testnet: 'wss://s.altnet.rippletest.net:51233',
  devnet:  'wss://s.devnet.rippletest.net:51233',
};

function resolveEndpoint() {
  const net = process.env.XRPL_NET || 'mainnet';
  if (net.startsWith('ws://') || net.startsWith('wss://')) return net;
  return XRPL_ENDPOINTS[net] ?? XRPL_ENDPOINTS.mainnet;
}

function resolveNetworkName() {
  const net = process.env.XRPL_NET || 'mainnet';
  return XRPL_ENDPOINTS[net] ? net : 'mainnet';
}

// Normalise raw XRPL ledger close event to a stable internal shape (FF-5).
function normaliseLedgerClose(event) {
  return {
    ledgerIndex: event.ledger_index,
    txnCount:    event.txn_count ?? 0,
    ledgerTime:  event.ledger_time ?? null,
  };
}

function createXrplConnection({ onTransaction, onLedgerClosed, onStateChange }) {
  let url = resolveEndpoint();
  let currentNetworkName = resolveNetworkName();
  let client = null;
  let reconnectDelay = 1000;
  const MAX_DELAY = 30000;
  let stopped = false;
  let switching = false;

  async function connect() {
    if (stopped) return;
    client = new xrpl.Client(url);

    client.on('transaction', onTransaction);
    client.on('ledgerClosed', (raw) => onLedgerClosed(normaliseLedgerClose(raw)));
    client.on('disconnected', () => {
      onStateChange({ connected: false });
      if (!stopped) scheduleReconnect();
    });
    client.on('error', (err) => {
      console.error('[XRPL] WebSocket error:', err.message);
    });

    try {
      await client.connect();
      reconnectDelay = 1000;
      onStateChange({ connected: true });
      console.log(`[XRPL] Connected to ${url}`);

      await client.request({ command: 'subscribe', streams: ['transactions', 'ledger'] });
      console.log('[XRPL] Subscribed to transactions and ledger streams');
    } catch (err) {
      console.error('[XRPL] Connection failed:', err.message);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (switching) return; // intentional disconnect during switch — connect() called directly
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
    console.log(`[XRPL] Reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
  }

  async function switchNetwork(name) {
    if (!XRPL_ENDPOINTS[name]) {
      const err = new Error(`Unknown network: ${name}`);
      err.status = 400;
      throw err;
    }
    if (switching) {
      const err = new Error('Switch already in progress');
      err.status = 409;
      throw err;
    }
    switching = true;
    try {
      if (client?.isConnected()) await client.disconnect();
      url = XRPL_ENDPOINTS[name];
      currentNetworkName = name;
      await connect();
    } finally {
      switching = false;
    }
  }

  function getCurrentNetwork() {
    return currentNetworkName;
  }

  // Subscribe to an order book and return the snapshot bids/asks.
  async function subscribeOrderBook(takerGets, takerPays) {
    if (!client?.isConnected()) throw new Error('XRPL client not connected');
    const response = await client.request({
      command: 'subscribe',
      books: [{ taker_gets: takerGets, taker_pays: takerPays, snapshot: true, both: true }],
    });
    return {
      bids:        response.result?.bids ?? [],
      asks:        response.result?.asks ?? [],
      ledgerIndex: response.result?.ledger_current_index ?? null,
    };
  }

  async function unsubscribeOrderBook(takerGets, takerPays) {
    if (!client?.isConnected()) return;
    await client.request({
      command: 'unsubscribe',
      books: [{ taker_gets: takerGets, taker_pays: takerPays }],
    });
  }

  // Fetch current order book without maintaining a subscription.
  async function requestOrderBook(takerGets, takerPays, { limit = 20, timeoutMs = 3000 } = {}) {
    if (!client?.isConnected()) throw new Error('XRPL client not connected');
    const request = client.request({ command: 'book_offers', taker_gets: takerGets, taker_pays: takerPays, limit });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('requestOrderBook timed out')), timeoutMs)
    );
    const response = await Promise.race([request, timeout]);
    return response.result?.offers ?? [];
  }

  async function request(req) {
    if (!client?.isConnected()) throw new Error('XRPL client not connected');
    return client.request(req);
  }

  function isConnected() {
    return client?.isConnected() ?? false;
  }

  async function disconnect() {
    stopped = true;
    if (client?.isConnected()) await client.disconnect();
  }

  return {
    connect, disconnect, isConnected, request,
    subscribeOrderBook, unsubscribeOrderBook, requestOrderBook,
    switchNetwork, getCurrentNetwork,
  };
}

module.exports = { createXrplConnection };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npm test -- --testPathPattern=xrplClient
```

Expected: 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/ingest/xrplClient.js server/tests/unit/xrplClient.test.js
git commit -m "feat: add switchNetwork and getCurrentNetwork to xrplClient"
```

---

### Task 2: Server — `NETWORK` channel in publisher.js

**Files:**
- Modify: `server/src/redis/publisher.js`
- Modify: `server/tests/unit/publisher.test.js`

- [ ] **Step 1: Add tests to publisher.test.js**

Append to the end of `server/tests/unit/publisher.test.js`:

```js
const { CHANNELS, buildNetworkChangeMessage } = require('../../src/redis/publisher');

describe('CHANNELS.NETWORK', () => {
  it('equals xrpl:network', () => {
    expect(CHANNELS.NETWORK).toBe('xrpl:network');
  });
});

describe('buildNetworkChangeMessage', () => {
  it('sets type to network_change', () => {
    expect(buildNetworkChangeMessage('testnet').type).toBe('network_change');
  });

  it('wraps network in data', () => {
    const msg = buildNetworkChangeMessage('testnet');
    expect(msg.data.network).toBe('testnet');
  });

  it('is JSON-serialisable', () => {
    expect(() => JSON.stringify(buildNetworkChangeMessage('mainnet'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
cd server && npm test -- --testPathPattern=publisher
```

Expected: 3 failures on `CHANNELS.NETWORK` and `buildNetworkChangeMessage`.

- [ ] **Step 3: Add NETWORK channel and message builder to publisher.js**

In `server/src/redis/publisher.js`, make these two changes:

1. Add `NETWORK` to the `CHANNELS` object (after `ESCROW`):

```js
const CHANNELS = {
  FILLS:        'fills',
  TOPK_CHANGED: 'topk:changed',
  BRIDGE:       'bridge:fill',
  XRP_DEMAND:   'xrpl:xrp-demand',
  ESCROW:       'xrpl:escrow',
  NETWORK:      'xrpl:network',
  BOOK:         (pairKey) => `book:${pairKey}`,
};
```

2. Add the message builder and publisher before `module.exports`:

```js
function buildNetworkChangeMessage(network) {
  return {
    type: 'network_change',
    data: { network },
  };
}

async function publishNetworkChange(redis, network) {
  const msg = JSON.stringify(buildNetworkChangeMessage(network));
  await redis.publish(CHANNELS.NETWORK, msg);
}
```

3. Add `buildNetworkChangeMessage` and `publishNetworkChange` to `module.exports`:

```js
module.exports = {
  CHANNELS,
  buildFillMessage,
  buildTopKChangedMessage,
  buildBridgeMessage,
  buildXrpDemandMessage,
  buildEscrowMessage,
  buildNetworkChangeMessage,
  publishFill,
  publishTopKChanged,
  publishBridge,
  publishXrpDemand,
  publishEscrow,
  publishNetworkChange,
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npm test -- --testPathPattern=publisher
```

Expected: all existing + 3 new tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/redis/publisher.js server/tests/unit/publisher.test.js
git commit -m "feat: add NETWORK channel and buildNetworkChangeMessage to publisher"
```

---

### Task 3: Server — `network.js` router, health network field, and wire-up

**Files:**
- Create: `server/src/api/network.js`
- Modify: `server/src/api/health.js`
- Modify: `server/src/api/app.js`
- Modify: `server/src/api/ws.js`
- Modify: `server/tests/unit/health.test.js`
- Create: `server/tests/unit/network.test.js`

- [ ] **Step 1: Write failing tests for network router validation**

Create `server/tests/unit/network.test.js`:

```js
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
```

- [ ] **Step 2: Write failing tests for health network field**

Append to `server/tests/unit/health.test.js` (before the closing of the file):

```js
describe('buildHealthReport network field', () => {
  const base = {
    xrplConnected: true,
    lastLedgerIndex: 90000005,
    lastKnownLedger: 90000000,
    currentLedger: 90000005,
    dbOk: true,
    redisOk: true,
    uptimeSeconds: 120,
  };

  it('includes network field in report', () => {
    const report = buildHealthReport({ ...base, network: 'testnet' });
    expect(report.network).toBe('testnet');
  });

  it('defaults network to mainnet when not provided', () => {
    const report = buildHealthReport(base);
    expect(report.network).toBe('mainnet');
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd server && npm test -- --testPathPattern="network|health"
```

Expected: failures on `VALID_NETWORKS`, `validateNetworkName`, and `buildHealthReport network field`.

- [ ] **Step 4: Create `server/src/api/network.js`**

```js
const { Router } = require('express');
const { publishNetworkChange } = require('../redis/publisher');

const VALID_NETWORKS = ['mainnet', 'testnet', 'devnet'];

function validateNetworkName(name) {
  if (!name || !VALID_NETWORKS.includes(name)) {
    return `Invalid network "${name}". Must be one of: ${VALID_NETWORKS.join(', ')}`;
  }
  return null;
}

function createNetworkRouter({ xrplClient, redis }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ network: xrplClient.getCurrentNetwork() });
  });

  router.post('/switch', async (req, res) => {
    const { network } = req.body;
    const err = validateNetworkName(network);
    if (err) return res.status(400).json({ error: err });

    try {
      await xrplClient.switchNetwork(network);
      await publishNetworkChange(redis, network);
      res.json({ network });
    } catch (e) {
      res.status(e.status ?? 500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { VALID_NETWORKS, validateNetworkName, createNetworkRouter };
```

- [ ] **Step 5: Update `buildHealthReport` in health.js to include `network`**

In `server/src/api/health.js`, change the function signature and return value:

```js
function buildHealthReport({ xrplConnected, lastLedgerIndex, lastKnownLedger, currentLedger, dbOk, redisOk, uptimeSeconds, network = 'mainnet' }) {
  const gap = detectGap({ lastKnownLedger, currentLedger });

  const checks = {
    xrpl: xrplConnected
      ? { status: 'ok', lastLedgerIndex }
      : { status: 'error', message: 'XRPL WebSocket disconnected' },
    database: dbOk
      ? { status: 'ok' }
      : { status: 'error', message: 'Database unreachable' },
    redis: redisOk
      ? { status: 'ok' }
      : { status: 'error', message: 'Redis unreachable' },
    ledgerGap: gap,
  };

  const degraded = !xrplConnected || !dbOk || !redisOk;

  return {
    status: degraded ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    network,
    checks,
  };
}
```

Update `createHealthRouter` to accept and use `xrplClient`:

```js
function createHealthRouter({ state, pool, redis, xrplClient }) {
  const express = require('express');
  const router = express.Router();

  router.get('/', async (req, res) => {
    let dbOk = false;
    let redisOk = false;

    try {
      await pool.query('SELECT 1');
      dbOk = true;
    } catch (_) {}

    try {
      await redis.ping();
      redisOk = true;
    } catch (_) {}

    const report = buildHealthReport({
      xrplConnected: state.xrplConnected,
      lastLedgerIndex: state.lastLedgerIndex,
      lastKnownLedger: state.lastKnownLedger,
      currentLedger: state.currentLedger,
      dbOk,
      redisOk,
      uptimeSeconds: Math.floor(process.uptime()),
      network: xrplClient?.getCurrentNetwork() ?? 'mainnet',
    });

    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  return router;
}
```

- [ ] **Step 6: Update `app.js` to mount the network router and pass `xrplClient` to health**

Replace the `createApp` function body in `server/src/api/app.js`:

```js
const { createNetworkRouter } = require('./network');

function createApp({ pool, redis, state, xrplClient, pairRegistry }) {
  const app = express();
  app.use(express.json());

  app.use('/health',     createHealthRouter({ state, pool, redis, xrplClient }));
  app.use('/book',       createBookRouter({ redis, xrplClient, pairRegistry }));
  app.use('/fills',      createFillsRouter({ pool, redis }));
  app.use('/amm',        createAmmRouter({ redis }));
  app.use('/ledger',     createLedgerRouter({ redis }));
  app.use('/bridge',     createBridgeRouter({ pool }));
  app.use('/xrp-demand', createXrpDemandRouter({ pool }));
  app.use('/escrow',     createEscrowRouter({ pool }));
  app.use('/network',    createNetworkRouter({ xrplClient, redis }));

  return app;
}
```

Add the import for `createNetworkRouter` at the top of the file with the other imports:

```js
const { createNetworkRouter }    = require('./network');
```

- [ ] **Step 7: Add `CHANNELS.NETWORK` to ws.js subscriptions**

In `server/src/api/ws.js`, update `SUBSCRIBED_CHANNELS`:

```js
const SUBSCRIBED_CHANNELS = [
  CHANNELS.FILLS,
  CHANNELS.TOPK_CHANGED,
  CHANNELS.BRIDGE,
  CHANNELS.XRP_DEMAND,
  CHANNELS.ESCROW,
  CHANNELS.NETWORK,
];
```

- [ ] **Step 8: Run all tests**

```bash
cd server && npm test
```

Expected: all tests pass including the 4 new network tests and 2 new health tests.

- [ ] **Step 9: Commit**

```bash
git add server/src/api/network.js server/src/api/health.js server/src/api/app.js server/src/api/ws.js server/tests/unit/health.test.js server/tests/unit/network.test.js
git commit -m "feat: network router, health network field, NETWORK WS channel"
```

---

### Task 4: Client — store `setNetwork` + socket routing

**Files:**
- Modify: `client/src/store/useWsStore.js`
- Modify: `client/src/api/socket.js`
- Modify: `client/src/store/useWsStore.test.js`

- [ ] **Step 1: Write failing tests**

Append to the end of `client/src/store/useWsStore.test.js` (do not replace the file — it already exists):

```js
describe('setNetwork', () => {
  beforeEach(() => {
    useWsStore.setState({
      currentNetwork: 'mainnet',
      escrowEvents: [{ txType: 'EscrowCreate' }, { txType: 'EscrowFinish' }],
    });
  });

  it('updates currentNetwork', () => {
    useWsStore.getState().setNetwork('testnet');
    expect(useWsStore.getState().currentNetwork).toBe('testnet');
  });

  it('clears escrowEvents on network switch', () => {
    useWsStore.getState().setNetwork('testnet');
    expect(useWsStore.getState().escrowEvents).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd client && npm test -- --reporter=verbose useWsStore
```

Expected: `useWsStore.getState().setNetwork is not a function`.

- [ ] **Step 3: Add `currentNetwork` and `setNetwork` to `useWsStore.js`**

In `client/src/store/useWsStore.js`, inside the `create((set) => ({` object, add after `escrowEvents: []`:

```js
  currentNetwork: 'mainnet',
```

Add the `setNetwork` action after `addEscrowEvent`:

```js
  setNetwork: (network) => set(() => ({
    currentNetwork: network,
    escrowEvents: [],
  })),
```

- [ ] **Step 4: Add `network_change` routing in `socket.js`**

In `client/src/api/socket.js`, add one line in the `ws.onmessage` handler after the `escrow` line:

```js
      if (msg.type === 'network_change') store.setNetwork(msg.data.network);
```

The full `onmessage` block becomes:

```js
    ws.onmessage = ({ data }) => {
      const msg = parseWsMessage(data);
      if (!msg) return;
      if (msg.type === 'fill')           store.addFill(msg.data);
      if (msg.type === 'topk:changed')   store.setTopK(msg.data.pairs ?? []);
      if (msg.type === 'bridge:fill')    store.addBridge(msg.data);
      if (msg.type === 'xrp-demand')     store.addXrpDemand(msg.data);
      if (msg.type === 'escrow')         store.addEscrowEvent(msg.data);
      if (msg.type === 'network_change') store.setNetwork(msg.data.network);
    };
```

- [ ] **Step 5: Run tests**

```bash
cd client && npm test -- --reporter=verbose useWsStore
```

Expected: 3 passing tests. (The `getInitialState` test may need adjustment — if the store doesn't expose it, that test is fine to skip since the default is covered by the `currentNetwork: 'mainnet'` declaration.)

- [ ] **Step 6: Commit**

```bash
git add client/src/store/useWsStore.js client/src/api/socket.js client/src/store/useWsStore.test.js
git commit -m "feat: add setNetwork to store and route network_change in socket"
```

---

### Task 5: Client — HTTP functions and Vite proxy

**Files:**
- Modify: `client/src/api/http.js`
- Modify: `client/vite.config.js`

No unit tests needed — these are trivial axios wrappers and config entries.

- [ ] **Step 1: Add `fetchCurrentNetwork` and `switchNetwork` to `http.js`**

Append to the end of `client/src/api/http.js`:

```js
export function fetchCurrentNetwork() {
  return api.get('/network').then((r) => r.data);
}

export function switchNetwork(network) {
  return api.post('/network/switch', { network }).then((r) => r.data);
}
```

- [ ] **Step 2: Add `/network` proxy to `vite.config.js`**

In `client/vite.config.js`, add the `/network` entry inside the `proxy` object (after `/escrow`):

```js
      '/network':     { target: 'http://127.0.0.1:3001', changeOrigin: true },
```

The full proxy block becomes:

```js
    proxy: {
      '/fills':       { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/book':        { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/health':      { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/amm':         { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/ledger':      { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/bridge':      { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/xrp-demand':  { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/escrow':      { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/network':     { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/ws':          { target: 'ws://127.0.0.1:3001', ws: true },
    },
```

- [ ] **Step 3: Commit**

```bash
git add client/src/api/http.js client/vite.config.js
git commit -m "feat: add fetchCurrentNetwork and switchNetwork to http, add /network proxy"
```

---

### Task 6: Client — Network selector UI in App.jsx

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Add imports and state to `App.jsx`**

Add these imports at the top of `client/src/App.jsx`:

```jsx
import { useRef } from 'react';
import { Select, MenuItem, Snackbar, Alert } from '@mui/material';
import { fetchCurrentNetwork, switchNetwork as switchNetworkApi } from './api/http';
```

Change the existing import line from:
```jsx
import { useEffect, useState } from 'react';
```
to:
```jsx
import { useEffect, useRef, useState } from 'react';
```

Inside the `App()` function body, add after `const [window, setWindow] = useState('1h');`:

```jsx
  const [pendingNetwork, setPendingNetwork] = useState(null);
  const [networkError, setNetworkError]     = useState(false);
  const switchTimerRef                      = useRef(null);
  const currentNetwork = useWsStore((s) => s.currentNetwork);
  const setNetwork     = useWsStore((s) => s.setNetwork);
```

- [ ] **Step 2: Add fetch-on-mount and switch handler**

Replace the existing `useEffect` that sets up the socket connection with:

```jsx
  useEffect(() => {
    const disconnect = createSocketConnection(WS_URL, useWsStore.getState());
    fetchCurrentNetwork().then(({ network }) => setNetwork(network)).catch(() => {});
    return disconnect;
  }, []);
```

Add the network switch handler and WS confirmation watcher after the useEffect:

```jsx
  async function handleNetworkChange(e) {
    const name = e.target.value;
    if (name === currentNetwork || pendingNetwork) return;
    setPendingNetwork(name);
    switchTimerRef.current = setTimeout(() => {
      setPendingNetwork(null);
      setNetworkError(true);
    }, 5000);
    try {
      await switchNetworkApi(name);
    } catch {
      clearTimeout(switchTimerRef.current);
      setPendingNetwork(null);
      setNetworkError(true);
    }
  }

  useEffect(() => {
    if (pendingNetwork && currentNetwork === pendingNetwork) {
      clearTimeout(switchTimerRef.current);
      setPendingNetwork(null);
    }
  }, [currentNetwork]);
```

- [ ] **Step 3: Add the network selector element to the Toolbar**

In the JSX, find this block in the Toolbar:

```jsx
          <Box sx={{ flex: 1 }} />
          <ConnectionStatus />
```

Replace it with:

```jsx
          <Box sx={{ flex: 1 }} />

          {/* Network selector */}
          <Select
            value={pendingNetwork ?? currentNetwork}
            onChange={handleNetworkChange}
            disabled={!!pendingNetwork}
            size="small"
            variant="outlined"
            sx={{
              height: 26,
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: 0.5,
              color: pendingNetwork ? 'text.secondary' : (
                currentNetwork === 'mainnet' ? 'success.main' :
                currentNetwork === 'testnet' ? 'warning.main' : 'info.main'
              ),
              '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.12)' },
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.3)' },
            }}
          >
            <MenuItem value="mainnet" sx={{ fontSize: '0.7rem', fontWeight: 700 }}>MAINNET</MenuItem>
            <MenuItem value="testnet" sx={{ fontSize: '0.7rem', fontWeight: 700 }}>TESTNET</MenuItem>
            <MenuItem value="devnet"  sx={{ fontSize: '0.7rem', fontWeight: 700 }}>DEVNET</MenuItem>
          </Select>

          <ConnectionStatus />

          <Snackbar
            open={networkError}
            autoHideDuration={4000}
            onClose={() => setNetworkError(false)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          >
            <Alert severity="error" onClose={() => setNetworkError(false)} sx={{ fontSize: '0.8rem' }}>
              Network switch failed. Please try again.
            </Alert>
          </Snackbar>
```

- [ ] **Step 4: Run the client test suite**

```bash
cd client && npm test
```

Expected: all existing tests pass. No new tests for this task (UI verified manually).

- [ ] **Step 5: Manual verification**

Start the server and client (requires Postgres + Redis running):

```bash
# terminal 1
cd server && npm start

# terminal 2
cd client && npm run dev
```

Open `http://127.0.0.1:3000` and verify:
1. Network selector shows `MAINNET` in green on load
2. Clicking `TESTNET` → selector shows testnet in orange while switching (disabled), then confirms
3. The ESCROW TIME live feed clears on switch
4. After switching to testnet, new events in the live feeds are from the testnet ledger
5. Clicking `MAINNET` switches back; feed clears again
6. Restarting the server resets to mainnet (selector shows MAINNET on next load)

- [ ] **Step 6: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: network selector UI in app header with optimistic update and WS confirmation"
```
