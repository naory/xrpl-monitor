// client/src/hooks/useBridgeStream.js
import { useEffect, useRef, useState } from 'react';
import { useWsStore } from '../store/useWsStore';

export function useBridgeStream() {
  const bridges = useWsStore((s) => s.bridges);
  const seenRef  = useRef(new Set());

  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState({}); // { [currency]: { volume: number, count: number } }

  useEffect(() => {
    let changed = false;
    const newItems = [];

    for (const bridge of [...bridges].reverse()) {
      if (seenRef.current.has(bridge.txHash)) continue;
      seenRef.current.add(bridge.txHash);
      if (seenRef.current.size > 200) {
        const oldest = seenRef.current.values().next().value;
        seenRef.current.delete(oldest);
      }
      changed = true;
      newItems.push(bridge);
    }

    if (!changed) return;

    setStats((prev) => {
      const next = { ...prev };
      for (const bridge of newItems) {
        const xrp = parseFloat(bridge.xrpValue) || 0;
        for (const currency of [bridge.fromCurrency, bridge.toCurrency]) {
          next[currency] = {
            volume: (next[currency]?.volume ?? 0) + xrp / 2,
            count:  (next[currency]?.count  ?? 0) + 1,
          };
        }
      }
      return next;
    });

    setQueue((prev) => [...prev, ...newItems]);
  }, [bridges]);

  return { queue, setQueue, stats };
}
