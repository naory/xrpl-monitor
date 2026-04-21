const META_KEY = 'pairs:meta';

function encodePairMeta({ getsCurrency, getsIssuer, paysCurrency, paysIssuer }) {
  return JSON.stringify({ getsCurrency, getsIssuer, paysCurrency, paysIssuer });
}

function decodePairMeta(str) {
  try {
    if (!str) return null;
    const d = JSON.parse(str);
    if (!d.getsCurrency || !d.paysCurrency) return null;
    return {
      getsCurrency: d.getsCurrency,
      getsIssuer:   d.getsIssuer ?? null,
      paysCurrency: d.paysCurrency,
      paysIssuer:   d.paysIssuer ?? null,
    };
  } catch {
    return null;
  }
}

async function persistPairMeta(redis, pairKey, details) {
  await redis.hset(META_KEY, pairKey, encodePairMeta(details));
}

async function loadAllPairMeta(redis) {
  const raw = await redis.hgetall(META_KEY);
  if (!raw) return new Map();
  const result = new Map();
  for (const [pairKey, encoded] of Object.entries(raw)) {
    const details = decodePairMeta(encoded);
    if (details) result.set(pairKey, details);
  }
  return result;
}

module.exports = { encodePairMeta, decodePairMeta, persistPairMeta, loadAllPairMeta, META_KEY };
