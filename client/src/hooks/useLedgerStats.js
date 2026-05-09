import { useQuery } from '@tanstack/react-query';
import { fetchLedgerStats } from '../api/http';

export function useLedgerStats(window = '1h') {
  return useQuery({
    queryKey:        ['ledger-stats', window],
    queryFn:         () => fetchLedgerStats(window),
    refetchInterval: 10_000,
    staleTime:       5_000,
  });
}
