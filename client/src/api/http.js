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
  return api.get('/book', { params: { pairKey } }).then((r) => r.data);
}

export function fetchOhlcv({ pairKey, window }) {
  return api
    .get('/fills/ohlcv', { params: { pairKey, window } })
    .then((r) => r.data);
}

export function fetchAmmStats(window) {
  return api.get('/amm/stats', { params: { window } }).then((r) => r.data);
}

export function fetchLedgerStats(window) {
  return api.get('/ledger/stats', { params: { window } }).then((r) => r.data);
}

export function fetchBridgeEvents(timeWindow) {
  return api.get('/bridge/events', { params: { window: timeWindow } }).then((r) => r.data);
}
