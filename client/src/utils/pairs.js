const MPT_PREFIX = 'MPT:';

export function isMptCurrency(c) {
  return typeof c === 'string' && c.startsWith(MPT_PREFIX);
}

// Returns 'mpt' if either side of the pair is an MPT, else 'iou'.
export function pairMode(pairKey) {
  const [left = '', right = ''] = pairKey.split('~');
  const currency = (side) => side.split('|')[0];
  return isMptCurrency(currency(left)) || isMptCurrency(currency(right)) ? 'mpt' : 'iou';
}

// Short human label for display.
// MPT currencies: show 'MPT·' + first 8 hex chars of the issuance ID (the sequence portion).
export function tokenLabel(pairKey) {
  const [left, right = ''] = pairKey.split('~');
  const sym = (side) => {
    const c = side.split('|')[0];
    return isMptCurrency(c) ? `MPT·${c.slice(MPT_PREFIX.length, MPT_PREFIX.length + 8)}` : c;
  };
  return `${sym(left)}/${sym(right)}`;
}

/**
 * Collapses leaderboard entries that share the same token label (same currencies,
 * different issuers) into one row.  The highest-volume issuer's pairKey is kept
 * as `primaryPairKey` so callers can still fetch OHLCV / order-book data.
 *
 * Pass `mode` ('iou' | 'mpt') to pre-filter before aggregating.
 */
export function aggregateByToken(pairs, mode) {
  const filtered = mode ? pairs.filter((p) => pairMode(p.pairKey) === mode) : pairs;
  const map = new Map();
  for (const { pairKey, volume } of filtered) {
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
