export function tokenLabel(pairKey) {
  const [left, right = ''] = pairKey.split('~');
  const sym = (s) => s.split('|')[0];
  return `${sym(left)}/${sym(right)}`;
}

/**
 * Collapses leaderboard entries that share the same token label (same currencies,
 * different issuers) into one row.  The highest-volume issuer's pairKey is kept
 * as `primaryPairKey` so callers can still fetch OHLCV / order-book data.
 */
export function aggregateByToken(pairs) {
  const map = new Map();
  for (const { pairKey, volume } of pairs) {
    const label = tokenLabel(pairKey);
    const entry = map.get(label) ?? { totalVolume: 0, issuers: [] };
    entry.totalVolume += parseFloat(volume) || 0;
    entry.issuers.push({ pairKey, volume: parseFloat(volume) || 0 });
    map.set(label, entry);
  }

  return Array.from(map.entries())
    .map(([label, { totalVolume, issuers }]) => {
      issuers.sort((a, b) => b.volume - a.volume);
      return {
        label,
        volume: totalVolume,
        issuerCount: issuers.length,
        pairKey: issuers[0].pairKey, // most-liquid issuer drives OHLCV / order book
      };
    })
    .sort((a, b) => b.volume - a.volume);
}
