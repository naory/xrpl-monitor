/**
 * Integration tests for the WebSocket server.
 * Requires Redis Stack (docker-compose). Skips gracefully when unavailable.
 */
const http      = require('http');
const WebSocket = require('ws');
const Redis     = require('ioredis');
const express   = require('express');
const { createWebSocketServer } = require('../../src/api/ws');
const { publishFill }           = require('../../src/redis/publisher');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  lazyConnect: true,
  connectTimeout: 3000,
});

let available  = false;
let httpServer = null;
let wsHandler  = null;
let baseUrl    = '';

const sampleFill = {
  txHash: 'WSTEST01', ledgerIndex: 100, ledgerTime: new Date(),
  account: 'rA', pairKey: 'test~pair', fillType: 'full',
  getsCurrency: 'XRP', getsIssuer: null, getsValue: '1.000000',
  paysCurrency: 'USD', paysIssuer: 'rI1', paysValue: '2',
};

beforeAll(async () => {
  try {
    await redis.connect();
    available = true;
  } catch {
    console.warn('[INTEGRATION] Redis unavailable — skipping ws tests');
    return;
  }

  const app = express();
  httpServer = http.createServer(app);
  wsHandler  = createWebSocketServer({ httpServer, redis });

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  baseUrl = `ws://localhost:${port}`;
});

afterAll(async () => {
  if (wsHandler) await wsHandler.close();
  if (httpServer) await new Promise((r) => httpServer.close(r));
  await redis.quit().catch(() => {});
});

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);
    ws.once('message', (data) => { clearTimeout(timer); resolve(JSON.parse(data)); });
  });
}

describe('WebSocket server', () => {
  it('accepts a client connection', async () => {
    if (!available) return;
    const ws = await connectWs(baseUrl);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('forwards a fill published to Redis to connected clients', async () => {
    if (!available) return;
    const ws = await connectWs(baseUrl);

    // Small delay to ensure subscription is established before publishing
    await new Promise((r) => setTimeout(r, 100));

    const messagePromise = waitForMessage(ws);
    await publishFill(redis, sampleFill);

    const envelope = await messagePromise;
    expect(envelope.channel).toBe('fills');
    const msg = JSON.parse(envelope.raw);
    expect(msg.type).toBe('fill');
    expect(msg.data.txHash).toBe('WSTEST01');
    ws.close();
  });

  it('delivers messages to multiple simultaneously connected clients', async () => {
    if (!available) return;
    const [ws1, ws2] = await Promise.all([connectWs(baseUrl), connectWs(baseUrl)]);
    await new Promise((r) => setTimeout(r, 100));

    const [p1, p2] = [waitForMessage(ws1), waitForMessage(ws2)];
    await publishFill(redis, { ...sampleFill, txHash: 'MULTI01' });

    const [m1, m2] = await Promise.all([p1, p2]);
    expect(JSON.parse(m1.raw).data.txHash).toBe('MULTI01');
    expect(JSON.parse(m2.raw).data.txHash).toBe('MULTI01');
    ws1.close();
    ws2.close();
  });
});
