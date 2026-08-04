import { useQuery } from '@tanstack/react-query';
import { fetchDomains, fetchDomain, fetchDexOffers } from '../api/http';

export function useDomains({ search = '', limit = 50, offset = 0 } = {}) {
  return useQuery({
    queryKey:        ['domains', search, limit, offset],
    queryFn:         () => fetchDomains({ search, limit, offset }),
    refetchInterval: 60_000,
    staleTime:       30_000,
  });
}

export function useDomain(id) {
  return useQuery({
    queryKey:        ['domain', id],
    queryFn:         () => fetchDomain(id),
    enabled:         !!id,
    refetchInterval: 60_000,
    staleTime:       30_000,
  });
}

export function useDexOffers({ search = '', limit = 100, offset = 0 } = {}) {
  return useQuery({
    queryKey:        ['dex-offers', search, limit, offset],
    queryFn:         () => fetchDexOffers({ search, limit, offset }),
    refetchInterval: 60_000,
    staleTime:       30_000,
  });
}
