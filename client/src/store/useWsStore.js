import { create } from 'zustand';

const MAX_FILLS = 50;

export const useWsStore = create((set) => ({
  fills:        [],
  topK:         [],
  selectedPair: null,
  connected:    false,

  addFill: (fill) =>
    set((s) => ({ fills: [fill, ...s.fills].slice(0, MAX_FILLS) })),

  setTopK: (pairs) => set({ topK: pairs }),

  setSelectedPair: (pairKey) => set({ selectedPair: pairKey }),

  setConnected: (connected) => set({ connected }),
}));
