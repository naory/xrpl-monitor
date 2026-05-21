import { useEffect, useRef, useState } from 'react';
import { useWsStore } from '../store/useWsStore';

export function useXrpDemandStream() {
  const xrpDemands = useWsStore((s) => s.xrpDemands);
  const seenRef    = useRef(new Set());

  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState({}); // { [currency]: { bought, sold, balance, count } }

  useEffect(() => {
    const newItems = [];

    for (const event of [...xrpDemands].reverse()) {
      // Deduplicate by ledgerIndex + currency + amounts (no txHash available)
      const key = `${event.ledgerIndex}:${event.currency}:${event.xrpBought}:${event.xrpSold}`;
      if (seenRef.current.has(key)) continue;
      seenRef.current.add(key);
      if (seenRef.current.size > 200) {
        const oldest = seenRef.current.values().next().value;
        seenRef.current.delete(oldest);
      }
      newItems.push(event);
    }

    if (!newItems.length) return;

    setStats((prev) => {
      const next = { ...prev };
      for (const event of newItems) {
        const { currency } = event;
        const bought = parseFloat(event.xrpBought) || 0;
        const sold   = parseFloat(event.xrpSold)   || 0;
        const p      = next[currency] ?? { bought: 0, sold: 0, balance: 0, count: 0 };
        next[currency] = {
          bought:  p.bought  + bought,
          sold:    p.sold    + sold,
          balance: p.balance + bought - sold,
          count:   p.count   + 1,
        };
      }
      return next;
    });

    const queueItems = [];
    for (const event of newItems) {
      const bought = parseFloat(event.xrpBought) || 0;
      const sold   = parseFloat(event.xrpSold)   || 0;
      if (bought > 0) queueItems.push({ currency: event.currency, direction: 'buy' });
      if (sold   > 0) queueItems.push({ currency: event.currency, direction: 'sell' });
    }
    setQueue((prev) => [...prev, ...queueItems]);
  }, [xrpDemands]);

  return { queue, setQueue, stats };
}
