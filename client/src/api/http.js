import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
  timeout: 10_000,
});

export function fetchFills(params) {
  return api.get('/fills', { params }).then((r) => r.data);
}

export function fetchStats(window) {
  return api.get('/fills/stats', { params: { window } }).then((r) => r.data);
}

export function fetchOrderBook(pairKey) {
  return api.get(`/book/${encodeURIComponent(pairKey)}`).then((r) => r.data);
}
