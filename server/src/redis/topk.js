const TOPK_KEY = 'pairs:topk';
const TOPK_K = 20;

async function ensureTopK(redis) {
  try {
    await redis.call('TOPK.RESERVE', TOPK_KEY, TOPK_K, 50, 5, 0.9);
  } catch (err) {
    // TOPK.RESERVE errors if the key already exists — that is fine
    if (!err.message?.includes('already exists')) throw err;
  }
}

async function incrementPair(redis, pairKey) {
  await redis.call('TOPK.INCRBY', TOPK_KEY, pairKey, 1);
}

async function incrementPairs(redis, pairKeys) {
  if (!pairKeys.length) return;
  const args = pairKeys.flatMap((k) => [k, 1]);
  await redis.call('TOPK.INCRBY', TOPK_KEY, ...args);
}

async function getTopK(redis) {
  const result = await redis.call('TOPK.LIST', TOPK_KEY, 'WITHCOUNT');
  const pairs = [];
  for (let i = 0; i < result.length; i += 2) {
    if (result[i] !== null) {
      pairs.push({ pairKey: result[i], count: Number(result[i + 1]) });
    }
  }
  return pairs;
}

module.exports = { ensureTopK, incrementPair, incrementPairs, getTopK, TOPK_KEY };
