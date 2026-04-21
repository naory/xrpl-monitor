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
    client.on('ledgerClosed', onLedgerClosed);
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

  function isConnected() {
    return client?.isConnected() ?? false;
  }

  async function disconnect() {
    stopped = true;
    if (client?.isConnected()) await client.disconnect();
  }

  return { connect, disconnect, isConnected };
}

module.exports = { createXrplConnection };
