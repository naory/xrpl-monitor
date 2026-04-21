import { useQuery } from '@tanstack/react-query';
import { fetchOhlcv } from '../api/http';

export function useOhlcv(pairKey, { bucketSeconds = 30, limit = 60 } = {}) {
  return useQuery({
    queryKey: ['ohlcv', pairKey, bucketSeconds, limit],
    queryFn:  () => fetchOhlcv({ pairKey, bucketSeconds, limit }),
    enabled:  !!pairKey,
    refetchInterval: bucketSeconds * 1000,
    staleTime: 0,
    select: (data) => data.candles ?? [],
  });
}
