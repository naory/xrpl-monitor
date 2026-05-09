const xrpl = require('xrpl');

const XRPL_ENDPOINTS = {
  mainnet: 'wss://s1.ripple.com/',
  testnet: 'wss://s.altnet.rippletest.net:51233',
};

function resolveEndpoint() {
  const net = process.env.XRPL_NET || 'mainnet';
  if (net.startsWith('ws://') || net.startsWith('wss://')) return net;
  return XRPL_ENDPOINTS[net] ?? XRPL_ENDPOINTS.mainnet;
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
  const url = resolveEndpoint();
  let client = null;
  let reconnectDelay = 1000;
  const MAX_DELAY = 30000;
  let stopped = false;

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
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
    console.log(`[XRPL] Reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
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

  return { connect, disconnect, isConnected, request, subscribeOrderBook, unsubscribeOrderBook, requestOrderBook };
}

module.exports = { createXrplConnection };
