import { create } from 'zustand';

const MAX_FILLS = 50;
const MAX_BRIDGES = 100;
const BUCKET_SECONDS = 30;

function bucketEpoch(dateMs) {
  const sec = Math.floor(dateMs / 1000);
  return Math.floor(sec / BUCKET_SECONDS) * BUCKET_SECONDS;
}

function xrpVolume(fill) {
  if (fill.getsCurrency === 'XRP') return parseFloat(fill.getsValue) || 0;
  if (fill.paysCurrency === 'XRP') return parseFloat(fill.paysValue) || 0;
  return parseFloat(fill.getsValue) || 0;
}

function computeCandle(fills) {
  const prices = fills.map((f) => parseFloat(f.price));
  return {
    open:        prices[0],
    high:        Math.max(...prices),
    low:         Math.min(...prices),
    close:       prices[prices.length - 1],
    volume:      fills.reduce((s, f) => s + xrpVolume(f), 0),
    trade_count: fills.length,
  };
}

// Canonical price: always right-side / left-side of the pairKey.
// pairKey = "LEFT~RIGHT" (lexicographic order). Direction A fills have
// getsCurrency = LEFT; direction B fills have getsCurrency = RIGHT.
// Both should yield the same ratio so the price never flips.
function fillPrice(fill) {
  const g = parseFloat(fill.getsValue);
  const p = parseFloat(fill.paysValue);
  if (!g || !p) return undefined;
  const leftCurrency = fill.pairKey?.split('~')[0]?.split('|')[0];
  // Direction A (gets = LEFT side): canonical = pays / gets
  // Direction B (gets = RIGHT side): canonical = gets / pays (same ratio, opposite fill)
  return fill.getsCurrency === leftCurrency ? p / g : g / p;
}

export const useWsStore = create((set) => ({
  fills:        [],
  topK:         [],
  selectedPair: null,
  connected:    false,
  bridges:      [],
  // { [pairKey]: { [bucketEpoch]: { fills: [], candle: {} } } }
  liveBuckets:  {},

  addFill: (fill) =>
    set((s) => {
      const newFills = [fill, ...s.fills].slice(0, MAX_FILLS);

      if (!fill.pairKey) return { fills: newFills };

      const price = fillPrice(fill);
      if (price === undefined) return { fills: newFills };

      const ts = fill.ledgerTime ? new Date(fill.ledgerTime).getTime() : Date.now();
      const epoch = bucketEpoch(ts);
      const enriched = { ...fill, price };

      const pairBuckets = s.liveBuckets[fill.pairKey] ?? {};
      const bucket = pairBuckets[epoch] ?? { fills: [] };
      const updatedFills = [...bucket.fills, enriched];

      return {
        fills: newFills,
        liveBuckets: {
          ...s.liveBuckets,
          [fill.pairKey]: {
            ...pairBuckets,
            [epoch]: { fills: updatedFills, candle: computeCandle(updatedFills) },
          },
        },
      };
    }),

  setTopK: (pairs) => set({ topK: pairs }),

  setSelectedPair: (pairKey) => set({ selectedPair: pairKey }),

  setConnected: (connected) => set({ connected }),

  addBridge: (bridge) =>
    set((s) => ({ bridges: [bridge, ...s.bridges].slice(0, MAX_BRIDGES) })),
}));
