import { useQuery } from '@tanstack/react-query';
import { fetchAmmStats } from '../api/http';

export function useAmmStats(window = '1h') {
  return useQuery({
    queryKey: ['amm-stats', window],
    queryFn:  () => fetchAmmStats(window),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
