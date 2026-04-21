import { useQuery } from '@tanstack/react-query';
import { fetchStats } from '../api/http';

export function useStats(window) {
  return useQuery({
    queryKey:  ['stats', window],
    queryFn:   () => fetchStats(window),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
