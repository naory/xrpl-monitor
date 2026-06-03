import { useEffect, useRef, useState } from 'react';
import { useWsStore } from '../store/useWsStore';

export function useEscrowStream(type) {
  const escrowEvents = useWsStore((s) => s.escrowEvents);
  const seenRef      = useRef(new Set());

  const [recentEvents, setRecentEvents] = useState([]);
  const [stats, setStats] = useState({
    creates: 0, finishes: 0, cancels: 0, xrpVolume: 0, successRate: null,
  });

  useEffect(() => {
    seenRef.current = new Set();
    setRecentEvents([]);
    setStats({ creates: 0, finishes: 0, cancels: 0, xrpVolume: 0, successRate: null });
  }, [type]);

  useEffect(() => {
    const newItems = [];

    for (const event of [...escrowEvents].reverse()) {
      if (event.escrowType !== type) continue;
      if (seenRef.current.has(event.txHash)) continue;
      seenRef.current.add(event.txHash);
      if (seenRef.current.size > 500) {
        const oldest = seenRef.current.values().next().value;
        seenRef.current.delete(oldest);
      }
      newItems.push(event);
    }

    if (!newItems.length) return;

    setRecentEvents((prev) => [...newItems, ...prev].slice(0, 20));
    setStats((prev) => {
      let { creates, finishes, cancels, xrpVolume } = prev;
      for (const e of newItems) {
        if (e.txType === 'EscrowCreate') creates++;
        if (e.txType === 'EscrowFinish') finishes++;
        if (e.txType === 'EscrowCancel') cancels++;
        xrpVolume += parseFloat(e.amountXrp) || 0;
      }
      const settled = finishes + cancels;
      return { creates, finishes, cancels, xrpVolume, successRate: settled > 0 ? finishes / settled : null };
    });
  }, [escrowEvents, type]);

  return { recentEvents, stats };
}
