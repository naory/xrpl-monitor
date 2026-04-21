import { useQuery } from '@tanstack/react-query';
import { fetchOrderBook } from '../api/http';

export function useOrderBook(pairKey) {
  return useQuery({
    queryKey:  ['orderbook', pairKey],
    queryFn:   () => fetchOrderBook(pairKey),
    enabled:   Boolean(pairKey),
    refetchInterval: 5_000,
    staleTime: 3_000,
  });
}
