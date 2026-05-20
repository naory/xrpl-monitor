// ms epoch timestamps, not seconds
const WINDOWS = {
  '10m': 10 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

const BUCKET_MS = {
  '10m': 30_000,
  '1h':  5 * 60_000,
  '24h': 60 * 60_000,
};

module.exports = { WINDOWS, BUCKET_MS };
