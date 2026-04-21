import { useQuery } from '@tanstack/react-query';
import { fetchOhlcv } from '../api/http';

export function useOhlcv(pairKey, { window } = {}) {
  return useQuery({
    queryKey: ['ohlcv', pairKey, window],
    queryFn:  () => fetchOhlcv({ pairKey, window }),
    enabled:  !!pairKey,
    refetchInterval: 30_000,
    staleTime: 0,
    select: (data) => data.candles ?? [],
  });
}
