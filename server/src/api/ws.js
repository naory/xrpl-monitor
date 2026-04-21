const { WebSocketServer } = require('ws');
const { CHANNELS } = require('../redis/publisher');

const SUBSCRIBED_CHANNELS = [CHANNELS.FILLS, CHANNELS.TOPK_CHANGED];

function createWebSocketServer({ httpServer, redis }) {
  const wss = new WebSocketServer({ server: httpServer });

  // Each WebSocketServer needs its own subscriber connection —
  // a Redis client in subscribe mode cannot issue normal commands.
  const subscriber = redis.duplicate();

  subscriber.subscribe(...SUBSCRIBED_CHANNELS).then(() => {
    console.log(`[WS] Subscribed to Redis channels: ${SUBSCRIBED_CHANNELS.join(', ')}`);
  }).catch((err) => {
    console.error('[WS] Failed to subscribe to Redis channels:', err.message);
  });

  subscriber.on('message', (channel, message) => {
    const payload = JSON.stringify({ channel, raw: message });
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(payload, (err) => {
          if (err) console.error('[WS] Send error:', err.message);
        });
      }
    }
  });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[WS] Client connected from ${ip} (total: ${wss.clients.size})`);
    ws.on('close', () => {
      console.log(`[WS] Client disconnected (total: ${wss.clients.size})`);
    });
    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
    });
  });

  async function close() {
    await subscriber.unsubscribe(...SUBSCRIBED_CHANNELS).catch(() => {});
    await subscriber.quit().catch(() => {});
    wss.close();
  }

  return { wss, close };
}

module.exports = { createWebSocketServer };
