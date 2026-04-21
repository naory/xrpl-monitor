/**
 * Integration tests for volume sorted sets.
 * Requires Redis Stack (docker-compose). Skips gracefully when unavailable.
 */
const Redis = require('ioredis');
const { recordVolume, trimWindows, getVolumeLeaderboard, LOG_KEY, RANK_KEY } = require('../../src/redis/volume');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  lazyConnect: true,
  connectTimeout: 3000,
});

let available = false;

beforeAll(async () => {
  try { await redis.connect(); available = true; }
  catch { console.warn('[INTEGRATION] Redis unavailable — skipping volume tests'); }
});

afterAll(async () => { await redis.quit().catch(() => {}); });

async function flushVolumeKeys() {
  for (const w of ['10m', '1h', '24h']) {
    await redis.del(LOG_KEY(w));
    await redis.del(RANK_KEY(w));
  }
}

const makeFill = (pairKey, getsValue) => ({
  pairKey, getsValue,
  getsCurrency: 'XRP', getsIssuer: null,
  paysCurrency: 'USD', paysIssuer: 'rI1',
});

describe('recordVolume', () => {
  beforeEach(async () => { if (available) await flushVolumeKeys(); });

  it('records volume in all three windows', async () => {
    if (!available) return;
    await recordVolume(redis, [makeFill('A~B', '10')]);
    for (const w of ['10m', '1h', '24h']) {
      const leaderboard = await getVolumeLeaderboard(redis, w);
      expect(leaderboard).toHaveLength(1);
      expect(leaderboard[0].pairKey).toBe('A~B');
      expect(leaderboard[0].volume).toBeCloseTo(10);
    }
  });

  it('accumulates volume across multiple fills for the same pair', async () => {
    if (!available) return;
    await recordVolume(redis, [makeFill('A~B', '5'), makeFill('A~B', '3')]);
    const [top] = await getVolumeLeaderboard(redis, '1h');
    expect(top.volume).toBeCloseTo(8);
  });

  it('ranks multiple pairs by descending volume', async () => {
    if (!available) return;
    await recordVolume(redis, [makeFill('A~B', '100'), makeFill('C~D', '50'), makeFill('E~F', '200')]);
    const board = await getVolumeLeaderboard(redis, '1h');
    expect(board[0].volume).toBeCloseTo(200);
    expect(board[1].volume).toBeCloseTo(100);
    expect(board[2].volume).toBeCloseTo(50);
  });

  it('is a no-op for empty fills array', async () => {
    if (!available) return;
    await expect(recordVolume(redis, [])).resolves.not.toThrow();
  });
});

describe('trimWindows', () => {
  beforeEach(async () => { if (available) await flushVolumeKeys(); });

  it('removes volume of expired fills from the leaderboard', async () => {
    if (!available) return;

    const past   = Date.now() - 25 * 60 * 1000; // 25 minutes ago — outside 10m and 1h windows
    const recent = Date.now();

    await recordVolume(redis, [makeFill('A~B', '100')], past);
    await recordVolume(redis, [makeFill('A~B', '20')],  recent);

    await trimWindows(redis);

    // 10m window: only recent fill should remain
    const board10m = await getVolumeLeaderboard(redis, '10m');
    expect(board10m).toHaveLength(1);
    expect(board10m[0].volume).toBeCloseTo(20);

    // 24h window: both fills still within window
    const board24h = await getVolumeLeaderboard(redis, '24h');
    expect(board24h[0].volume).toBeCloseTo(120);
  });

  it('removes pair entirely from leaderboard when all its fills expire', async () => {
    if (!available) return;

    const past = Date.now() - 25 * 60 * 1000;
    await recordVolume(redis, [makeFill('X~Y', '50')], past);
    await trimWindows(redis);

    const board10m = await getVolumeLeaderboard(redis, '10m');
    expect(board10m.find((p) => p.pairKey === 'X~Y')).toBeUndefined();
  });
});
