import { create } from 'zustand';

const MAX_FILLS = 50;
const BUCKET_SECONDS = 30;

function bucketEpoch(dateMs) {
  const sec = Math.floor(dateMs / 1000);
  return Math.floor(sec / BUCKET_SECONDS) * BUCKET_SECONDS;
}

function computeCandle(fills) {
  const prices = fills.map((f) => parseFloat(f.price));
  return {
    open:        prices[0],
    high:        Math.max(...prices),
    low:         Math.min(...prices),
    close:       prices[prices.length - 1],
    volume:      fills.reduce((s, f) => s + parseFloat(f.getsValue ?? f.volume ?? 0), 0),
    trade_count: fills.length,
  };
}

// price as canonical gets/pays ratio; undefined if unparseable
function fillPrice(fill) {
  const g = parseFloat(fill.getsValue);
  const p = parseFloat(fill.paysValue);
  if (!g || !p) return undefined;
  return p / g;
}

export const useWsStore = create((set) => ({
  fills:        [],
  topK:         [],
  selectedPair: null,
  connected:    false,
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
}));
