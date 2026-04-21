import { useQuery } from '@tanstack/react-query';
import { fetchFills } from '../api/http';

export function useFills(params = {}) {
  return useQuery({
    queryKey:  ['fills', params],
    queryFn:   () => fetchFills(params),
    staleTime: 5_000,
  });
}
